import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, organizations, projects, users, platformRoles, auditWorkspaceRoles, auditUserWorkspaceRoles,
  auditPermissions, auditWorkspaceRolePermissions, auditSchedules, auditPlans, masterDataGroups, masterDataValues,
  auditAuditLogEntries, organizationSettings, workspaceRoles, userWorkspaceRoles } from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

const org = randomUUID(), foreign = randomUUID(), a = randomUUID(), b = randomUUID(), dept = randomUUID(), otherDept = randomUUID();
const role = randomUUID(), markerRole = randomUUID(), inactiveRole = randomUUID(), parent = randomUUID();
const scheduleA = randomUUID(), scheduleB = randomUUID(), processSchedule = randomUUID(), historicalPlan = randomUUID();
const people: Record<string, string> = {};
let server: Server, base: string, token: string, scopedToken: string;
async function api(path: string, method = "GET", body?: unknown, auth = token) {
  const response = await fetch(`${base}/api/audit${path}`, { method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}
async function person(name: string, organizationId = org, accessStatus = "active") {
  const id = randomUUID(); people[name] = id;
  await db.insert(users).values({ id, organizationId, username: `${name}-${id}`, fullName: name, email: `${id}@example.test`, accessStatus });
  return id;
}
async function assign(userId: string, projectIds: string[] = [], departmentIds: string[] = [], workspaceRoleId = role, extra: Record<string, unknown> = {}) {
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: org, userId, workspaceRoleId, projectIds, departmentIds, ...extra });
}
beforeAll(async () => {
  await db.insert(organizations).values([{ id: org, name: "Participant options fixture", code: org }, { id: foreign, name: "Foreign fixture", code: foreign }]);
  const [adminRole] = await db.insert(platformRoles).values({ organizationId: org, name: "Org Admin" }).returning();
  const [admin] = await db.insert(users).values({ organizationId: org, username: `admin-${org}`, email: `admin-${org}@example.test`, fullName: "Fixture admin", platformRoleId: adminRole!.id }).returning();
  token = issueToken(admin!);
  await db.insert(projects).values([{ id: a, organizationId: org, code: "A", name: "A", customFields: { costCentre: "A" } },
    { id: b, organizationId: org, code: "B", name: "B" }]);
  await db.insert(auditWorkspaceRoles).values([
    { id: role, organizationId: org, name: "Participant" }, { id: markerRole, organizationId: org, name: "Lead" },
    { id: inactiveRole, organizationId: org, name: "Inactive role", status: "inactive" },
  ]);
  const [marker] = await db.insert(auditPermissions).values({ organizationId: org, key: "audit_team_lead", label: "Team lead", category: "audit" }).returning();
  await db.insert(auditWorkspaceRolePermissions).values({ organizationId: org, workspaceRoleId: markerRole, permissionId: marker!.id, grant: "full" });
  const group = randomUUID(), activityGroup = randomUUID();
  await db.insert(masterDataGroups).values([{ id: group, organizationId: org, name: "Departments", code: "departments", appKey: "audit" },
    { id: activityGroup, organizationId: org, name: "Activities", code: "activities", appKey: "audit" }]);
  await db.insert(masterDataValues).values([{ id: dept, organizationId: org, groupId: group, value: "OPS", label: "Operations" },
    { id: otherDept, organizationId: org, groupId: group, value: "ENG", label: "Engineering" },
    { organizationId: org, groupId: activityGroup, value: "Review", label: "Review" }]);
  await assign(await person("global"));
  await assign(await person("a"), [a]);
  await assign(await person("b"), [b]);
  await assign(await person("multi"), [a, b]);
  const split = await person("split"); await assign(split, [a]); await assign(split, [b], [], markerRole);
  await assign(await person("department"), [], [dept]);
  await assign(await person("other-department"), [], [otherDept]);
  await assign(await person("inactive-assignment"), [], [], role, { status: "inactive" });
  await assign(await person("inactive-role"), [], [], inactiveRole);
  await assign(await person("deleted-assignment"), [], [], role, { deletedAt: new Date() });
  await assign(await person("inactive-user", org, "deactivated"));
  await assign(await person("foreign-user", foreign));
  const mixed = await person("mixed-lead"); await assign(mixed, [a]); await assign(mixed, [b], [], markerRole);
  await assign(await person("lead-a"), [a], [], markerRole);
  const foreignApp = await person("foreign-app");
  const [qRole] = await db.insert(workspaceRoles).values({ organizationId: org, name: "QA participant" }).returning();
  await db.insert(userWorkspaceRoles).values({ organizationId: org, userId: foreignApp, workspaceRoleId: qRole!.id });
  const inactiveGlobal = await person("inactive-global"); await assign(inactiveGlobal, [b]); await assign(inactiveGlobal, [], [], markerRole, { status: "inactive" });
  const [scopedRole] = await db.insert(auditWorkspaceRoles).values({ organizationId: org, name: "Scoped Administrator" }).returning();
  const scoped = await person("scoped-reader"); await assign(scoped, [a], [], scopedRole!.id);
  await assign(scoped, [b], [], markerRole);
  const [scopedUser] = await db.select().from(users).where(eq(users.id, scoped)); scopedToken = issueToken(scopedUser!);
  const common = { organizationId: org, year: 2026, workflowState: "draft" };
  await db.insert(auditSchedules).values([
    { ...common, id: parent, title: "Programme", status: JSON.stringify({ programme: true, teamLeadIds: [people["lead-a"], mixed] }) },
    { ...common, id: scheduleA, title: "Audit A", projectId: a, status: JSON.stringify({ parentId: parent, projectIds: [a], auditTypes: ["Quality Internal Product Audit"], plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-30", qaqcScope: "Scope", qaqcReference: "REF" }) },
    { ...common, id: scheduleB, title: "Audit B", projectId: b, status: JSON.stringify({ parentId: parent, projectIds: [b],
      auditTypes: ["Quality Internal Product Audit"], plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-30", qaqcScope: "Scope", qaqcReference: "REF" }) },
    { ...common, id: processSchedule, title: "Process", status: JSON.stringify({ parentId: parent, auditTypes: ["Quality Internal Process Audit"], departmentProject: "OPS" }) },
  ]);
  await db.insert(auditPlans).values({ id: historicalPlan, organizationId: org, auditScheduleId: scheduleA, projectId: a,
    teamMemberIds: [people.b!], status: JSON.stringify({ leadAuditorId: people["lead-a"] }) });
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  const own = (table: any) => inArray(table.organizationId, [org, foreign]);
  for (const table of [auditAuditLogEntries, auditPlans, auditSchedules, auditUserWorkspaceRoles, auditWorkspaceRolePermissions,
    auditPermissions, auditWorkspaceRoles, userWorkspaceRoles, workspaceRoles, users, platformRoles, masterDataValues, masterDataGroups, organizationSettings, projects]) {
    await db.delete(table).where(own(table));
  }
  await db.delete(organizations).where(inArray(organizations.id, [org, foreign]));
});

describe("Contextual Audit participant API", () => {
  it("filters and deduplicates active Audit assignments without borrowing other applications or inactive global scope", async () => {
    const result = await api(`/plan-options?scheduleId=${scheduleA}`);
    expect(result.status).toBe(200);
    const names = result.data.users.map((user: any) => user.fullName);
    expect(names.sort()).toEqual(["a", "global", "lead-a", "mixed-lead", "multi", "scoped-reader", "split"].sort());
    expect(new Set(result.data.users.map((user: any) => user.id)).size).toBe(names.length);
    expect(result.data.leadUsers.map((user: any) => user.fullName)).toEqual(["lead-a"]);
    expect(result.data.historicalUsers.some((user: any) => user.fullName === "b")).toBe(true);
    const switched = await api(`/plan-options?scheduleId=${scheduleB}`);
    expect(switched.data.users.some((user: any) => user.fullName === "a")).toBe(false);
    expect(switched.data.users.some((user: any) => user.fullName === "b")).toBe(true);
  });
  it("rejects absent, programme, foreign and unauthorized contexts", async () => {
    expect((await api("/plan-options")).status).toBe(422);
    expect((await api("/plan-options?scheduleId=not-an-id")).status).toBe(422);
    expect((await api("/schedule-activity-options")).status).toBe(422);
    expect((await api(`/plan-options?scheduleId=${parent}`)).status).toBe(404);
    expect((await api(`/plan-options?scheduleId=${randomUUID()}`)).status).toBe(404);
    expect((await api(`/plan-options?scheduleId=${scheduleB}`, "GET", undefined, scopedToken)).status).toBe(403);
    expect((await api(`/schedule-activity-options?projectId=${b}`, "GET", undefined, scopedToken)).status).toBe(403);
  });
  it("keeps Process options department aware, with the existing legacy project-role participation", async () => {
    const result = await api(`/plan-options?scheduleId=${processSchedule}`);
    expect(result.status).toBe(200);
    const names = result.data.users.map((user: any) => user.fullName);
    expect(names).toContain("department"); expect(names).toContain("a"); expect(names).toContain("global");
    expect(names).not.toContain("other-department");
    const activity = await api("/schedule-activity-options?department=OPS");
    expect(activity.data.users.map((user: any) => user.id)).toEqual(result.data.users.map((user: any) => user.id));
    expect((await api("/schedule-activity-options?department=unknown")).status).toBe(422);
  });
  it("uses the same project eligibility for schedule activity options and direct writes", async () => {
    const options = await api(`/schedule-activity-options?projectId=${a}`);
    expect(options.data.users.some((user: any) => user.id === people.b)).toBe(false);
    const input = { id: randomUUID(), year: 2026, title: "Invalid assignment", projectIds: [a], workflowState: "Draft",
      plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-30", activityRoleAssignments: [{ roleId: role, userIds: [people.b] }] };
    const create = await api("/schedules", "POST", input);
    expect(create.status).toBe(422); expect(create.data.error).toMatch(/QMS Audit users/);
    const update = await api(`/schedules/${scheduleA}`, "PUT", input);
    expect(update.status).toBe(422); expect(update.data.error).toMatch(/QMS Audit users/);
  });
  it("rejects out-of-project team and activity users on Plan updates and leaves history intact", async () => {
    const input = { id: historicalPlan, scheduleId: scheduleA, auditFeasible: true, auditTitle: "A", status: "Draft", leadAuditorId: people["lead-a"],
      teamMemberIds: [people.b], auditeeId: people.a, auditeeRoleIds: [role], qaqcScope: "Scope", auditTypes: ["Quality Internal Product Audit"],
      auditLanguage: "English", qaqcReference: "REF", startDateTime: "2026-10-05T09:00", endDateTime: "2026-10-05T17:00",
      openingMeetingDateTime: "2026-10-05T09:00", closingMeetingDateTime: "2026-10-05T17:00", activitySection: "Review",
      activityRemarks: "Review", activityAuditeeId: people.a, auditPlanCirculation: "Participants",
      activities: [{ id: "review", section: "Review", remarks: "Review", auditeeId: people.a, plannedStartDateTime: "2026-10-05T10:00", plannedEndDateTime: "2026-10-05T11:00" }] };
    const invalid = await api(`/plans/${historicalPlan}`, "PUT", input);
    expect(invalid.status).toBe(422); expect(invalid.data.error).toMatch(/eligible for this audit/);
    const invalidActivity = await api(`/plans/${historicalPlan}`, "PUT", { ...input, teamMemberIds: [people.a],
      activities: [{ ...input.activities[0], auditeeId: people.b }] });
    expect(invalidActivity.status).toBe(422); expect(invalidActivity.data.error).toMatch(/eligible for this audit/);
    const mixedLead = await api(`/plans/${historicalPlan}`, "PUT", { ...input, teamMemberIds: [people.a], leadAuditorId: people["mixed-lead"] });
    expect(mixedLead.status).toBe(422); expect(mixedLead.data.error).toMatch(/Lead assignment eligible/);
    const [saved] = await db.select().from(auditPlans).where(eq(auditPlans.id, historicalPlan));
    expect(saved!.teamMemberIds).toEqual([people.b]);
    // A caller-supplied project cannot replace the actual source Schedule B.
    const invalidCreate = await api("/plans", "POST", { ...input, id: randomUUID(), scheduleId: scheduleB,
      projectId: a, teamMemberIds: [people.a], leadAuditorId: people["mixed-lead"] });
    expect(invalidCreate.status).toBe(422); expect(invalidCreate.data.error).toMatch(/eligible for this audit/);
    const corrected = await api(`/plans/${historicalPlan}`, "PUT", { ...input, teamMemberIds: [people.a] });
    expect(corrected.status).toBe(200); expect(corrected.data.teamMemberIds).toEqual([people.a]);
  });
});
