import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import {
  applicationAccess, auditAuditLogEntries, auditNotifications, auditPermissions, auditPlans, auditSchedules,
  auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  db, masterDataGroups, masterDataValues, organizations, platformRoles, projects, users,
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
    ["activities", "General Requirement"],
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
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("audit programme parent/child workflow", () => {
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
    };
    const invalidPlan = await api("POST", "/plans", creator.token, planPayload);
    expect(invalidPlan.status).toBe(422);
    expect(invalidPlan.json.error).toMatch(/selected when the schedule was created/);
    const validPlan = await api("POST", "/plans", creator.token, {
      ...planPayload, id: crypto.randomUUID(), leadAuditorId: creator.id,
    });
    expect(validPlan.status).toBe(201);
    expect(validPlan.json.leadAuditorId).toBe(creator.id);

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
      await db.insert(auditSchedules).values({
        organizationId: orgId, year: 2026, title, ownerId: creator.id, workflowState: "draft",
        status: JSON.stringify({ parentId: programme.json.id, projectIds: [projectId], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" }),
      });
    }
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
      status: JSON.stringify({ parentId: created.json.id, independentlySubmitted: true }),
    }).where(eq(auditSchedules.id, independentlySubmittedChild.id));
    const submitted = await api("POST", `/programmes/${created.json.id}/submit`, creator.token, { subject: "Approval programme", mailBody: "Please review and approve." });
    expect(submitted.status).toBe(200);
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
    expect(resubmitted.json.currentApprovalRole).toBe("L1 Programme Approver");
    expect(resubmitted.json.currentApproverNames).toEqual(["L1 Approver"]);
    expect((await api("GET", `/schedules/${existingChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    expect((await api("GET", `/schedules/${newlyDraftChild.id}`, creator.token)).json.workflowState).toBe("Submitted");
    expect((await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" })).status).toBe(409);
    expect((await api("POST", `/programmes/${created.json.id}/review`, l1.token, { decision: "approve" })).status).toBe(200);
    const second = await api("POST", `/programmes/${created.json.id}/review`, l2.token, { decision: "approve" });
    expect(second.status).toBe(200);
    expect(second.json.workflowState).toBe("Approved");
    const approvedSignatories = await api("GET", `/programmes/${created.json.id}/signatories`, creator.token);
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