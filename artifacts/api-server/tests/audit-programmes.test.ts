import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import {
  applicationAccess, auditAuditLogEntries, auditNotifications, auditPermissions, auditPlans, auditSchedules, audits, organizationSettings,
  auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  correctiveActionReports, auditFindings, db, masterDataGroups, masterDataValues, moduleFieldSettings, organizations, outboundEmails, platformRoles, projects, users,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";
import { writeFieldControls } from "../src/lib/field-controls";

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
    body: body === undefined ? undefined : JSON.stringify(method === "POST" && path === "/programmes"
      ? { teamLeadIds: [creator.id], ...(body as object) } : body),
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

async function role(name: string, permissionIds: string[], roleAuthorizationLevel?: number) {
  const [row] = await db.insert(auditWorkspaceRoles).values({
    organizationId: orgId, name, roleAuthorizationLevel,
  }).returning();
  if (permissionIds.length) {
    await db.insert(auditWorkspaceRolePermissions).values(permissionIds.map(permissionId => ({
      organizationId: orgId, workspaceRoleId: row!.id, permissionId, grant: "full",
    })));
  }
  return row!;
}

async function assign(userId: string, roleId: string) {
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: roleId });
}

async function assignScope(userId: string, roleId: string, projectIds: string[]) {
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: roleId, projectIds });
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
  const teamLead = await permission("audit_team_lead");
  const creatorRole = await role("Audit Contributor", [create.id, view.id, submit.id, teamLead.id]);
  const l1Role = await role("L1 Programme Approver", [approve.id, view.id], 1);
  const l2Role = await role("L2 Programme Approver", [approve.id, view.id], 2);
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
    ["activities", "General Requirement"],
    ["activities", "Design"],
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
  await db.delete(outboundEmails).where(eq(outboundEmails.organizationId, orgId));
  await db.delete(auditNotifications).where(eq(auditNotifications.organizationId, orgId));
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId));
  await db.delete(correctiveActionReports).where(eq(correctiveActionReports.organizationId, orgId));
  await db.delete(auditFindings).where(eq(auditFindings.organizationId, orgId));
  await db.delete(audits).where(eq(audits.organizationId, orgId));
  await db.delete(auditPlans).where(eq(auditPlans.organizationId, orgId));
  await db.delete(auditSchedules).where(eq(auditSchedules.organizationId, orgId));
  await db.delete(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.organizationId, orgId));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, orgId));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, orgId));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, orgId));
  await db.delete(masterDataValues).where(eq(masterDataValues.organizationId, orgId));
  await db.delete(masterDataGroups).where(eq(masterDataGroups.organizationId, orgId));
  await db.delete(moduleFieldSettings).where(eq(moduleFieldSettings.organizationId, orgId));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("audit programme parent/child workflow", () => {
  it("filters CAR findings by title, type, department and combined columns before pagination", async () => {
    const productType = "Quality Internal Product Audit";
    const processType = "Quality Internal Process Audit";
    const [project] = await db.insert(projects).values({
      organizationId: orgId, name: "Filter project", code: `FILTER-${crypto.randomUUID().slice(0, 8)}`,
    }).returning();
    const createFinding = async (title: string, type: string, department?: string) => {
      const projectId = department ? null : project!.id;
      const [schedule] = await db.insert(auditSchedules).values({
        organizationId: orgId, projectId, year: 2026, title: `${title} schedule`,
        status: JSON.stringify({ auditTypes: [type], departmentProject: department }),
      }).returning();
      const [plan] = await db.insert(auditPlans).values({
        organizationId: orgId, projectId, auditScheduleId: schedule!.id,
        status: JSON.stringify({ leadAuditorId: creator.id }),
      }).returning();
      const [audit] = await db.insert(audits).values({
        organizationId: orgId, projectId, auditPlanId: plan!.id,
        referenceNumber: `FILTER-${crypto.randomUUID()}`, status: JSON.stringify({ title }),
        checklistState: [{
          id: crypto.randomUUID(), description: "Filter finding",
          auditFinding: "Minor NC", actionTakerId: l1.id,
        }] as any,
      }).returning();
      return { schedule: schedule!, audit: audit! };
    };
    const product = await createFinding("Product filter audit", productType);
    const process = await createFinding("Process filter audit", processType, "Quality Department");
    await createFinding("Other process filter audit", processType, "Engineering Department");
    const get = async (filters: Record<string, string>) => {
      const result = await api("GET", `/car-register?${new URLSearchParams(filters)}`, admin.token);
      expect(result.status, JSON.stringify(result.json)).toBe(200);
      return result.json;
    };
    const all = await get({ limit: "1" });
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(1);
    expect(all.auditTitles).toHaveLength(3);
    expect(all.auditTypes).toEqual(expect.arrayContaining([
      { id: productType, name: productType }, { id: processType, name: processType },
    ]));
    expect(all.departments).toHaveLength(2);
    const byType = await get({ auditType: processType });
    expect(byType.total).toBe(2);
    expect(byType.projects).toEqual([]);
    expect(byType.departments).toHaveLength(2);
    const byDepartment = await get({ department: "Quality Department" });
    expect(byDepartment.items).toEqual([expect.objectContaining({
      auditId: process.audit.id, department: "Quality Department", auditTypes: [processType],
    })]);
    const combined = await get({
      auditTitle: "Product filter audit", auditType: productType,
      projectId: project!.id, scheduleId: product.schedule.id, status: "Open",
    });
    expect(combined.total).toBe(1);
    expect(combined.items[0].auditId).toBe(product.audit.id);
    expect(combined.departments).toEqual([]);
    expect(combined.projects).toEqual([{ id: project!.id, name: "Filter project" }]);
    expect((await get({ auditTitle: "Missing title" })).total).toBe(0);
    expect((await get({ auditType: productType, department: "Quality Department" })).total).toBe(0);
    expect((await get({ auditType: processType, projectId: project!.id })).total).toBe(0);
    const closed = await get({ status: "Closed" });
    expect(closed.items).toEqual([]);
    expect(closed.auditTitles).toHaveLength(3);
    expect((await get({})).total).toBe(3);
  });

  it("registers actual findings, filters them, preserves response identity and closes only on assigned Team Lead acceptance", async () => {
    const actionRole = await role("CAR action taker", [(await permission("create_edit")).id, (await permission("submit")).id, (await permission("view_all")).id]);
    const leadRole = await role("CAR Team Lead", [(await permission("audit.cars.view_all")).id, (await permission("audit_team_lead")).id]);
    await assign(creator.id, leadRole.id);
    await assign(l1.id, actionRole.id);
    try {
      const [project] = await db.insert(projects).values({ organizationId: orgId, name: "CAR project", code: `CAR-${crypto.randomUUID().slice(0,8)}` }).returning();
      const [schedule] = await db.insert(auditSchedules).values({ organizationId: orgId, projectId: project!.id, year: 2026, title: "CAR schedule",
        status: JSON.stringify({ projectIds: [project!.id] }) }).returning();
      const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, projectId: project!.id, auditScheduleId: schedule!.id,
        status: JSON.stringify({ leadAuditorId: creator.id }) }).returning();
      const itemId = crypto.randomUUID();
      const [audit] = await db.insert(audits).values({ organizationId: orgId, projectId: project!.id, auditPlanId: plan!.id,
        referenceNumber: `CAR-${crypto.randomUUID()}`, checklistState: [
          { id: itemId, source: "finding", clause: "1", auditArea: "Project management", description: "Plan not followed",
            auditFinding: "Moderate NC", actionTakerId: l1.id, evidenceIds: [] },
          { id: crypto.randomUUID(), clause: "2", result: "Not applicable" },
        ] as any }).returning();
      const register = await api("GET", `/car-register?projectId=${project!.id}&scheduleId=${schedule!.id}`, creator.token);
      expect(register.status, JSON.stringify(register.json)).toBe(200);
      expect(register.json.items).toHaveLength(1);
      expect(register.json.items[0]).toMatchObject({ itemId, clause: "1", classification: "Moderate NC", actionTakerName: "L1 Approver", status: "Open" });
      expect((await api("GET", `/car-register?scheduleId=${crypto.randomUUID()}`, creator.token)).json.items).toHaveLength(0);
      const [before] = await db.select({ count: sql<number>`count(*)` }).from(correctiveActionReports).where(eq(correctiveActionReports.organizationId, orgId));
      await api("GET", "/car-register", creator.token);
      const [after] = await db.select({ count: sql<number>`count(*)` }).from(correctiveActionReports).where(eq(correctiveActionReports.organizationId, orgId));
      expect(after!.count).toBe(before!.count);
      expect((await api("POST", "/car-register/start", l2.token, { auditId: audit!.id, itemId })).status).toBe(403);
      const created = await api("POST", "/car-register/start", l1.token, { auditId: audit!.id, itemId });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      const retry = await api("POST", "/car-register/start", l1.token, { auditId: audit!.id, itemId });
      expect(retry.json.id).toBe(created.json.id);
      expect((await api("POST", `/cars/${created.json.id}/submit`, l1.token)).status).toBe(422);
      const response = { ...created.json, rootCause: "Controls missing", correction: "Plan updated", correctiveAction: "Review controls monthly" };
      const saved = await api("PUT", `/cars/${created.json.id}`, l1.token, response);
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      expect((await api("POST", `/cars/${created.json.id}/submit`, l1.token)).status).toBe(200);
      expect((await api("GET", "/my-actions?limit=100", creator.token)).json.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.json.id, action: "Review" }),
      ]));
      expect((await api("GET", "/my-actions?limit=100", admin.token)).json.items).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.json.id, action: "Review" }),
      ]));
      expect((await api("POST", `/cars/${created.json.id}/review`, l2.token, { decision: "accept" })).status).toBe(403);
      expect((await api("POST", `/cars/${created.json.id}/review`, admin.token, { decision: "accept" })).status).toBe(403);
      expect((await api("POST", `/cars/${created.json.id}/review`, creator.token, { decision: "query" })).status).toBe(422);
      const query = await api("POST", `/cars/${created.json.id}/review`, creator.token, { decision: "query", comments: "Provide verification" });
      expect(query.status, JSON.stringify(query.json)).toBe(200);
      expect(query.json).toMatchObject({ status: "Returned for query", reviewOutcome: "query", reviewComments: "Provide verification" });
      expect((await api("GET", `/cars/${created.json.id}`, l1.token)).json.reviewComments).toBe("Provide verification");
      expect((await api("PUT", `/cars/${created.json.id}`, l1.token, response)).status).toBe(200);
      expect((await api("POST", `/cars/${created.json.id}/submit`, l1.token)).status).toBe(200);
      const rework = await api("POST", `/cars/${created.json.id}/review`, creator.token, { decision: "rework", comments: "Improve the preventive action" });
      expect(rework.json).toMatchObject({ status: "Returned for rework", reviewOutcome: "rework" });
      expect((await api("PUT", `/cars/${created.json.id}`, l1.token, response)).status).toBe(200);
      expect((await api("POST", `/cars/${created.json.id}/submit`, l1.token)).status).toBe(200);
      const outcomes = await Promise.all([1,2].map(() => api("POST", `/cars/${created.json.id}/review`, creator.token, { decision: "accept" })));
      expect(outcomes.map(x => x.status).sort()).toEqual([200,409]);
      expect(outcomes.find(x => x.status === 200)!.json.status).toBe("Closed");
      expect((await api("PUT", `/cars/${created.json.id}`, l1.token, response)).status).toBe(409);
      expect((await api("GET", `/car-register?status=Closed&projectId=${project!.id}`, creator.token)).json.items[0].car.closedAt).toBeTruthy();
      await db.update(audits).set({ checklistState: [] as any }).where(eq(audits.id, audit!.id));
      expect((await api("GET", `/car-register?projectId=${project!.id}`, creator.token)).json.items).toHaveLength(0);
      expect((await api("GET", `/car-register?projectId=${project!.id}&includeLegacy=true`, creator.token)).json.items[0].car.id).toBe(created.json.id);
      expect((await api("GET", `/cars/${created.json.id}`, l1.token)).json).toMatchObject({ status: "Closed", canRespond: false, canReview: false });
    } finally {
      await db.delete(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, orgId),
        eq(auditUserWorkspaceRoles.userId, l1.id), eq(auditUserWorkspaceRoles.workspaceRoleId, actionRole.id)));
      await db.delete(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, orgId),
        eq(auditUserWorkspaceRoles.userId, creator.id), eq(auditUserWorkspaceRoles.workspaceRoleId, leadRole.id)));
    }
  });
  it("persists schedule role/users and editable multi-user activity snapshots without granting roles", async () => {
    const [contributor] = await db.select().from(auditWorkspaceRoles).where(and(
      eq(auditWorkspaceRoles.organizationId, orgId), eq(auditWorkspaceRoles.name, "Audit Contributor"),
    ));
    const marker = await permission("product_process_owner");
    const ownerRole = await role("Assignment product owner", [marker.id]);
    await assign(creator.id, ownerRole.id);
    try {
    const options = await api("GET", "/schedule-activity-options", admin.token);
    expect(options.status, JSON.stringify(options.json)).toBe(200);
    expect(options.json.users.some((user: { id: string }) => user.id === l1.id)).toBe(true);
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Activity assignments programme", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    const activityRoleAssignments = [{ roleId: contributor!.id, userIds: [creator.id, l1.id] }];
    const scheduleInput = {
      id: crypto.randomUUID(), parentId: programme.json.id, year: 2026, title: "Assignment schedule",
      projectIds: [], auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: "Quality Department", processProductOwner: "Programme Creator",
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02", qaqcScope: "ISO 9001",
      qaqcClauses: "ISO 9001", workflowState: "Draft", activityRoleAssignments,
    };
    const createdSchedule = await api("POST", "/schedules", admin.token, scheduleInput);
    expect(createdSchedule.status, JSON.stringify(createdSchedule.json)).toBe(201);
    expect(createdSchedule.json.activityRoleAssignments).toEqual(activityRoleAssignments);
    const scheduleId = createdSchedule.json.id;
    expect((await api("GET", `/schedules/${scheduleId}`, admin.token)).json.activityRoleAssignments).toEqual(activityRoleAssignments);
    const editedSchedule = await api("PUT", `/schedules/${scheduleId}`, admin.token, {
      ...scheduleInput, activityRoleAssignments: [{ roleId: contributor!.id, userIds: [l2.id] }],
    });
    expect(editedSchedule.status, JSON.stringify(editedSchedule.json)).toBe(200);
    expect(editedSchedule.json.activityRoleAssignments[0].userIds).toEqual([l2.id]);
    const omitted = { ...scheduleInput };
    delete (omitted as Partial<typeof scheduleInput>).activityRoleAssignments;
    const preserved = await api("PUT", `/schedules/${scheduleId}`, admin.token, omitted);
    expect(preserved.status, JSON.stringify(preserved.json)).toBe(200);
    expect(preserved.json.activityRoleAssignments[0].userIds).toEqual([l2.id]);
    const invalid = await api("PUT", `/schedules/${scheduleId}`, admin.token, {
      ...scheduleInput, activityRoleAssignments: [{ roleId: contributor!.id, userIds: [crypto.randomUUID()] }],
    });
    expect(invalid.status).toBe(422);
    const activities = [{ id: crypto.randomUUID(), section: "General Requirement", remarks: "Review",
      roleIds: [contributor!.id], auditeeId: creator.id, auditeeIds: [creator.id, l1.id],
      plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" }];
    const planInput = {
      id: crypto.randomUUID(), scheduleId, auditFeasible: true, auditTitle: scheduleInput.title,
      leadAuditorId: creator.id, teamMemberIds: [creator.id], auditeeId: creator.id,
      auditeeRoleIds: [contributor!.id], circulationRoleIds: [contributor!.id],
      qaqcScope: "ISO 9001", auditTypes: scheduleInput.auditTypes, auditLanguage: "Verbal: English\nWriting: English",
      qaqcReference: "QAM-IA/26-", startDateTime: "2026-01-01T00:00", endDateTime: "2026-01-02T23:59",
      openingMeetingDateTime: "2026-01-01T08:00", closingMeetingDateTime: "2026-01-02T11:00",
      activitySection: "General Requirement", activityRemarks: "Review", activityAuditeeId: creator.id,
      auditPlanCirculation: "Audit Contributor", status: "Draft", activities,
    };
    const plan = await api("POST", "/plans", admin.token, planInput);
    expect(plan.status, JSON.stringify(plan.json)).toBe(201);
    expect(plan.json.activities).toEqual(activities);
    expect((await api("GET", `/plans/${plan.json.id}`, admin.token)).json.activities).toEqual(activities);
    const overridden = [{ ...activities[0], auditeeId: l2.id, auditeeIds: [l2.id], roleIds: [ownerRole.id] }];
    const modified = await api("PUT", `/plans/${plan.json.id}`, admin.token, { ...planInput, activities: overridden });
    expect(modified.status, JSON.stringify(modified.json)).toBe(200);
    expect(modified.json.activities).toEqual(overridden);
    expect((await api("GET", `/plans/${plan.json.id}`, admin.token)).json.activities).toEqual(overridden);
    expect((await api("PUT", `/schedules/${scheduleId}`, admin.token, { ...scheduleInput, activityRoleAssignments: [] })).json.activityRoleAssignments).toEqual([]);
    } finally {
      await db.delete(auditUserWorkspaceRoles).where(and(
        eq(auditUserWorkspaceRoles.organizationId, orgId), eq(auditUserWorkspaceRoles.userId, creator.id),
        eq(auditUserWorkspaceRoles.workspaceRoleId, ownerRole.id),
      ));
    }
  });
  it("shows a newest-first, paginated schedule history including deleted child events without raw private snapshots", async () => {
    const created = await api("POST", "/programmes", creator.token, {
      title: "Activity history fixture", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    expect(created.status).toBe(201);
    const child = await addChild(created.json.id);
    await db.insert(auditAuditLogEntries).values({
      organizationId: orgId, actorId: creator.id, entityType: "audit_schedule", entityId: child.id, action: "update",
      before: { title: "Old title" }, after: { ...child, title: "New title", objectPath: "PRIVATE_PATH", _requestIp: "PRIVATE_IP" },
      createdAt: new Date("2020-01-01T12:00:00Z"),
    });
    expect((await api("DELETE", `/schedules/${child.id}`, creator.token)).status).toBe(204);
    const history = await api("GET", `/programmes/${created.json.id}/activity?limit=100`, creator.token);
    expect(history.status).toBe(200);
    expect(history.json.items.map((row: { action: string }) => row.action)).toEqual(["delete", "create", "update"]);
    expect(history.json.items[0].actorName).toBe("Programme Creator");
    expect(history.json.items[0].status).toBe("deleted");
    expect(history.json.items[0].changes).toEqual([]);
    expect(JSON.stringify(history.json)).not.toMatch(/PRIVATE_/);
    expect((await api("GET", `/schedules/${child.id}/activity`, creator.token)).status).toBe(200);
    expect((await api("GET", `/schedules/${created.json.id}/activity`, creator.token)).status).toBe(404);
    expect((await api("GET", `/programmes/${child.id}/activity`, creator.token)).status).toBe(404);
    expect((await api("GET", "/schedules/not-a-uuid/activity", creator.token)).status).toBe(422);
    expect((await api("GET", `/programmes/${created.json.id}/activity?page=abc`, creator.token)).status).toBe(422);
    expect((await api("GET", `/programmes/${created.json.id}/activity?page=1.5`, creator.token)).status).toBe(422);
    expect((await api("GET", `/programmes/${created.json.id}/activity?limit=201`, creator.token)).status).toBe(422);
    const first = await api("GET", `/programmes/${created.json.id}/activity?page=1&limit=1`, creator.token);
    const second = await api("GET", `/programmes/${created.json.id}/activity?page=2&limit=1`, creator.token);
    expect(first.json.total).toBe(3);
    expect(first.json.items[0].id).not.toBe(second.json.items[0].id);
    expect(new Date(first.json.items[0].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(second.json.items[0].occurredAt).getTime());
    // History has no client-editable or deletable endpoint.
    expect((await fetch(`${baseUrl}/programmes/${created.json.id}/activity`, {
      method: "DELETE", headers: { authorization: `Bearer ${creator.token}` },
    })).status).toBe(404);
  });
  it("enforces dated activities on saves, stale replay, share, first handoff and Audit range edits", async () => {
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Date invariant programme", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    const child = await addChild(programme.json.id);
    const [workspaceRole] = await db.select().from(auditWorkspaceRoles).where(and(
      eq(auditWorkspaceRoles.organizationId, orgId), eq(auditWorkspaceRoles.name, "Audit Contributor"),
    ));
    const payload = {
      id: crypto.randomUUID(), scheduleId: child.id, auditFeasible: true, auditTitle: child.title,
      leadAuditorId: creator.id, teamMemberIds: [creator.id], auditeeId: creator.id,
      auditeeRoleIds: [workspaceRole!.id], circulationRoleIds: [workspaceRole!.id],
      qaqcScope: "ISO 9001", auditTypes: ["Quality Internal Process Audit"], auditLanguage: "Verbal: English\nWriting: English",
      qaqcReference: "QAM-IA/26-", startDateTime: "2026-01-01T00:00", endDateTime: "2026-01-02T23:59:59",
      openingMeetingDateTime: "2026-01-01T08:00", closingMeetingDateTime: "2026-01-02T23:59",
      activitySection: "General Requirement", activityRemarks: "Review", activityAuditeeId: creator.id,
      auditPlanCirculation: "Audit Contributor", status: "Draft",
      activities: [
        { id: crypto.randomUUID(), section: "General Requirement", remarks: "Review", auditeeId: creator.id,
          plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" },
        { id: crypto.randomUUID(), section: "Design", remarks: "Design review", auditeeId: creator.id,
          plannedStartDateTime: "2026-01-02T22:00", plannedEndDateTime: "2026-01-02T23:59:59" },
      ],
    };
    for (const end of ["", "invalid", "2026-01-03T00:00", "2026-01-02T21:00"]) {
      const invalid = await api("POST", "/plans", creator.token, { ...payload,
        activities: [payload.activities[0], { ...payload.activities[1], plannedEndDateTime: end }] });
      expect(invalid.status, JSON.stringify(invalid.json)).toBe(422);
      expect(invalid.json.error).toContain("Activity 2 Planned End");
    }
    const created = await api("POST", "/plans", creator.token, payload);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json.activities).toEqual(payload.activities);
    const reopened = await api("GET", `/plans/${payload.id}`, creator.token);
    expect(reopened.json.activities).toEqual(payload.activities);
    const changedSecondRow = { ...payload, activities: [payload.activities[0],
      { ...payload.activities[1], plannedEndDateTime: "2026-01-02T23:58" }] };
    expect((await api("POST", "/plans", creator.token, payload)).status).toBe(200);
    const conflictingReplay = await api("POST", "/plans", creator.token, changedSecondRow);
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.json.error).toContain("already saved with different planned data");
    expect((await api("GET", `/plans/${payload.id}`, creator.token)).json.activities).toEqual(payload.activities);
    const appliedCorrection = await api("PUT", `/plans/${payload.id}`, creator.token, changedSecondRow);
    expect(appliedCorrection.status).toBe(200);
    expect(appliedCorrection.json.activities[1].plannedEndDateTime).toBe("2026-01-02T23:58");
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, payload)).status).toBe(200);
    for (const fieldKey of ["activityPlannedEndDateTime", "activityDateTime"]) {
      await writeFieldControls(orgId, "audit", { plan: { [fieldKey]: { access: "read_only", requirement: "optional" } } });
      expect((await api("PUT", `/plans/${payload.id}`, creator.token, changedSecondRow)).status).toBe(422);
      expect((await api("PUT", `/plans/${payload.id}`, creator.token, payload)).status).toBe(200);
    }
    await writeFieldControls(orgId, "audit", {});
    await db.insert(moduleFieldSettings).values({
      organizationId: orgId, module: "audit", formKey: "plan", fieldKey: "activityPlannedEndDateTime", access: "read_only",
    });
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, changedSecondRow)).status).toBe(422);
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, payload)).status).toBe(200);
    await db.delete(moduleFieldSettings).where(eq(moduleFieldSettings.organizationId, orgId));
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, { ...payload,
      closingMeetingDateTime: "2026-01-03T00:00" })).status).toBe(422);
    const editSchedule = await api("GET", `/schedules/${child.id}`, creator.token);
    const incompatible = await api("PUT", `/schedules/${child.id}`, creator.token, {
      ...editSchedule.json, plannedEndDate: "2026-01-01",
    });
    expect(incompatible.status).toBe(409);
    expect(incompatible.json.error).toContain("linked Audit Plan");
    const blockedReschedule = await api("POST", `/schedules/${child.id}/feasibility`, creator.token, {
      decision: "reschedule", feedback: "Must not truncate the plan", fromDate: "2026-01-01", toDate: "2026-01-01",
    });
    expect(blockedReschedule.status).toBe(409);
    const [stored] = await db.select().from(auditPlans).where(eq(auditPlans.id, payload.id));
    const meta = JSON.parse(stored!.status!);
    await db.update(auditPlans).set({ status: JSON.stringify({ ...meta, activities: meta.activities.map((row: object) =>
      ({ ...row, plannedEndDateTime: "2026-01-03T00:00" })) }) }).where(eq(auditPlans.id, payload.id));
    expect((await api("POST", `/plans/${payload.id}/share`, creator.token)).status).toBe(422);
    expect((await api("POST", `/plans/${payload.id}/send-for-audit`, creator.token, { roleIds: [workspaceRole!.id] })).status).toBe(422);
    expect((await api("POST", "/plans", creator.token, payload)).status).toBe(422);
    await db.update(auditPlans).set({ status: stored!.status }).where(eq(auditPlans.id, payload.id));
    const first = await api("POST", `/plans/${payload.id}/send-for-audit`, creator.token, { roleIds: [workspaceRole!.id] });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const retry = await api("POST", `/plans/${payload.id}/send-for-audit`, creator.token, { roleIds: [] });
    expect(retry.json.id).toBe(first.json.id);
    // Historical undated rows stay readable; a saved shared timestamp is explicit derived data.
    await db.update(auditPlans).set({ workflowState: "draft", status: JSON.stringify({ ...meta,
      activityDateTime: "2025-12-31T09:00", activities: meta.activities.map(({ plannedStartDateTime: _start, plannedEndDateTime: _end, ...row }: any) => row),
    }) }).where(eq(auditPlans.id, payload.id));
    const legacy = await api("GET", `/plans/${payload.id}`, creator.token);
    expect(legacy.json.activities[0].legacyDateTimeDerived).toBe(true);
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, legacy.json)).status).toBe(422);
    expect((await api("PUT", `/plans/${payload.id}`, creator.token, payload)).status).toBe(200);
  });
  it("offers only active Product / Process Owner users and enforces that selection on Audit Schedules", async () => {
    const marker = await permission("product_process_owner");
    const ownerRole = await role("Product and Process Owners", [marker.id]);
    await assign(l1.id, ownerRole.id);
    const owners = await api("GET", "/process-product-owners", creator.token);
    expect(owners.status).toBe(200);
    expect(owners.json).toEqual(expect.arrayContaining([expect.objectContaining({ id: l1.id, fullName: "L1 Approver" })]));
    expect(owners.json.some((user: { id: string }) => user.id === creator.id)).toBe(false);

    const payload = {
      id: crypto.randomUUID(), year: 2026, title: "Owner assignment", projectIds: [],
      auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: "Quality Department", plannedStartDate: "2026-06-01",
      plannedEndDate: "2026-06-02", workflowState: "Draft",
    };
    const unassigned = await api("POST", "/schedules", creator.token, {
      ...payload, processProductOwner: "Programme Creator",
    });
    expect(unassigned.status).toBe(422);
    const created = await api("POST", "/schedules", creator.token, {
      ...payload, processProductOwner: "L1 Approver",
    });
    expect(created.status).toBe(201);
    expect(created.json.processProductOwner).toBe("L1 Approver");
    const changed = await api("PUT", `/schedules/${created.json.id}`, creator.token, {
      ...created.json, processProductOwner: "Programme Creator",
    });
    expect(changed.status).toBe(422);

    await db.update(auditWorkspaceRoles).set({ status: "inactive" }).where(eq(auditWorkspaceRoles.id, ownerRole.id));
    expect((await api("GET", "/process-product-owners", creator.token)).json).toEqual([]);
    const legacyEdit = await api("PUT", `/schedules/${created.json.id}`, creator.token, {
      ...created.json, title: "Existing owner preserved",
    });
    expect(legacyEdit.status).toBe(200);
    expect(legacyEdit.json.processProductOwner).toBe("L1 Approver");
  });
  it("keeps field 9 unique by department and assigns field 8 in From Date order on submission", async () => {
    const settings = {
      qaqcReference: { prefix: "QAM-IA/", start: 1, end: 3 },
      auditNumber: { prefix: "AUD-", start: 5, end: 6 },
    };
    expect((await api("PUT", "/admin/schedule-numbering", admin.token, settings)).status).toBe(200);
    expect((await api("GET", "/admin/schedule-numbering", admin.token)).json).toEqual(settings);
    expect((await api("PUT", "/admin/schedule-numbering", admin.token, {
      ...settings, qaqcReference: { ...settings.qaqcReference, start: 2 },
    })).status).toBe(422);
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Ordered references", fromDate: "2026-01-01", toDate: "2027-12-31",
    });
    const payload = (title: string, date: string, department: string) => ({
      id: crypto.randomUUID(), parentId: programme.json.id, year: Number(date.slice(0, 4)), title,
      projectIds: [], auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: department, plannedStartDate: date, plannedEndDate: date,
      qaqcReference: "tampered", auditNumber: "tampered", workflowState: "Draft",
    });
    const laterPayload = payload("Later", "2027-01-15", "Quality Department");
    const later = await api("POST", "/schedules", creator.token, laterPayload);
    const first = await api("POST", "/schedules", creator.token, payload("First", "2026-12-10", "Quality Department"));
    expect([later.status, first.status]).toEqual([201, 201]);
    expect(later.json.auditNumber).toBe("AUD-005");
    expect(first.json.auditNumber).toBe("AUD-006");
    expect(first.json.qaqcReference).toBe("");
    const retry = await api("POST", "/schedules", creator.token, laterPayload);
    expect(retry.status).toBe(201);
    expect(retry.json.auditNumber).toBe(later.json.auditNumber);
    const edited = await api("PUT", `/schedules/${first.json.id}`, creator.token, {
      ...first.json, title: "Edited first", auditNumber: "tampered", qaqcReference: "tampered",
    });
    expect(edited.status).toBe(200);
    expect(edited.json.auditNumber).toBe("AUD-006");
    expect(edited.json.qaqcReference).toBe("");
    const exhausted = await api("POST", "/schedules", creator.token, payload("Overflow", "2026-09-01", "Quality Department"));
    expect(exhausted.status).toBe(409);
    const submitted = await api("POST", `/programmes/${programme.json.id}/submit`, creator.token, {
      subject: "Ordered references", mailBody: "Please review.",
    });
    expect(submitted.status).toBe(200);
    expect((await api("GET", `/schedules/${first.json.id}`, creator.token)).json.qaqcReference).toBe("QAM-IA/26-001");
    expect((await api("GET", `/schedules/${later.json.id}`, creator.token)).json.qaqcReference).toBe("QAM-IA/27-002");
    expect((await api("GET", `/schedules/${later.json.id}`, creator.token)).json.auditNumber).toBe("AUD-005");
    // Restore defaults so the range limit does not affect unrelated workflow tests.
    expect((await api("PUT", "/admin/schedule-numbering", admin.token, {
      qaqcReference: { prefix: "QAM-IA/", start: 1, end: 999 },
      auditNumber: { prefix: "AUD-", start: 1, end: 999 },
    })).status).toBe(200);
    // A programme that has already been approved cannot be submitted again.
    // A later addition still needs a reference rather than remaining blank.
    await db.update(auditSchedules).set({ workflowState: "approved" })
      .where(eq(auditSchedules.id, programme.json.id));
    const added = await api("POST", "/schedules", creator.token,
      payload("After approval", "2027-11-01", "Quality Department"));
    expect(added.status).toBe(201);
    expect(added.json.qaqcReference).toBe("QAM-IA/27-003");
    expect(added.json.auditNumber).toBe("AUD-007");
  });
  it("lists the two programmes awaiting an approver who has review access but no edit grant", async () => {
    const [project] = await db.insert(projects).values({
      organizationId: orgId, code: `AQ-${orgId.slice(0, 6)}`, name: "Action queue project",
    }).returning();
    const programmeIds: string[] = [];
    for (const title of ["First review", "Second review"]) {
      const programme = await api("POST", "/programmes", creator.token, {
        title, fromDate: "2026-01-01", toDate: "2026-12-31",
      });
      expect(programme.status).toBe(201);
      programmeIds.push(programme.json.id);
      await db.insert(auditSchedules).values({
        organizationId: orgId, year: 2026, title: `${title} child`,
        workflowState: "submitted", projectId: project!.id,
        status: JSON.stringify({ parentId: programme.json.id, projectIds: [project!.id], plannedStartDate: "2026-10-01" }),
      });
      const [l2Role] = await db.select({ id: auditWorkspaceRoles.id }).from(auditWorkspaceRoles)
        .where(and(eq(auditWorkspaceRoles.organizationId, orgId), eq(auditWorkspaceRoles.name, "L2 Programme Approver")));
      await db.update(auditSchedules).set({
        workflowState: "submitted",
        status: JSON.stringify({ programme: true, approvalRoles: [{ id: l2Role!.id, name: "L2 Programme Approver" }], approvalIndex: 0 }),
      }).where(eq(auditSchedules.id, programme.json.id));
    }
    const pending = await api("GET", "/my-actions?limit=200", l2.token);
    expect(pending.status).toBe(200);
    for (const id of programmeIds) {
      expect(pending.json.items).toContainEqual(expect.objectContaining({
        kind: "programme", id, action: "Review", href: `/audit/schedules/${id}`,
      }));
    }
    const notAssigned = await api("GET", "/my-actions?limit=200", l1.token);
    expect(notAssigned.json.items.filter((item: { id: string }) => programmeIds.includes(item.id))).toEqual([]);
  });

  it("requires eligible selected Audit Team Leads and limits a plan's Lead / Internal Auditor to them", async () => {
    const options = await api("GET", "/team-leads", creator.token);
    expect(options.status).toBe(200);
    expect(options.json.map((user: { id: string }) => user.id)).toContain(creator.id);
    expect(options.json.map((user: { id: string }) => user.id)).not.toContain(l2.id);
    const details = { title: "Lead selection programme", fromDate: "2026-01-01", toDate: "2026-12-31" };
    expect((await api("POST", "/programmes", creator.token, { ...details, teamLeadIds: [] })).status).toBe(422);
    expect((await api("POST", "/programmes", creator.token, { ...details, teamLeadIds: [l2.id] })).status).toBe(422);
    const created = await api("POST", "/programmes", creator.token, { ...details, teamLeadIds: [creator.id] });
    expect(created.status).toBe(201);
    expect(created.json.teamLeadIds).toEqual([creator.id]);
    expect(created.json.teamLeadNames).toEqual(["Programme Creator"]);
    const savedDetails = await api("GET", `/programmes/${created.json.id}`, creator.token);
    expect(savedDetails.json).toMatchObject({
      title: details.title, teamLeadIds: [creator.id], teamLeadNames: ["Programme Creator"],
    });
    expect(savedDetails.json.fromDate.slice(0, 10)).toBe(details.fromDate);
    expect(savedDetails.json.toDate.slice(0, 10)).toBe(details.toDate);
    const programmeList = await api("GET", "/programmes", creator.token);
    expect(programmeList.json.items.find((item: { id: string }) => item.id === created.json.id)?.teamLeadNames).toEqual(["Programme Creator"]);
    const child = await addChild(created.json.id);
    const schedules = await api("GET", `/schedules?parentId=${created.json.id}`, creator.token);
    expect(schedules.json.items.find((item: { id: string }) => item.id === child.id)?.teamLeadIds).toEqual([creator.id]);
    expect((await api("GET", `/schedules/${child.id}`, creator.token)).json.teamLeadIds).toEqual([creator.id]);
    const planPayload = {
      id: crypto.randomUUID(), scheduleId: child.id, auditFeasible: true, auditTitle: child.title,
      leadAuditorId: l2.id, teamMemberIds: [creator.id], auditeeId: creator.id,
      auditeeRoleIds: [(await db.select({ id: auditWorkspaceRoles.id }).from(auditWorkspaceRoles)
        .where(and(eq(auditWorkspaceRoles.organizationId, orgId), eq(auditWorkspaceRoles.name, "Audit Contributor"))))[0]!.id],
      qaqcScope: "ISO 9001", auditTypes: ["Quality Internal Process Audit"],
      auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "QAM-IA/26-",
      startDateTime: "2026-01-01T08:00:00.000Z", endDateTime: "2026-01-01T16:00:00.000Z",
      openingMeetingDateTime: "2026-01-01T08:00:00.000Z", closingMeetingDateTime: "2026-01-01T15:30:00.000Z",
      activitySection: "General Requirement", activityRemarks: "Review controls", activityAuditeeId: creator.id,
      activityDateTime: "2026-01-01T09:00:00.000Z", auditPlanCirculation: "Programme Creator", status: "Draft",
      activities: [{ id: crypto.randomUUID(), section: "General Requirement", remarks: "Review controls", auditeeId: creator.id,
        plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" }],
    };
    await db.update(auditSchedules).set({
      status: JSON.stringify({
        ...JSON.parse(child.status ?? "{}"), qaqcScope: planPayload.qaqcScope,
        auditTypes: planPayload.auditTypes, qaqcReference: planPayload.qaqcReference,
      }),
    }).where(eq(auditSchedules.id, child.id));
    const invalidPlan = await api("POST", "/plans", creator.token, planPayload);
    expect(invalidPlan.status).toBe(422);
    expect(invalidPlan.json.error).toMatch(/selected when the schedule was created/);
    const observerRole = await role("Circulation Observers", []);
    const circulationRoleIds = [planPayload.auditeeRoleIds[0], observerRole.id];
    // Explicit per-activity dates supersede the shared legacy timestamp.
    for (const key of ["startDateTime", "endDateTime", "openingMeetingDateTime", "closingMeetingDateTime"]) {
      for (const value of ["2025-12-31T23:59:00.000Z", "2026-01-03T00:00:00.000Z"]) {
        const outOfRange = await api("POST", "/plans", creator.token, {
          ...planPayload, id: crypto.randomUUID(), leadAuditorId: creator.id, circulationRoleIds, [key]: value,
        });
        expect(outOfRange.status).toBe(422);
        expect(outOfRange.json.error).toContain("01/01/2026 to 02/01/2026");
      }
    }
    const validPlan = await api("POST", "/plans", creator.token, {
      ...planPayload, id: crypto.randomUUID(), leadAuditorId: creator.id,
      circulationRoleIds,
    });
    expect(validPlan.status).toBe(201);
    for (const key of ["startDateTime", "endDateTime", "openingMeetingDateTime", "closingMeetingDateTime"]) {
      const outOfRangeEdit = await api("PUT", `/plans/${validPlan.json.id}`, creator.token, {
        ...validPlan.json, [key]: "2026-01-03T00:00:00.000Z",
      });
      expect(outOfRangeEdit.status).toBe(422);
      expect(outOfRangeEdit.json.error).toContain("01/01/2026 to 02/01/2026");
    }
    expect((await api("GET", `/plans/${validPlan.json.id}`, creator.token)).json.startDateTime).toBe(planPayload.startDateTime);
    expect(validPlan.json.leadAuditorId).toBe(creator.id);
    expect(validPlan.json.circulationRoleIds).toEqual(circulationRoleIds);
    expect(validPlan.json.auditPlanCirculation).toBe("Audit Contributor, Circulation Observers");
    const reopenedPlan = await api("GET", `/plans/${validPlan.json.id}`, creator.token);
    expect(reopenedPlan.json.circulationRoleIds).toEqual(circulationRoleIds);
    const emptyCirculation = await api("PUT", `/plans/${validPlan.json.id}`, creator.token, {
      ...validPlan.json, circulationRoleIds: [],
    });
    expect(emptyCirculation.status).toBe(422);
    const invalidCirculation = await api("PUT", `/plans/${validPlan.json.id}`, creator.token, {
      ...validPlan.json, circulationRoleIds: [crypto.randomUUID()],
    });
    expect(invalidCirculation.status).toBe(422);
    const editedPlan = await api("PUT", `/plans/${validPlan.json.id}`, creator.token, {
      ...validPlan.json, circulationRoleIds: [observerRole.id],
    });
    expect(editedPlan.status, JSON.stringify(editedPlan.json)).toBe(200);
    expect(editedPlan.json.circulationRoleIds).toEqual([observerRole.id]);
    expect(editedPlan.json.auditPlanCirculation).toBe("Circulation Observers");
    expect((await api("GET", `/plans/${validPlan.json.id}`, creator.token)).json.circulationRoleIds).toEqual([observerRole.id]);
    const legacyEditPayload = { ...editedPlan.json };
    delete legacyEditPayload.circulationRoleIds;
    const legacyEdit = await api("PUT", `/plans/${validPlan.json.id}`, creator.token, legacyEditPayload);
    expect(legacyEdit.status).toBe(200);
    expect(legacyEdit.json.circulationRoleIds).toEqual([observerRole.id]);

    const managerPermission = await permission("audit_program_manager");
    const managerRole = await role("Audit Program Managers", [managerPermission.id]);
    await assign(l2.id, managerRole.id);
    const secondLeadRole = await role("Additional Audit Team Lead", [(await permission("audit_team_lead")).id]);
    await assign(l1.id, secondLeadRole.id);
    const path = `/programmes/${created.json.id}/team-leads`;
    expect(await api("PATCH", path, l2.token, { teamLeadIds: [creator.id, l1.id] })).toMatchObject({ status: 409 });
    expect((await api("GET", `/programmes/${created.json.id}`, l2.token)).json.canManageTeamLeads).toBe(false);
    await db.update(auditSchedules).set({ workflowState: "approved" }).where(eq(auditSchedules.id, created.json.id));
    expect((await api("GET", `/programmes/${created.json.id}`, creator.token)).json.canManageTeamLeads).toBe(false);
    expect((await api("GET", `/programmes/${created.json.id}`, l2.token)).json.canManageTeamLeads).toBe(true);
    expect((await api("PATCH", path, creator.token, { teamLeadIds: [creator.id, l1.id] })).status).toBe(403);
    expect((await api("PATCH", path, l2.token, { teamLeadIds: [] })).status).toBe(422);
    expect((await api("PATCH", path, l2.token, { teamLeadIds: [creator.id, l2.id] })).status).toBe(422);
    const added = await api("PATCH", path, l2.token, { teamLeadIds: [creator.id, l1.id] });
    expect(added.status).toBe(200);
    expect(added.json.teamLeadNames).toEqual(["Programme Creator", "L1 Approver"]);
    expect((await api("PATCH", path, l2.token, { teamLeadIds: [l1.id] })).status).toBe(409);
    const removed = await api("PATCH", path, l2.token, { teamLeadIds: [creator.id] });
    expect(removed.status).toBe(200);
    expect(removed.json.teamLeadIds).toEqual([creator.id]);
    expect((await api("GET", `/schedules/${child.id}`, creator.token)).json.teamLeadIds).toEqual([creator.id]);
    await db.update(auditWorkspaceRoles).set({ status: "inactive" }).where(eq(auditWorkspaceRoles.id, managerRole.id));
    expect((await api("PATCH", path, l2.token, { teamLeadIds: [creator.id, l1.id] })).status).toBe(403);
  });
  it("enforces user assignment visibility and all-child programme scope before serving private signatories", async () => {
    const [projectA, projectB] = await db.insert(projects).values([
      { organizationId: orgId, code: `SA-${orgId.slice(0, 6)}`, name: "Scope A" },
      { organizationId: orgId, code: `SB-${orgId.slice(0, 6)}`, name: "Scope B" },
    ]).returning();
    const view = await permission("view_all");
    const adminRole = await role("Audit Scoped Administrator", [view.id]);
    const memberRole = await role("Audit Scoped Member", [view.id]);
    const createScopedUser = async (name: string) => {
      const [row] = await db.insert(users).values({
        organizationId: orgId, email: `${name.toLowerCase().replaceAll(" ", ".")}@scope.test.invalid`,
        username: `${name.toLowerCase().replaceAll(" ", ".")}`, fullName: name,
      }).returning();
      return row!;
    };
    const scopedAdmin = await createScopedUser("Scoped Admin");
    const inScopeTarget = await createScopedUser("In Scope Target");
    const outOfScopeTarget = await createScopedUser("Out Scope Target");
    await assignScope(scopedAdmin.id, adminRole.id, [projectA!.id]);
    await assignScope(inScopeTarget.id, memberRole.id, [projectA!.id]);
    await assignScope(outOfScopeTarget.id, memberRole.id, [projectB!.id]);
    await db.update(users).set({ signaturePath: "gcs:must-not-be-read" }).where(eq(users.id, outOfScopeTarget.id));
    await db.insert(applicationAccess).values({ organizationId: orgId, username: scopedAdmin.username, canOpenAudit: true });
    const scopedToken = issueToken(scopedAdmin);

    const forbiddenProfile = await api("PUT", `/admin/users/${outOfScopeTarget.id}/profile`, scopedToken, { designation: "Changed" });
    expect(forbiddenProfile.status).toBe(403);
    const [unchangedTarget] = await db.select().from(users).where(eq(users.id, outOfScopeTarget.id));
    expect(unchangedTarget?.designation).toBeNull();
    expect(unchangedTarget?.signaturePath).toBe("gcs:must-not-be-read");
    const forbiddenSignature = await api("GET", `/admin/users/${outOfScopeTarget.id}/signature`, scopedToken);
    expect(forbiddenSignature.status).toBe(403);
    await db.update(users).set({ signaturePath: null }).where(eq(users.id, outOfScopeTarget.id));
    expect((await api("GET", `/admin/users/${outOfScopeTarget.id}/signature`, scopedToken)).status).toBe(403);
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      const invalidImage = await api("PUT", `/admin/users/${inScopeTarget.id}/profile`, scopedToken, {
        signatureDataUrl: `data:${mime};base64,AAAA`,
      });
      expect(invalidImage.status).toBe(422);
    }

    const programme = await api("POST", "/programmes", creator.token, {
      title: "Mixed-scope programme", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    for (const [projectId, title] of [[projectA!.id, "Visible child"], [projectB!.id, "Hidden child"]]) {
      const [child] = await db.insert(auditSchedules).values({
        organizationId: orgId, year: 2026, title, ownerId: creator.id, workflowState: "draft",
        status: JSON.stringify({ parentId: programme.json.id, projectIds: [projectId], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" }),
      }).returning();
      await db.insert(auditAuditLogEntries).values({
        organizationId: orgId, actorId: creator.id, entityType: "audit_schedule", entityId: child!.id,
        action: "create", after: child!,
      });
    }
    const scopedHistory = await api("GET", `/programmes/${programme.json.id}/activity`, scopedToken);
    expect(scopedHistory.status).toBe(200);
    expect(scopedHistory.json.items.some((entry: { recordTitle: string }) => entry.recordTitle === "Visible child")).toBe(true);
    expect(JSON.stringify(scopedHistory.json)).not.toContain("Hidden child");
    expect((await api("GET", `/programmes/${programme.json.id}/signatories`, scopedToken)).status).toBe(403);
    const organizationAdminResult = await api("GET", `/programmes/${programme.json.id}/signatories`, admin.token);
    expect(organizationAdminResult.status).toBe(200);
    expect(organizationAdminResult.json.preparedBy.userId).toBe(creator.id);
  });

  it("creates a programme and rejects submitting it without a child", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "2026 Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(created.status).toBe(201);
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Empty programme", mailBody: "Please review this audit schedule." });
    expect(submitted.status).toBe(422);
  });

  it("validates approval role levels on create and update without changing roles or permissions", async () => {
    const approvalPermissions = [
      { key: "approve_reject", name: "Approve / reject" },
      { key: "view_all", name: "View all" },
    ];
    const initialRoles = await api("GET", "/admin/roles", admin.token);
    const contributor = initialRoles.json.items.find((item: { name: string }) => item.name === "Audit Contributor");
    expect(contributor).toBeTruthy();
    const initialContributor = {
      roleAuthorizationLevel: contributor.roleAuthorizationLevel,
      permissions: contributor.permissions,
    };
    const invalidLevels: Array<number | undefined> = [undefined, 1.5, 0, 2147483648];

    for (const level of invalidLevels) {
      const name = `Invalid Approval Role ${String(level ?? "missing")}`;
      const body = {
        id: crypto.randomUUID(), name, roleAuthorizationLevel: level, active: true,
        permissions: approvalPermissions,
      };
      const created = await api("POST", "/admin/roles", admin.token, body);
      expect(created.status).toBe(422);
      const rolesAfterCreate = await api("GET", "/admin/roles", admin.token);
      expect(rolesAfterCreate.json.items.some((item: { name: string }) => item.name === name)).toBe(false);

      const updated = await api("PUT", `/admin/roles/${contributor.id}`, admin.token, {
        ...body, id: contributor.id, name: contributor.name,
      });
      expect(updated.status).toBe(422);
      const rolesAfterUpdate = await api("GET", "/admin/roles", admin.token);
      const unchanged = rolesAfterUpdate.json.items.find((item: { id: string }) => item.id === contributor.id);
      expect(unchanged).toMatchObject(initialContributor);
    }
  });

  it("roundtrips approval levels and clears the level when approval permission is removed", async () => {
    const created = await api("POST", "/admin/roles", admin.token, {
      id: crypto.randomUUID(),
      name: "Level Seven Approval Role",
      description: "Explicit approval level",
      roleAuthorizationLevel: 7,
      permissions: [{ key: "approve_reject", name: "Approve / reject" }],
      active: true,
    });
    expect(created.status).toBe(201);
    expect(created.json.roleAuthorizationLevel).toBe(7);

    const listed = await api("GET", "/admin/roles", admin.token);
    expect(listed.json.items.find((item: { id: string }) => item.id === created.json.id).roleAuthorizationLevel).toBe(7);

    const nonApproval = await api("POST", "/admin/roles", admin.token, {
      id: crypto.randomUUID(),
      name: "No Approval Level Required",
      permissions: [{ key: "view_all", name: "View all" }],
      active: true,
    });
    expect(nonApproval.status).toBe(201);
    expect(nonApproval.json.roleAuthorizationLevel).toBeNull();

    const cleared = await api("PUT", `/admin/roles/${created.json.id}`, admin.token, {
      id: created.json.id,
      name: created.json.name,
      description: created.json.description,
      permissions: [{ key: "view_all", name: "View all" }],
      active: true,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.json.roleAuthorizationLevel).toBeNull();
  });

  it("preserves the order of existing L-number approver roles when their levels have not been migrated", async () => {
    const approve = await permission("approve_reject");
    const legacy = await role("Legacy L8 Approver", [approve.id]);
    try {
      expect(legacy.roleAuthorizationLevel).toBeNull();
      const listed = await api("GET", "/admin/roles", admin.token);
      expect(listed.status).toBe(200);
      expect(listed.json.items.find((item: { id: string }) => item.id === legacy.id).roleAuthorizationLevel).toBe(8);
      const [stored] = await db.select({ level: auditWorkspaceRoles.roleAuthorizationLevel })
        .from(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.id, legacy.id));
      expect(stored?.level).toBe(8);
    } finally {
      await db.update(auditWorkspaceRoles).set({ status: "inactive" }).where(eq(auditWorkspaceRoles.id, legacy.id));
    }
  });

  it("uses explicit role levels for programme and schedule snapshots despite role names", async () => {
    const listed = await api("GET", "/admin/roles", admin.token);
    const originalL1 = listed.json.items.find((item: { name: string }) => item.name === "L1 Programme Approver");
    const originalL2 = listed.json.items.find((item: { name: string }) => item.name === "L2 Programme Approver");
    expect(originalL1).toBeTruthy();
    expect(originalL2).toBeTruthy();

    const initialL1 = originalL1!;
    const initialL2 = originalL2!;
    const updateRole = async (role: typeof initialL1, name: string, level: number) => api(
      "PUT", `/admin/roles/${role.id}`, admin.token, {
        id: role.id,
        name,
        description: role.description,
        roleAuthorizationLevel: level,
        permissions: role.permissions,
        active: role.active,
      },
    );
    const submitStandaloneSchedule = async (title: string) => {
      const schedule = await api("POST", "/schedules", creator.token, {
        id: crypto.randomUUID(), year: 2026, title,
        projectIds: [], auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
        departmentProject: "Quality Department", plannedStartDate: "2026-07-01", plannedEndDate: "2026-07-02",
        workflowState: "Draft",
      });
      expect(schedule.status).toBe(201);
      const submitted = await api("POST", `/schedules/${schedule.json.id}/submit`, creator.token, {
        subject: title, mailBody: "Please review this audit.",
      });
      expect(submitted.status).toBe(200);
      return submitted;
    };

    try {
      expect((await updateRole(initialL1, "Zebra Level Two Council", 2)).status).toBe(200);
      expect((await updateRole(initialL2, "Alpha Level One Council", 1)).status).toBe(200);

      const programme = await api("POST", "/programmes", creator.token, {
        title: "Explicit level programme", fromDate: "2026-01-01", toDate: "2026-12-31",
      });
      expect(programme.status).toBe(201);
      await addChild(programme.json.id);
      const submittedProgramme = await api("POST", `/programmes/${programme.json.id}/submit`, creator.token, {
        subject: "Explicit level programme", mailBody: "Please review.",
      });
      expect(submittedProgramme.status).toBe(200);
      expect(submittedProgramme.json.currentApprovalRole).toBe("Alpha Level One Council");
      expect(submittedProgramme.json.currentApproverNames).toEqual(["L2 Approver"]);

      const submittedSchedule = await submitStandaloneSchedule("Explicit level schedule");
      expect(submittedSchedule.json.currentApprovalRole).toBe("Alpha Level One Council");

      // Change the configured order after submission; in-flight items retain their role snapshots.
      expect((await updateRole(initialL1, "Zebra Level Two Council", 1)).status).toBe(200);
      expect((await updateRole(initialL2, "Alpha Level One Council", 2)).status).toBe(200);
      const inFlightProgramme = await api("GET", `/programmes/${programme.json.id}`, creator.token);
      expect(inFlightProgramme.json.currentApprovalRole).toBe("Alpha Level One Council");
      const inFlightSchedule = await api("GET", `/schedules/${submittedSchedule.json.id}`, creator.token);
      expect(inFlightSchedule.json.currentApprovalRole).toBe("Alpha Level One Council");

      const laterProgramme = await api("POST", "/programmes", creator.token, {
        title: "Updated level programme", fromDate: "2026-01-01", toDate: "2026-12-31",
      });
      expect(laterProgramme.status).toBe(201);
      await addChild(laterProgramme.json.id);
      const submittedLaterProgramme = await api("POST", `/programmes/${laterProgramme.json.id}/submit`, creator.token, {
        subject: "Updated level programme", mailBody: "Please review.",
      });
      expect(submittedLaterProgramme.status).toBe(200);
      expect(submittedLaterProgramme.json.currentApprovalRole).toBe("Zebra Level Two Council");
      expect((await submitStandaloneSchedule("Updated level schedule")).json.currentApprovalRole)
        .toBe("Zebra Level Two Council");
    } finally {
      expect((await updateRole(initialL1, initialL1.name, initialL1.roleAuthorizationLevel)).status).toBe(200);
      expect((await updateRole(initialL2, initialL2.name, initialL2.roleAuthorizationLevel)).status).toBe(200);
    }
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
    expect(programmes.json.items.find((item: { id: string }) => item.id === "legacy").currentApproverNames).toEqual([]);
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

  it("blocks child create, tombstone restoration, and new plans while a programme is submitted", async () => {
    const programme = await api("POST", "/programmes", creator.token, {
      title: "Submitted programme guards", fromDate: "2026-01-01", toDate: "2026-12-31",
    });
    const importPayload = {
      id: crypto.randomUUID(), parentId: programme.json.id, year: 2026, title: "Restorable audit",
      projectIds: [], auditTypes: ["Quality Internal Process Audit"], auditCategory: "Internal",
      departmentProject: "Quality Department", plannedStartDate: "2026-04-01", plannedEndDate: "2026-04-02",
      workflowState: "Draft",
    };
    const tombstone = await api("POST", "/schedules", creator.token, importPayload);
    expect(tombstone.status).toBe(201);
    expect((await api("DELETE", `/schedules/${tombstone.json.id}`, creator.token)).status).toBe(204);
    const activeChild = await addChild(programme.json.id);
    const submitted = await api("POST", `/programmes/${programme.json.id}/submit`, creator.token, {
      subject: "Guarded programme", mailBody: "Please review this programme.",
    });
    expect(submitted.status).toBe(200);

    const createBlocked = await api("POST", "/schedules", creator.token, {
      ...importPayload, id: crypto.randomUUID(), title: "New audit",
    });
    expect(createBlocked.status).toBe(409);
    const restoreBlocked = await api("POST", "/schedules", creator.token, importPayload);
    expect(restoreBlocked.status).toBe(409);

    const plan = await api("POST", "/plans", creator.token, {
      id: crypto.randomUUID(), scheduleId: activeChild.id, auditFeasible: true, auditTitle: activeChild.title,
      leadAuditorId: creator.id, teamMemberIds: [creator.id], auditeeId: creator.id,
      qaqcScope: "ISO 9001", auditTypes: ["Quality Internal Process Audit"],
      auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "QAM-IA/26-",
      startDateTime: "2026-01-01T08:00:00.000Z", endDateTime: "2026-01-01T16:00:00.000Z",
      openingMeetingDateTime: "2026-01-01T08:00:00.000Z", closingMeetingDateTime: "2026-01-01T15:30:00.000Z",
      activitySection: "General Requirement", activityRemarks: "Review controls",
      activityAuditeeId: creator.id, activityDateTime: "2026-01-01T09:00:00.000Z",
      auditPlanCirculation: "Programme Creator", status: "Draft",
    });
    expect(plan.status).toBe(409);
  });

  it("snapshots L1/L2 roles and advances sequentially with authorization", async () => {
    const created = await api("POST", "/programmes", creator.token, { title: "Approval Programme", fromDate: "2026-01-01", toDate: "2026-12-31" });
    const existingChild = await addChild(created.json.id);
    const independentlySubmittedChild = await addChild(created.json.id);
    await db.update(auditSchedules).set({
      workflowState: "submitted",
      status: JSON.stringify({ ...JSON.parse(independentlySubmittedChild.status), independentlySubmitted: true }),
    }).where(eq(auditSchedules.id, independentlySubmittedChild.id));
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Approval programme", mailBody: "Please review and approve." });
    expect(submitted.status).toBe(200);
    const submissionEmails = await db.select().from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, orgId), eq(outboundEmails.entityId, created.json.id),
      eq(outboundEmails.eventType, "audit.audit_programme.submit"),
    ));
    expect(submissionEmails.map(row => row.recipientEmail)).toEqual([expect.stringContaining("l1.approver")]);
    expect(submitted.json.submissionSubject).toBe("Approval programme");
    expect(submitted.json.submissionMailBody).toBe("Please review and approve.");
    expect(submitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect(submitted.json.currentApproverNames).toEqual(["L1 Approver"]);
    expect(submitted.json.canReview).toBe(false);
    expect((await api("GET", `/schedules/${existingChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    expect((await api("GET", `/schedules/${independentlySubmittedChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    const [independentRowAfterSubmit] = await db.select().from(auditSchedules).where(eq(auditSchedules.id, independentlySubmittedChild.id));
    expect(JSON.parse(independentRowAfterSubmit!.status)).toMatchObject({ independentlySubmitted: true });
    expect((await api("GET", `/programmes/${created.json.id}`, creator.token)).json.currentApproverNames).toEqual(["L1 Approver"]);
    const pendingSignatories = await api("GET", `/programmes/${created.json.id}/signatories`, creator.token);
    expect(pendingSignatories.status).toBe(200);
    expect(pendingSignatories.json).toMatchObject({
      preparedBy: { userId: creator.id, role: "Audit Contributor", signatureDataUrl: null },
      reviewedBy: [],
      approvedBy: null,
    });
    const [l1List, l2List] = await Promise.all([
      api("GET", "/programmes", l1.token),
      api("GET", "/programmes", l2.token),
    ]);
    expect(l1List.json.items.find((item: { id: string }) => item.id === created.json.id)).toMatchObject({
      canReview: true, currentApproverNames: ["L1 Approver"],
    });
    expect(l2List.json.items.find((item: { id: string }) => item.id === created.json.id).canReview).toBe(false);
    expect((await api("POST", `/programmes/${created.json.id}/review`, admin.token, { decision: "approve" })).status).toBe(403);
    const blocked = await api("POST", `/programmes/${created.json.id}/review`, creator.token, { decision: "approve" });
    expect(blocked.status).toBe(403);
    const first = await api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" });
    expect(first.status).toBe(200);
    const nextLevelEmails = await db.select().from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, orgId), eq(outboundEmails.entityId, created.json.id),
      eq(outboundEmails.eventType, "audit.audit_programme.approve"),
    ));
    expect(nextLevelEmails.map(row => row.recipientEmail)).toEqual([expect.stringContaining("l2.approver")]);
    expect(first.json.currentApprovalRole).toBe("L2 Programme Approver");
    expect(first.json.currentApproverNames).toEqual(["L2 Approver"]);
    expect(first.json.canReview).toBe(false);
    const partiallyReviewedSignatories = await api("GET", `/programmes/${created.json.id}/signatories`, creator.token);
    expect(partiallyReviewedSignatories.json.reviewedBy).toEqual([
      { userId: l1.id, name: "L1 Approver", designation: null, role: "L1 Programme Approver", signatureDataUrl: null },
    ]);
    expect(partiallyReviewedSignatories.json.approvedBy).toBeNull();
    const sentBack = await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "send_back", comments: "Please revise and resubmit." });
    expect(sentBack.status).toBe(200);
    const sendBackEmails = await db.select().from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, orgId), eq(outboundEmails.entityId, created.json.id),
      eq(outboundEmails.eventType, "audit.audit_programme.send_back"),
    ));
    expect(sendBackEmails).toHaveLength(1);
    expect(sendBackEmails[0]!.recipientEmail).toContain("programme.creator");
    expect(sendBackEmails[0]!.ccRecipients.map(recipient => recipient.email).sort()).toEqual([
      expect.stringContaining("l1.approver"), expect.stringContaining("l2.approver"),
    ]);
    expect(sendBackEmails[0]!.bodyText).toContain("Please revise and resubmit.");
    expect(sentBack.json.workflowState).toBe("Sent Back");
    expect(sentBack.json.currentApprovalRole).toBeNull();
    expect(sentBack.json.currentApproverNames).toEqual([]);
    expect(sentBack.json.canReview).toBe(false);
    expect((await api("GET", `/schedules/${existingChild.id}`, creator.token)).json.workflowState).toBe("Draft");
    expect((await api("GET", `/schedules/${independentlySubmittedChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    const newlyDraftChild = await addChild(created.json.id);
    const creatorList = await api("GET", "/programmes", creator.token);
    expect(creatorList.json.items.find((item: { id: string }) => item.id === created.json.id).canSubmit).toBe(true);
    const resubmitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Revised approval programme", mailBody: "The requested revisions are complete." });
    expect(resubmitted.status).toBe(200);
    const submissionEmailsAfterResubmit = await db.select().from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, orgId), eq(outboundEmails.entityId, created.json.id),
      eq(outboundEmails.eventType, "audit.audit_programme.submit"),
    ));
    expect(submissionEmailsAfterResubmit).toHaveLength(2);
    expect(submissionEmailsAfterResubmit.filter(row =>
      row.recipientEmail.includes("l1.approver")
      && row.subject === "Revised approval programme"
      && row.bodyText.includes("The requested revisions are complete.")
    )).toHaveLength(1);
    expect(resubmitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect(resubmitted.json.currentApproverNames).toEqual(["L1 Approver"]);
    expect((await api("GET", `/schedules/${existingChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    expect((await api("GET", `/schedules/${newlyDraftChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    expect((await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" })).status).toBe(409);
    expect((await api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" })).status).toBe(200);
    const second = await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" });
    expect(second.status).toBe(200);
    expect(second.json.workflowState).toBe("Approved");
    const finalEmails = await db.select().from(outboundEmails).where(and(
      eq(outboundEmails.organizationId, orgId), eq(outboundEmails.entityId, created.json.id),
      eq(outboundEmails.eventType, "audit.audit_programme.approved_final"),
    ));
    expect(finalEmails).toHaveLength(3);
    expect(finalEmails.map(row => row.recipientEmail).sort()).toEqual([
      expect.stringContaining("l1.approver"), expect.stringContaining("l2.approver"),
      expect.stringContaining("programme.creator"),
    ]);
    expect(finalEmails.every(row => Array.isArray(row.context.emailAttachments) && row.context.emailAttachments.length === 1)).toBe(true);
    const approvedSignatories = await api("GET", `/programmes/${created.json.id}/signatories`, creator.token);
    const activity = await api("GET", `/programmes/${created.json.id}/activity?limit=200`, creator.token);
    expect(activity.status).toBe(200);
    const recordedActions = activity.json.items.map((entry: { action: string }) => entry.action);
    for (const action of ["create", "submit", "resubmit", "approve", "send_back",
      "assign_reference", "programme_submit", "programme_send_back", "programme_approve"]) {
      expect(recordedActions).toContain(action);
    }
    const sendBackEvents = activity.json.items.filter((entry: { action: string }) => entry.action === "send_back" || entry.action === "programme_send_back");
    expect(sendBackEvents.every((entry: { remarks: string }) => !!entry.remarks)).toBe(true);
    expect(approvedSignatories.json.reviewedBy).toEqual([
      { userId: l1.id, name: "L1 Approver", designation: null, role: "L1 Programme Approver", signatureDataUrl: null },
    ]);
    expect(approvedSignatories.json.approvedBy).toEqual({
      userId: l2.id, name: "L2 Approver", designation: null, role: "L2 Programme Approver", signatureDataUrl: null,
    });
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
    const submitted = await api("POST", `/schedules/${child.id}/submit`, creator.token, {
      subject: child.title, mailBody: "Please review this audit.",
    });
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
    const emptyRole = await role("L3 Unstaffed", [(await permission("approve_reject")).id], 3);
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

  it("validates category/type mappings on create while preserving unchanged legacy pairs on update", async () => {
    const [categoryGroup] = await db.select().from(masterDataGroups).where(and(
      eq(masterDataGroups.organizationId, orgId), eq(masterDataGroups.code, "audit_categories"),
    ));
    const [typesGroup] = await db.select().from(masterDataGroups).where(and(
      eq(masterDataGroups.organizationId, orgId), eq(masterDataGroups.code, "audit_types"),
    ));
    const [internal] = await db.select().from(masterDataValues).where(and(
      eq(masterDataValues.organizationId, orgId), eq(masterDataValues.groupId, categoryGroup!.id),
      eq(masterDataValues.value, "Internal"), isNull(masterDataValues.deletedAt),
    ));
    const originalMetadata = internal!.metadata;
    await db.insert(masterDataValues).values(["Financial Audit", "Operational Audit"].map(value => ({
      organizationId: orgId, groupId: typesGroup!.id, value, label: value,
    })));
    let otherCategoryId: string | undefined;

    const base = {
      id: crypto.randomUUID(), year: 2026, projectIds: [],
      auditTypes: ["Financial Audit", "Operational Audit"],
      auditCategory: "Internal", plannedStartDate: "2026-05-01",
      plannedEndDate: "2026-05-02", workflowState: "Draft",
    };
    try {
      const legacy = await api("POST", "/schedules", creator.token, { ...base, title: "Unmapped legacy pair" });
      expect(legacy.status, JSON.stringify(legacy.json)).toBe(201);
      const [otherCategory] = await db.insert(masterDataValues).values({
        organizationId: orgId, groupId: categoryGroup!.id, value: "Other", label: "Other",
        metadata: { auditTypeValues: ["Operational Audit"] },
      }).returning();
      otherCategoryId = otherCategory!.id;
      await db.update(masterDataValues).set({ metadata: { auditTypeValues: ["Financial Audit"] } })
        .where(eq(masterDataValues.id, internal!.id));

      const matching = await api("POST", "/schedules", creator.token, {
        ...base, id: crypto.randomUUID(), title: "Mapped internal pair",
        auditTypes: ["Financial Audit"],
      });
      expect(matching.status).toBe(201);
      const otherMatching = await api("POST", "/schedules", creator.token, {
        ...base, id: crypto.randomUUID(), title: "Mapped other pair",
        auditCategory: "Other", auditTypes: ["Operational Audit"],
      });
      expect(otherMatching.status).toBe(201);

      const mismatch = await api("POST", "/schedules", creator.token, {
        ...base, id: crypto.randomUUID(), title: "Mismatched category",
        auditTypes: ["Operational Audit"],
      });
      expect(mismatch.status).toBe(422);
      expect(mismatch.json.error).toContain("Audit category");

      const unchangedLegacy = await api("PUT", `/schedules/${legacy.json.id}`, creator.token, {
        ...legacy.json, title: "Edited legacy schedule",
        auditTypes: [...base.auditTypes].reverse(),
      });
      expect(unchangedLegacy.status).toBe(200);
      const changedLegacyTypes = await api("PUT", `/schedules/${legacy.json.id}`, creator.token, {
        ...unchangedLegacy.json, auditTypes: ["Operational Audit"],
      });
      expect(changedLegacyTypes.status).toBe(422);
      const changedLegacyCategory = await api("PUT", `/schedules/${legacy.json.id}`, creator.token, {
        ...unchangedLegacy.json, auditCategory: "Other",
      });
      expect(changedLegacyCategory.status).toBe(422);
    } finally {
      await db.update(masterDataValues).set({ metadata: originalMetadata })
        .where(eq(masterDataValues.id, internal!.id));
      if (otherCategoryId) await db.delete(masterDataValues).where(eq(masterDataValues.id, otherCategoryId));
      await db.delete(masterDataValues).where(and(
        eq(masterDataValues.organizationId, orgId), eq(masterDataValues.groupId, typesGroup!.id),
        sql`${masterDataValues.value} IN ('Financial Audit', 'Operational Audit')`,
      ));
    }
  });
});