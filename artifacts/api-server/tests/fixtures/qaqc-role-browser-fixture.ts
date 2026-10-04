import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, organizations, platformRoles, users, applicationAccess, workspaceRoles, permissions,
  workspaceRolePermissions, userWorkspaceRoles, auditLogEntries, projects } from "@workspace/db";
import { issueToken } from "../../src/lib/auth";
const path = "/tmp/qaqc-role-browser-fixture.json";
if (process.argv[2] === "refresh") {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  const rows = await db.select().from(users).where(eq(users.organizationId, fixture.organizationId));
  const admin = rows.find(row => row.fullName === "Test QA/QC administrator")!;
  const member = rows.find(row => row.fullName === "Test QA/QC representative")!;
  await writeFile(path, JSON.stringify({ ...fixture, adminToken: issueToken(admin), memberToken: issueToken(member) }));
} else if (process.argv[2] === "cleanup") {
  const { organizationId } = JSON.parse(await readFile(path, "utf8"));
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!organization?.name.startsWith("QA/QC permission test ")) throw new Error("Refusing to remove a non-test tenant");
  const result = await db.$client.query(`select table_schema, table_name from information_schema.columns
    where column_name='organization_id' and table_schema in ('public','shared','app1_qaqc','app2_lessons','app3_audit')`);
  let remaining = result.rows;
  for (let pass = 0; pass < 10 && remaining.length; pass++) {
    const blocked = [];
    for (const table of remaining) {
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      try { await db.$client.query(`delete from ${quote(table.table_schema)}.${quote(table.table_name)} where organization_id=$1`, [organizationId]); }
      catch (error: any) { if (error.code !== "23503") throw error; blocked.push(table); }
    }
    remaining = blocked;
  }
  if (remaining.length) throw new Error("Test-tenant cleanup still has dependent rows");
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await unlink(path);
} else {
  const suffix = randomUUID().slice(0, 8);
  const [organization] = await db.insert(organizations).values({ name: `QA/QC permission test ${suffix}`, code: `QC${suffix}` }).returning();
  const organizationId = organization!.id;
  const [adminRole, employeeRole] = await db.insert(platformRoles).values([
    { organizationId, name: "Org Admin", isSystem: true }, { organizationId, name: "Employee", isSystem: true },
  ]).returning();
  const [admin, member] = await db.insert(users).values([
    { organizationId, username: `qc-admin-${suffix}@example.invalid`, email: `qc-admin-${suffix}@example.invalid`, fullName: "Test QA/QC administrator", passwordHash: "test-token-only", platformRoleId: adminRole!.id, accessStatus: "active" },
    { organizationId, username: `qc-member-${suffix}@example.invalid`, email: `qc-member-${suffix}@example.invalid`, fullName: "Test QA/QC representative", passwordHash: "test-token-only", platformRoleId: employeeRole!.id, accessStatus: "active" },
  ]).returning();
  const [role] = await db.insert(workspaceRoles).values({ organizationId, name: "QAQC Representative", description: "Capture and submit QA/QC records", isSystem: true }).returning();
  for (const key of ["data_entry", "view_all"]) {
    const [permission] = await db.insert(permissions).values({ organizationId, key, label: key, category: "qaqc" }).returning();
    await db.insert(workspaceRolePermissions).values({ organizationId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
  }
  await db.insert(userWorkspaceRoles).values({ organizationId, userId: member!.id, workspaceRoleId: role!.id });
  await db.insert(applicationAccess).values({ organizationId, username: member!.username, canOpenQaqc: true, canOpenLessons: false, canOpenAudit: false });
  const [project] = await db.insert(projects).values({ organizationId, name: "QA/QC permission test project", code: `P${suffix}` }).returning();
  await writeFile(path, JSON.stringify({ organizationId, roleId: role!.id, projectId: project!.id, adminToken: issueToken(admin!), memberToken: issueToken(member!) }));
}
await db.$client.end();