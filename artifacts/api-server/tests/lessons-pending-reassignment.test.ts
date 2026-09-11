import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, lessonLearnedForms, lessonNotifications, lessonsAuditLogEntries, lessonsPermissions,
  lessonsUserWorkspaceRoles, lessonsWorkspaceRolePermissions, lessonsWorkspaceRoles,
  organizations, platformRoles, projects, users,
} from "@workspace/db";
import lessonsRouter from "../src/routes/lessons";
import { issueToken } from "../src/lib/auth";

const suffix = Math.random().toString(36).slice(2, 8);
let server: Server;
let baseUrl: string;
let orgId: string;
let projectId: string;
let admin: { id: string; token: string };
let creator: { id: string };
let oldApprover: { id: string; token: string };
let target: { id: string };
let formIds: string[] = [];

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() as any };
}

async function makeApprover(userId: string, username: string) {
  const [role] = await db.insert(lessonsWorkspaceRoles).values({ organizationId: orgId, name: `Approver ${username}` }).returning();
  for (const key of ["approve_reject", "view_own_scope"]) {
    let [permission] = await db.select().from(lessonsPermissions).where(and(eq(lessonsPermissions.organizationId, orgId), eq(lessonsPermissions.key, key))).limit(1);
    if (!permission) [permission] = await db.insert(lessonsPermissions).values({ organizationId: orgId, key, label: key, category: "lessons" }).returning();
    await db.insert(lessonsWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
  }
  await db.insert(lessonsUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: role!.id });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/lessons", lessonsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  baseUrl = `http://127.0.0.1:${address.port}/api/lessons`;
  const [org] = await db.insert(organizations).values({ name: `Pending ${suffix}`, code: `PN${suffix}` }).returning();
  orgId = org!.id;
  const [adminRole] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const [adminRow, creatorRow, oldRow, targetRow] = await db.insert(users).values([
    { organizationId: orgId, email: `a${suffix}@test`, username: `a${suffix}`, fullName: "Server Admin", platformRoleId: adminRole!.id },
    { organizationId: orgId, email: `c${suffix}@test`, username: `c${suffix}`, fullName: "Lesson Creator" },
    { organizationId: orgId, email: `o${suffix}@test`, username: `o${suffix}`, fullName: "Old Approver" },
    { organizationId: orgId, email: `t${suffix}@test`, username: `t${suffix}`, fullName: "New Approver" },
  ]).returning();
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  creator = { id: creatorRow!.id };
  oldApprover = { id: oldRow!.id, token: issueToken(oldRow!) };
  target = { id: targetRow!.id };
  await makeApprover(oldApprover.id, oldRow!.username);
  await makeApprover(target.id, targetRow!.username);
  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P${suffix}`, name: "Pending Project" }).returning();
  projectId = project!.id;
  const forms = await db.insert(lessonLearnedForms).values([
    { organizationId: orgId, projectId, referenceNumber: `P1${suffix}`, title: "Pending one", categorisation: "Minor", issueCategory: "Minor", impact: "Positive", creatorId: creator.id, approverId: oldApprover.id, workflowState: "submitted" },
    { organizationId: orgId, projectId, referenceNumber: `P2${suffix}`, title: "Pending two", issueCategory: "Major", impact: "Negative", creatorId: creator.id, approverId: oldApprover.id, workflowState: "submitted" },
  ]).returning();
  formIds = forms.map((form) => form.id);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(lessonNotifications).where(eq(lessonNotifications.organizationId, orgId));
  await db.delete(lessonsAuditLogEntries).where(eq(lessonsAuditLogEntries.organizationId, orgId));
  await db.delete(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, orgId));
  await db.delete(lessonsUserWorkspaceRoles).where(eq(lessonsUserWorkspaceRoles.organizationId, orgId));
  await db.delete(lessonsWorkspaceRolePermissions).where(eq(lessonsWorkspaceRolePermissions.organizationId, orgId));
  await db.delete(lessonsWorkspaceRoles).where(eq(lessonsWorkspaceRoles.organizationId, orgId));
  await db.delete(lessonsPermissions).where(eq(lessonsPermissions.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("administrator pending action reassignment", () => {
  it("restricts all-pending visibility and reassignment to administrators", async () => {
    expect((await api("GET", "/log?allPendingActions=true", oldApprover.token)).status).toBe(403);
    expect((await api("POST", "/admin/pending-actions/reassign", oldApprover.token, { lessonFormIds: formIds, targetApproverId: target.id })).status).toBe(403);
  });

  it("filters all pending actions and atomically transfers both queues", async () => {
    const filtered = await api("GET", `/log?allPendingActions=true&projectId=${projectId}&category=Minor&creatorId=${creator.id}&approverId=${oldApprover.id}`, admin.token);
    expect(filtered.status).toBe(200);
    expect(filtered.json.items.map((row: any) => row.id)).toEqual([formIds[0]]);
    const moved = await api("POST", "/admin/pending-actions/reassign", admin.token, { lessonFormIds: formIds, targetApproverId: target.id });
    expect(moved.status).toBe(200);
    const rows = await db.select().from(lessonLearnedForms).where(inArray(lessonLearnedForms.id, formIds));
    expect(rows.every((row) => row.approverId === target.id)).toBe(true);
    const oldQueue = await api("GET", `/log?allPendingActions=true&approverId=${oldApprover.id}`, admin.token);
    const newQueue = await api("GET", `/log?allPendingActions=true&approverId=${target.id}`, admin.token);
    expect(oldQueue.json.items.map((row: any) => row.id)).not.toEqual(expect.arrayContaining(formIds));
    expect(newQueue.json.items.map((row: any) => row.id)).toEqual(expect.arrayContaining(formIds));
    const audit = await db.select().from(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.entityId, formIds));
    expect(audit).toHaveLength(2);
    expect(audit[0]!.after).toMatchObject({ transferText: expect.stringContaining("Transferred by Server Admin from Old Approver to New Approver") });
    const notifications = await db.execute<{ recipient_id: string }>(sql`select recipient_id from app2_lessons.notifications where organization_id = ${orgId} and body like ${`%P1${suffix}%`}`);
    expect(notifications.rows.map((row) => row.recipient_id)).toEqual(expect.arrayContaining([oldApprover.id, target.id]));
  });
});