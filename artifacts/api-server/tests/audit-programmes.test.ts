import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import {
  applicationAccess, auditAuditLogEntries, auditNotifications, auditPermissions, auditPlans, auditSchedules,
  auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  db, masterDataGroups, masterDataValues, organizations, platformRoles, users,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";

let app: Express;
let server: Server;
let baseUrl: string;
let orgId: string;
let creator: { id: string; token: string };
let l1: { id: string; token: string };
let l2: { id: string; token: string };
let admin: { id: string; token: string };

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function permission(key: string) {
  const [existing] = await db.select().from(auditPermissions).where(and(
    eq(auditPermissions.organizationId, orgId), eq(auditPermissions.key, key), isNull(auditPermissions.deletedAt),
  ));
  if (existing) return existing;
  const [row] = await db.insert(auditPermissions).values({
    organizationId: orgId, key, label: key, category: "audit",
  }).returning();
  return row!;
}

async function role(name: string, permissionIds: string[]) {
  const [row] = await db.insert(auditWorkspaceRoles).values({
    organizationId: orgId, name,
  }).returning();
  await db.insert(auditWorkspaceRolePermissions).values(permissionIds.map(permissionId => ({
    organizationId: orgId, workspaceRoleId: row!.id, permissionId, grant: "full",
  })));
  return row!;
}

async function assign(userId: string, roleId: string) {
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: roleId });
}

async function addChild(parentId: string) {
  const [row] = await db.insert(auditSchedules).values({
    organizationId: orgId, year: 2026, title: `Child ${parentId}`,
    ownerId: creator.id, workflowState: "draft",
    status: JSON.stringify({ parentId, projectIds: [], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" }),
  }).returning();
  return row!;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/audit", auditRouter);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/audit`;

  const suffix = Math.random().toString(36).slice(2, 8);
  const [org] = await db.insert(organizations).values({ name: `Programme Test ${suffix}`, code: `PG${suffix}` }).returning();
  orgId = org!.id;
  const [platform] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const insertUser = (name: string, platformRoleId?: string) => db.insert(users).values({
    organizationId: orgId, email: `${name.toLowerCase().replaceAll(" ", ".")}.${suffix}@test.invalid`,
    username: `${name.toLowerCase().replaceAll(" ", ".")}.${suffix}`, fullName: name, platformRoleId: platformRoleId ?? null,
  }).returning();
  const [creatorRow] = await insertUser("Programme Creator");
  const [l1Row] = await insertUser("L1 Approver");
  const [l2Row] = await insertUser("L2 Approver");
  const [adminRow] = await insertUser("Programme Admin", platform!.id);
  creator = { id: creatorRow!.id, token: issueToken(creatorRow!) };
  l1 = { id: l1Row!.id, token: issueToken(l1Row!) };
  l2 = { id: l2Row!.id, token: issueToken(l2Row!) };
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  await db.insert(applicationAccess).values([creatorRow!, l1Row!, l2Row!].map(user => ({
    organizationId: orgId, username: user.username, canOpenAudit: true,
  })));
  const create = await permission("create_edit");
  const view = await permission("view_all");
  const approve = await permission("approve_reject");
  const submit = await permission("submit");
  const creatorRole = await role("Audit Contributor", [create.id, view.id, submit.id]);
  const l1Role = await role("L1 Programme Approver", [approve.id, view.id]);
  const l2Role = await role("L2 Programme Approver", [approve.id, view.id]);
  await assign(creator.id, creatorRole.id);
  await assign(l1.id, l1Role.id);
  await assign(l2.id, l2Role.id);
  const [auditCategoryGroup] = await db.insert(masterDataGroups).values({
    organizationId: orgId, code: "audit_categories", name: "Audit categories",
  }).returning();
  await db.insert(masterDataValues).values({
    organizationId: orgId, groupId: auditCategoryGroup!.id, value: "Internal", label: "Internal",
  });
  for (const [code, value] of [
    ["audit_types", "Quality Internal Process Audit"],
    ["audit_types", "Quality Internal Product Audit"],
    ["departments", "Quality Department"],
  ]) {
    let [group] = await db.select().from(masterDataGroups).where(and(
      eq(masterDataGroups.organizationId, orgId), eq(masterDataGroups.code, code),
    ));
    if (!group) {
      [group] = await db.insert(masterDataGroups).values({ organizationId: orgId, code, name: code }).returning();
    }
    await db.insert(masterDataValues).values({ organizationId: orgId, groupId: group!.id, value, label: value });
  }
});

afterAll(async () => {
  await db.delete(auditNotifications).where(eq(auditNotifications.organizationId, orgId));
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId));
  await db.delete(auditPlans).where(eq(auditPlans.organizationId, orgId));
  await db.delete(auditSchedules).where(eq(auditSchedules.organizationId, orgId));
  await db.delete(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.organizationId, orgId));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, orgId));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, orgId));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, orgId));
  await db.delete(masterDataValues).where(eq(masterDataValues.organizationId, orgId));
  await db.delete(masterDataGroups).where(eq(masterDataGroups.organizationId, orgId));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("audit programme parent/child workflow", () => {
  it("creates a programme and rejects submitting it without a child", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "2026 Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(created.status).toBe(201);
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Empty programme", mailBody: "Please review this audit schedule." });
    expect(submitted.status).toBe(422);
  });

  it("associates and filters child schedules while retaining legacy visibility", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Association Programme", fromDate: "2026-01-01", toDate: "2026-06-30" });
    const child = await addChild(created.json.id);
    const filtered = await api("GET", `/schedules?parentId=${created.json.id}`, creator.token);
    expect(filtered.status).toBe(200);
    expect(filtered.json.items.map((item: { id: string }) => item.id)).toContain(child.id);
    await db.insert(auditSchedules).values({
      organizationId: orgId, year: 2026, title: "Legacy audit", ownerId: creator.id,
      workflowState: "draft", status: JSON.stringify({ projectIds: [], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" }),
    });
    const programmes = await api("GET", "/programmes", creator.token);
    expect(programmes.json.items.some((item: { id: string }) => item.id === "legacy")).toBe(true);
  });

  it("deletes only empty unapproved programmes and unapproved child audits", async () => {
    const empty = await api("POST", "/programmes", creator.token, { title: "Deletable Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect((await api("DELETE", `/programmes/${empty.json.id}`, creator.token)).status).toBe(204);
    expect((await api("GET", `/programmes/${empty.json.id}`, creator.token)).status).toBe(404);

    const populated = await api("POST", "/programmes", creator.token, { title: "Populated Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    const draftChild = await addChild(populated.json.id);
    expect((await api("DELETE", `/programmes/${populated.json.id}`, creator.token)).status).toBe(409);
    expect((await api("DELETE", `/schedules/${draftChild.id}`, creator.token)).status).toBe(204);

    const approvedChild = await addChild(populated.json.id);
    await db.update(auditSchedules).set({ workflowState: "approved" }).where(eq(auditSchedules.id, approvedChild.id));
    expect((await api("DELETE", `/schedules/${approvedChild.id}`, creator.token)).status).toBe(409);
    expect((await api("GET", `/schedules/${approvedChild.id}`, creator.token)).status).toBe(200);

    await db.update(auditSchedules).set({ workflowState: "approved" }).where(eq(auditSchedules.id, populated.json.id));
    expect((await api("DELETE", `/programmes/${populated.json.id}`, creator.token)).status).toBe(409);
  });

  it("allows only one active Audit Plan for each Audit Schedule", async () => {
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Single Plan Programme", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    const schedule = await addChild(programme.json.id);
    await db.insert(auditPlans).values({
      organizationId: orgId, auditScheduleId: schedule.id, workflowState: "draft",
      teamMemberIds: [creator.id], status: JSON.stringify({ auditTitle: schedule.title }),
    });

    const schedules = await api("GET", `/schedules?parentId=${programme.json.id}`, creator.token);
    expect(schedules.status).toBe(200);
    expect(schedules.json.items.find((item: { id: string }) => item.id === schedule.id)?.hasPlan).toBe(true);

    const duplicate = await api("POST", "/plans", creator.token, {
      id: crypto.randomUUID(), scheduleId: schedule.id, auditFeasible: true, auditTitle: schedule.title,
      leadAuditorId: creator.id, teamMemberIds: [creator.id], auditeeId: creator.id,
      qaqcScope: "ISO 9001", auditTypes: ["Quality Internal Process Audit"],
      auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "QAM-IA/26-",
      startDateTime: "2026-01-01T08:00:00.000Z", endDateTime: "2026-01-01T16:00:00.000Z",
      openingMeetingDateTime: "2026-01-01T08:00:00.000Z", closingMeetingDateTime: "2026-01-01T15:30:00.000Z",
      activitySection: "General Requirement", activityRemarks: "Review controls",
      activityAuditeeId: creator.id, activityDateTime: "2026-01-01T09:00:00.000Z",
      auditPlanCirculation: "Programme Creator", status: "Draft",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.error).toBe("An Audit Plan already exists for this Audit Schedule");
  });

  it("snapshots L1/L2 roles and advances sequentially with authorization", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Approval Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    const existingChild = await addChild(created.json.id);
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Approval programme", mailBody: "Please review and approve." });
    expect(submitted.status).toBe(200);
    expect(submitted.json.submissionSubject).toBe("Approval programme");
    expect(submitted.json.submissionMailBody).toBe("Please review and approve.");
    expect(submitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect(submitted.json.canReview).toBe(false);
    const [l1List, l2List] = await Promise.all([
      api("GET", "/programmes", l1.token),
      api("GET", "/programmes", l2.token),
    ]);
    expect(l1List.json.items.find((item: { id: string }) => item.id === created.json.id).canReview).toBe(true);
    expect(l2List.json.items.find((item: { id: string }) => item.id === created.json.id).canReview).toBe(false);
    expect((await api("POST", `/programmes/${created.json.id}/review`, admin.token, { decision: "approve" })).status).toBe(403);
    const blocked = await api("POST", `/programmes/${created.json.id}/review`, creator.token, { decision: "approve" });
    expect(blocked.status).toBe(403);
    const first = await api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" });
    expect(first.status).toBe(200);
    expect(first.json.currentApprovalRole).toBe("L2 Programme Approver");
    expect(first.json.canReview).toBe(false);
    const sentBack = await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "send_back", comments: "Please revise and resubmit." });
    expect(sentBack.status).toBe(200);
    expect(sentBack.json.workflowState).toBe("Sent Back");
    expect(sentBack.json.currentApprovalRole).toBeNull();
    expect(sentBack.json.canReview).toBe(false);
    const creatorList = await api("GET", "/programmes", creator.token);
    expect(creatorList.json.items.find((item: { id: string }) => item.id === created.json.id).canSubmit).toBe(true);
    const resubmitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Revised approval programme", mailBody: "The requested revisions are complete." });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect((await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" })).status).toBe(409);
    expect((await api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" })).status).toBe(200);
    const second = await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" });
    expect(second.status).toBe(200);
    expect(second.json.workflowState).toBe("Approved");
    const approvedExistingChild = await api("GET", `/schedules/${existingChild.id}`, creator.token);
    expect(approvedExistingChild.status).toBe(200);
    expect(approvedExistingChild.json.workflowState).toBe("Approved");
    const laterChild = await api("POST", "/schedules", creator.token, {
      id: crypto.randomUUID(), parentId: created.json.id, year: 2026, title: "Later child schedule",
      projectIds: [], auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: "Quality Department", plannedStartDate: "2026-08-01", plannedEndDate: "2026-08-02",
      workflowState: "Draft",
    });
    expect(laterChild.status).toBe(201);
    expect(laterChild.json.workflowState).toBe("Approved");
    const ownerNotice = await db.execute(sql`SELECT recipient_id, title FROM app3_audit.notifications WHERE organization_id = ${orgId} AND recipient_id = ${creator.id} AND title = 'Audit programme approved'`);
    expect(ownerNotice.rows.length).toBeGreaterThan(0);
  });

  it("routes child schedule approval through L1 then L2 and exposes actions only to the current role", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Child Approval Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    const child = await addChild(created.json.id);
    const submitted = await api("POST", `/schedules/${child.id}/submit`, creator.token);
    expect(submitted.status).toBe(200);
    expect(submitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect(submitted.json.canReview).toBe(false);

    const [l1List, l2List] = await Promise.all([
      api("GET", `/schedules?parentId=${created.json.id}`, l1.token),
      api("GET", `/schedules?parentId=${created.json.id}`, l2.token),
    ]);
    expect(l1List.json.items[0].canReview).toBe(true);
    expect(l2List.json.items[0].canReview).toBe(false);
    expect((await api("POST", `/schedules/${child.id}/review`, l2.token, { decision: "approve" })).status).toBe(409);

    const first = await api("POST", `/schedules/${child.id}/review`, l1.token, { decision: "approve" });
    expect(first.status).toBe(200);
    expect(first.json.workflowState).toBe("Submitted");
    expect(first.json.currentApprovalRole).toBe("L2 Programme Approver");

    const second = await api("POST", `/schedules/${child.id}/review`, l2.token, { decision: "approve" });
    expect(second.status).toBe(200);
    expect(second.json.workflowState).toBe("Approved");
    expect(second.json.currentApprovalRole).toBeNull();
  });

  it("rejects programme type confusion and arbitrary or legacy parent links, preserving omitted links", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Validation Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    const invalid = await api("POST", "/schedules", creator.token, { id: crypto.randomUUID(), year: 2026, title: "Invalid", parentId: crypto.randomUUID(), projectIds: [], auditTypes: [], workflowState: "Draft" });
    expect(invalid.status).toBe(422);
    const legacy = await api("POST", "/schedules", creator.token, { id: crypto.randomUUID(), year: 2026, title: "Legacy Link", parentId: "legacy", projectIds: [], auditTypes: [], workflowState: "Draft" });
    expect(legacy.status).toBe(422);
    const child = await addChild(created.json.id);
    const childDto = await api("GET", `/schedules/${child.id}`, creator.token);
    const updated = await api("PUT", `/schedules/${child.id}`, creator.token, { ...childDto.json, projectIds: [], auditTypes: [], workflowState: "Draft" });
    expect(updated.status).toBe(200);
    expect(updated.json.parentId).toBe(created.json.id);
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await api(method, `/schedules/${created.json.id}`, admin.token, method === "PUT" ? { ...created.json, projectIds: [], auditTypes: [] } : undefined);
      expect(response.status).toBe(404);
    }
  });

  it("allows only one concurrent current-role review and rejects unstaffed approval chains", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Concurrent Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    await addChild(created.json.id);
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Concurrent programme", mailBody: "Please review this programme." });
    expect(submitted.status).toBe(200);
    const results = await Promise.all([
      api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" }),
      api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const emptyRole = await role("L3 Unstaffed", [(await permission("approve_reject")).id]);
    expect(emptyRole.id).toBeTruthy();
    const unstaffed = await api("POST", "/programmes", creator.token, { title: "Unstaffed Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    await addChild(unstaffed.json.id);
    const rejected = await api("POST", `/programmes/${unstaffed.json.id}/submit`, creator.token, { subject: "Unstaffed programme", mailBody: "Please review this programme." });
    expect(rejected.status).toBe(422);
  });

  it("enforces child dates inside the parent programme range while allowing boundaries", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Date Programme", fromDate: "2026-03-01", toDate: "2026-09-30" });
    const payload = (start: string, end: string) => ({
      id: crypto.randomUUID(), parentId: created.json.id, year: 2026, title: `Date audit ${start}`,
      projectIds: [], auditTypes: [], auditCategory: "Internal", plannedStartDate: start, plannedEndDate: end, workflowState: "Draft",
    });
    expect((await api("POST", "/schedules", creator.token, payload("2026-02-28", "2026-03-05"))).status).toBe(422);
    expect((await api("POST", "/schedules", creator.token, payload("2026-09-01", "2026-10-01"))).status).toBe(422);
    const boundary = await api("POST", "/schedules", creator.token, payload("2026-03-01", "2026-09-30"));
    expect(boundary.status).toBe(201);
    const invalidUpdate = await api("PUT", `/schedules/${boundary.json.id}`, creator.token, {
      ...boundary.json, auditCategory: "Internal", projectIds: [], auditTypes: [],
      plannedEndDate: "2026-10-01", workflowState: "Draft",
    });
    expect(invalidUpdate.status).toBe(422);
  });

  it("allows department-based Process audits without a project and keeps Product audits project-scoped", async () => {
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Conditional scope programme", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    const base = {
      id: crypto.randomUUID(), parentId: programme.json.id, year: 2026, title: "Conditional audit",
      projectIds: [], auditCategory: "Internal", departmentProject: "Quality Department",
      plannedStartDate: "2026-05-01", plannedEndDate: "2026-05-02", workflowState: "Draft",
    };
    const process = await api("POST", "/schedules", creator.token, {
      ...base, auditTypes: ["Quality Internal Process Audit"],
    });
    expect(process.status).toBe(201);
    expect(process.json.projectIds).toEqual([]);
    expect(process.json.departmentProject).toBe("Quality Department");

    const product = await api("POST", "/schedules", creator.token, {
      ...base, id: crypto.randomUUID(), auditTypes: ["Quality Internal Product Audit"],
    });
    expect(product.status).toBe(422);
  });
});