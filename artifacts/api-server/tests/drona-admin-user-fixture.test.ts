/** Optional, isolated browser data; never creates or changes Drona source tables. */
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { it } from "vitest";
import {
  applicationAccess, auditAuditLogEntries, auditNotifications, auditUserWorkspaceRoles,
  auditWorkspaceRoles, db, organizations, platformRoles, users,
} from "@workspace/db";
import { issueToken } from "../src/lib/auth";

const file = "/tmp/qms-drona-admin-user-fixture.json";
it.skipIf(process.env.QMS_DRONA_USER_BROWSER !== "1")("creates isolated Drona Add User browser data", async () => {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db.insert(organizations).values({ name: `Drona user browser ${suffix}`, code: `DRUSER-${suffix}` }).returning();
  await writeFile(file, JSON.stringify({ orgId: org!.id, orgCode: org!.code }), { mode: 0o600 });
  const roles = await db.insert(platformRoles).values([
    { organizationId: org!.id, name: "Super Admin", isSystem: true },
    { organizationId: org!.id, name: "Employee", isSystem: true },
  ]).returning();
  const people = await db.insert(users).values([
    { organizationId: org!.id, platformRoleId: roles[0]!.id, fullName: "Synthetic Super Admin",
      email: `drona-admin-${suffix}@example.test`, username: `drona_admin_${suffix}`, accessStatus: "active" },
    { organizationId: org!.id, platformRoleId: roles[1]!.id, fullName: "Synthetic Drona Import",
      email: `drona-import-${suffix}@example.test`, username: `drona_import_${suffix}`, accessStatus: "active" },
  ]).returning();
  const [role] = await db.insert(auditWorkspaceRoles).values({
    organizationId: org!.id, name: "Synthetic imported user role",
  }).returning();
  await db.insert(applicationAccess).values(people.map(person => ({
    organizationId: org!.id, username: person.username, accessStatus: "active",
    canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true,
  })));
  await writeFile(file, JSON.stringify({
    orgId: org!.id, orgCode: org!.code, userId: people[1]!.id, email: people[1]!.email,
    fullName: people[1]!.fullName, roleId: role!.id,
    token: issueToken(people[0]!), employeeToken: issueToken(people[1]!),
  }), { mode: 0o600 });
});

it.skipIf(process.env.QMS_DRONA_USER_CLEANUP !== "1")("cleans only isolated Drona Add User browser data", async () => {
  const fixture = process.env.QMS_DRONA_USER_CLEANUP_ORG
    ? { orgId: process.env.QMS_DRONA_USER_CLEANUP_ORG, orgCode: undefined }
    : JSON.parse(await readFile(file, "utf8")) as { orgId: string; orgCode?: string };
  const [org] = await db.select().from(organizations).where(eq(organizations.id, fixture.orgId));
  if (!org || !org.code.startsWith("DRUSER-") || (fixture.orgCode && org.code !== fixture.orgCode)) throw new Error("Refusing unsafe fixture cleanup");
  for (const table of [auditNotifications, auditAuditLogEntries, auditUserWorkspaceRoles,
    auditWorkspaceRoles, applicationAccess, users, platformRoles]) {
    await db.delete(table).where(eq(table.organizationId, fixture.orgId));
  }
  await db.delete(organizations).where(eq(organizations.id, fixture.orgId));
  if (!process.env.QMS_DRONA_USER_CLEANUP_ORG) await unlink(file);
});
