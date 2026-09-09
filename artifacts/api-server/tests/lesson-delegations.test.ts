import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  applicationAccess, db, lessonDelegations, lessonLearnedForms, lessonNotifications,
  lessonsAuditLogEntries, lessonsPermissions, lessonsUserWorkspaceRoles,
  lessonsWorkspaceRolePermissions, lessonsWorkspaceRoles, organizations, platformRoles,
  projects, users,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 8);
const orgIds: string[] = [];
let orgId: string;
let projectId: string;
let admin: { id: string; token: string };
let delegator: { id: string };
let delegate: { id: string; token: string };
let otherDelegate: { id: string; token: string };
let ineligibleId: string;
let selectedId: string;
let unselectedId: string;

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function addLessonApprover(userId: string, username: string) {
  const [role] = await db.insert(lessonsWorkspaceRoles).values({ organizationId: orgId, name: `Approver ${username}` }).returning();
  for (const key of ["approve_reject", "view_own_scope"]) {
    let [permission] = await db.select().from(lessonsPermissions).where(and(eq(lessonsPermissions.organizationId, orgId), eq(lessonsPermissions.key, key))).limit(1);
    if (!permission) [permission] = await db.insert(lessonsPermissions).values({ organizationId: orgId, key, label: key, category: "lessons" }).returning();
    await db.insert(lessonsWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
  }
  await db.insert(lessonsUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: role!.id });
  await db.insert(applicationAccess).values({ organizationId: orgId, username, canOpenLessons: true });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");
  baseUrl = `http://127.0.0.1:${address.port}/api/lessons`;

  const [org, foreignOrg] = await db.insert(organizations).values([
    { name: `Delegation ${suffix}`, code: `DG${suffix}` },
    { name: `Foreign ${suffix}`, code: `DF${suffix}` },
  ]).returning();
  orgId = org!.id;
  orgIds.push(org!.id, foreignOrg!.id);
  const [adminRole] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const [adminRow, delegatorRow, delegateRow, otherRow, ineligibleRow] = await db.insert(users).values([
    { organizationId: orgId, email: `admin.${suffix}@test.dev`, username: `admin.${suffix}`, fullName: "Delegation Admin", platformRoleId: adminRole!.id },
    { organizationId: orgId, email: `from.${suffix}@test.dev`, username: `from.${suffix}`, fullName: "Named Delegator" },
    { organizationId: orgId, email: `to.${suffix}@test.dev`, username: `to.${suffix}`, fullName: "Named Delegate" },
    { organizationId: orgId, email: `other.${suffix}@test.dev`, username: `other.${suffix}`, fullName: "Other Delegate" },
    { organizationId: orgId, email: `ineligible.${suffix}@test.dev`, username: `ineligible.${suffix}`, fullName: "Ineligible User" },
  ]).returning();
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  delegator = { id: delegatorRow!.id };
  delegate = { id: delegateRow!.id, token: issueToken(delegateRow!) };
  otherDelegate = { id: otherRow!.id, token: issueToken(otherRow!) };
  ineligibleId = ineligibleRow!.id;
  await addLessonApprover(delegator.id, delegatorRow!.username);
  await addLessonApprover(delegate.id, delegateRow!.username);
  await addLessonApprover(otherDelegate.id, otherRow!.username);

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Delegated Project" }).returning();
  projectId = project!.id;
  const [selected, unselected] = await db.insert(lessonLearnedForms).values([
    { organizationId: orgId, projectId, referenceNumber: `SEL-${suffix}`, title: "Selected pending", issueCategory: "Minor", impact: "Positive", creatorId: admin.id, approverId: delegator.id, workflowState: "submitted" },
    { organizationId: orgId, projectId, referenceNumber: `NO-${suffix}`, title: "Unselected pending", issueCategory: "Minor", impact: "Positive", creatorId: admin.id, approverId: delegator.id, workflowState: "submitted" },
  ]).returning();
  selectedId = selected!.id;
  unselectedId = unselected!.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(lessonNotifications).where(inArray(lessonNotifications.organizationId, orgIds));
  await db.delete(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.organizationId, orgIds));
  await db.delete(lessonDelegations).where(inArray(lessonDelegations.organizationId, orgIds));
  await db.delete(lessonLearnedForms).where(inArray(lessonLearnedForms.organizationId, orgIds));
  await db.delete(applicationAccess).where(inArray(applicationAccess.organizationId, orgIds));
  await db.delete(lessonsUserWorkspaceRoles).where(inArray(lessonsUserWorkspaceRoles.organizationId, orgIds));
  await db.delete(lessonsWorkspaceRolePermissions).where(inArray(lessonsWorkspaceRolePermissions.organizationId, orgIds));
  await db.delete(lessonsPermissions).where(inArray(lessonsPermissions.organizationId, orgIds));
  await db.delete(lessonsWorkspaceRoles).where(inArray(lessonsWorkspaceRoles.organizationId, orgIds));
  await db.delete(projects).where(inArray(projects.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("selected-form lesson delegation", () => {
  it("returns named options and only forms pending with the chosen delegator", async () => {
    const options = await api("GET", "/admin/delegation-options", admin.token);
    expect(options.status).toBe(200);
    expect(options.json.users).toContainEqual({ id: delegator.id, name: "Named Delegator" });
    expect(options.json.users.map((user: { id: string }) => user.id)).not.toContain(ineligibleId);
    const pending = await api("GET", `/admin/delegation-pending-forms?projectId=${projectId}&delegatorId=${delegator.id}`, admin.token);
    expect(pending.status).toBe(200);
    expect(pending.json.map((row: { id: string }) => row.id).sort()).toEqual([selectedId, unselectedId].sort());
  });

  it("rejects invalid boundaries and persists display-ready selected-form summaries", async () => {
    const invalid = await api("POST", "/admin/delegations", admin.token, {
      projectId, delegatorId: delegator.id, delegateId: delegator.id, lessonFormIds: [selectedId],
      startDate: "2026-01-01", endDate: "2026-12-31",
    });
    expect(invalid.status).toBe(422);
    const inaccessible = await api("POST", "/admin/delegations", admin.token, {
      projectId, delegatorId: delegator.id, delegateId: ineligibleId, lessonFormIds: [selectedId],
      startDate: "2026-01-01", endDate: "2026-12-31",
    });
    expect(inaccessible.status).toBe(422);
    const creatorDelegate = await api("POST", "/admin/delegations", admin.token, {
      projectId, delegatorId: delegator.id, delegateId: admin.id, lessonFormIds: [selectedId],
      startDate: "2026-01-01", endDate: "2026-12-31",
    });
    expect(creatorDelegate.status).toBe(422);
    const created = await api("POST", "/admin/delegations", admin.token, {
      projectId, delegatorId: delegator.id, delegateId: delegate.id, lessonFormIds: [selectedId],
      startDate: "2026-01-01", endDate: "2026-12-31",
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.delegatorName).toBe("Named Delegator");
    expect(created.json.lessonForms.map((row: { id: string }) => row.id)).toEqual([selectedId]);
    const listed = await api("GET", "/admin/delegations", admin.token);
    expect(listed.json.items[0]).toMatchObject({ projectName: "Delegated Project", delegateName: "Named Delegate" });
  });

  it("allows only the selected form during active dates and stops access after revocation", async () => {
    expect((await api("GET", `/forms/${selectedId}`, delegate.token)).status).toBe(200);
    expect((await api("GET", `/forms/${unselectedId}`, delegate.token)).status).toBe(403);
    expect((await api("POST", `/forms/${unselectedId}/review`, delegate.token, { decision: "approve" })).status).toBe(403);
    const pending = await api("GET", "/log?pendingApproval=true", delegate.token);
    expect(pending.json.items.map((row: { id: string }) => row.id)).toContain(selectedId);
    expect((await api("POST", `/forms/${selectedId}/review`, delegate.token, { decision: "approve" })).status).toBe(200);
    const listed = await api("GET", "/admin/delegations", admin.token);
    const id = listed.json.items[0].id;
    expect((await api("DELETE", `/admin/delegations/${id}`, admin.token)).status).toBe(204);
    expect((await api("GET", `/forms/${selectedId}`, delegate.token)).status).toBe(403);
  });

  it("does not activate future or expired delegation rows", async () => {
    await db.insert(lessonDelegations).values([
      { organizationId: orgId, delegatorId: delegator.id, delegateId: otherDelegate.id, startsAt: new Date("2099-01-01"), endsAt: new Date("2099-02-01"), scope: { projectId, lessonFormIds: [selectedId] }, status: "pending" },
      { organizationId: orgId, delegatorId: delegator.id, delegateId: otherDelegate.id, startsAt: new Date("2020-01-01"), endsAt: new Date("2020-02-01"), scope: { projectId, lessonFormIds: [selectedId] }, status: "expired" },
    ]);
    expect((await api("GET", `/forms/${selectedId}`, otherDelegate.token)).status).toBe(403);
  });

  it("uses the delegation matching the lesson's current approver when a stale row overlaps", async () => {
    const [lesson] = await db.insert(lessonLearnedForms).values({
      organizationId: orgId,
      projectId,
      referenceNumber: `OVERLAP-${suffix}`,
      title: "Overlapping delegation",
      issueCategory: "Minor",
      impact: "Positive",
      creatorId: admin.id,
      approverId: otherDelegate.id,
      workflowState: "submitted",
    }).returning();
    await db.insert(lessonDelegations).values([
      {
        organizationId: orgId, delegatorId: delegator.id, delegateId: delegate.id,
        startsAt: new Date("2026-01-01"), endsAt: new Date("2026-12-31"),
        scope: { projectId, lessonFormIds: [lesson!.id] }, status: "active",
      },
      {
        organizationId: orgId, delegatorId: otherDelegate.id, delegateId: delegate.id,
        startsAt: new Date("2026-01-01"), endsAt: new Date("2026-12-31"),
        scope: { projectId, lessonFormIds: [lesson!.id] }, status: "active",
      },
    ]);
    expect((await api("GET", `/forms/${lesson!.id}`, delegate.token)).status).toBe(200);
    expect((await api("POST", `/forms/${lesson!.id}/review`, delegate.token, { decision: "approve" })).status).toBe(200);
  });
});