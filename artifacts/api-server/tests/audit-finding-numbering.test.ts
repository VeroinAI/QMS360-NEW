import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  db, organizations, projects, platformRoles, users, applicationAccess, auditWorkspaceRoles, auditUserWorkspaceRoles,
  masterDataGroups, masterDataValues, auditSchedules, auditPlans, audits, auditAuditLogEntries, organizationSettings,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { lockScheduleNumbering } from "../src/lib/audit-schedule-numbering";
import { readPlanNumberState } from "../src/lib/audit-plan-numbering";
import { readReportNumberState } from "../src/lib/audit-report-numbering";
import { allocateFindingNumber, readFindingNumberState, saveFindingNumbering } from "../src/lib/audit-finding-numbering";

let server: Server, base: string, orgId: string, token: string, viewerToken: string, userId: string;
let projectId: string, browserProjectId: string, missingProjectId: string, auditId: string, browserAuditId: string, departmentId: string;
const suffix = randomUUID().slice(0, 8), fixturePath = "/tmp/qms-audit-finding-fixture.json";
const pattern = { prefix: "AGH", separator: "-", padding: 4,
  codes: { "Minor NC": "MIN", "Moderate NC": "MOD", "Major NC": "MNC", OFI: "OFI" } };
async function api(method: string, path: string, data?: unknown, auth = token) {
  const response = await fetch(`${base}/api/audit${path}`, { method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
const payload = (type = "Major NC", key = randomUUID()) => ({
  clause: "9.2", auditArea: "Construction", description: "Numbering regression finding", auditFinding: type,
  actionTakerId: userId, recommendedPriorityAction: "Correct and close", clientReference: key,
});
const issue = (type: string, project: string | null, date: string, department?: string) => db.transaction(async tx => {
  const { settings } = await lockScheduleNumbering(tx, orgId);
  return allocateFindingNumber(tx, settings, type, project, department, date);
});
async function cleanup(id: string) {
  for (const table of [auditAuditLogEntries, audits, auditPlans, auditSchedules, organizationSettings,
    masterDataValues, masterDataGroups, auditUserWorkspaceRoles, auditWorkspaceRoles, applicationAccess,
    users, platformRoles, projects]) {
    await db.delete(table).where(eq(table.organizationId, id));
  }
  await db.delete(organizations).where(eq(organizations.id, id));
}
beforeAll(async () => {
  if (process.env.QMS_AUDIT_FINDING_CLEANUP === "1") return;
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [org] = await db.insert(organizations).values({ name: `Finding numbering ${suffix}`, code: `FN${suffix}` }).returning();
  orgId = org!.id;
  const projectRows = await db.insert(projects).values([
    { organizationId: orgId, name: "Finding API project", code: `FA${suffix}`, customFields: { costCentre: "FP100" } },
    { organizationId: orgId, name: "Finding browser project", code: `FB${suffix}`, customFields: { costCentre: "FB100" } },
    { organizationId: orgId, name: "Missing Cost Center", code: `FM${suffix}` },
  ]).returning();
  [projectId, browserProjectId, missingProjectId] = projectRows.map(project => project.id);
  const roles = await db.insert(platformRoles).values([
    { organizationId: orgId, name: "Org Admin", isSystem: true }, { organizationId: orgId, name: "Employee", isSystem: true },
  ]).returning();
  const people = await db.insert(users).values(roles.map((role, i) => ({
    organizationId: orgId, platformRoleId: role.id, fullName: i ? "Finding viewer" : "Finding administrator",
    email: `finding-${i}-${suffix}@example.test`, username: `finding-${i}-${suffix}`,
  }))).returning();
  userId = people[0]!.id; token = issueToken(people[0]!); viewerToken = issueToken(people[1]!);
  const [workspaceRole] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: "Finding operator" }).returning();
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: workspaceRole!.id });
  await db.insert(applicationAccess).values({ organizationId: orgId, username: people[0]!.username, canOpenAudit: true, status: "active" });
  const groups = await db.insert(masterDataGroups).values([
    { organizationId: orgId, name: "Audit Area", code: "Audit Area", appKey: "audit" },
    { organizationId: orgId, name: "Department Master", code: "Department", appKey: "audit" },
  ]).returning();
  const values = await db.insert(masterDataValues).values([
    { organizationId: orgId, groupId: groups[0]!.id, value: "Construction", label: "Construction" },
    { organizationId: orgId, groupId: groups[1]!.id, value: "ENG", label: "Engineering label" },
  ]).returning();
  departmentId = values[1]!.id;
  const schedules = await db.insert(auditSchedules).values([projectId, browserProjectId].map(project => ({
    organizationId: orgId, projectId: project, title: "Finding fixture schedule", year: 2027,
    status: JSON.stringify({ plannedStartDate: "2027-03-01", plannedEndDate: "2027-03-05", auditTypes: ["Quality Internal Product Audit"] }),
  }))).returning();
  const plans = await db.insert(auditPlans).values(schedules.map(schedule => ({
    organizationId: orgId, projectId: schedule.projectId, auditScheduleId: schedule.id, scope: "Actual finding scope", location: "Site",
  }))).returning();
  const auditRows = await db.insert(audits).values(plans.map((plan, i) => ({
    organizationId: orgId, projectId: plan.projectId, auditPlanId: plan.id,
    referenceNumber: `Finding ${i} ${suffix}`, workflowState: "planned",
    status: JSON.stringify({ title: i ? "Finding browser audit" : "Finding API audit" }),
    checklistState: [{ id: "legacy", clause: "8.5", auditArea: "Construction", question: "Check records", auditFinding: "Minor NC", evidenceIds: [], clientReference: "B.1.1" }],
  }))).returning();
  auditId = auditRows[0]!.id; browserAuditId = auditRows[1]!.id;
  await saveFindingNumbering(orgId, pattern);
}, 30_000);
afterAll(async () => {
  if (process.env.QMS_AUDIT_FINDING_CLEANUP === "1") return;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (orgId && process.env.QMS_AUDIT_FINDING_BROWSER === "1") {
    await writeFile(fixturePath, JSON.stringify({ orgId, token, auditId: browserAuditId, projectId: browserProjectId,
      year: 2027, actionTakerId: userId }), { mode: 0o600 });
  } else if (orgId) await cleanup(orgId);
});

describe.skipIf(process.env.QMS_AUDIT_FINDING_CLEANUP === "1")("Audit Finding numbering", () => {
  it("exposes four numbered types and restricts settings to administrators", async () => {
    const settings = await api("GET", "/admin/finding-numbering");
    expect(settings.status).toBe(200);
    expect(settings.body.findingTypes).toEqual(["Minor NC", "Moderate NC", "Major NC", "OFI"]);
    expect(settings.body.sources.some((source: any) => source.key === `department:${departmentId}` && source.sourceValue === "ENG")).toBe(true);
    expect((await api("GET", "/admin/finding-numbering", undefined, viewerToken)).status).toBe(403);
    expect((await api("PUT", "/admin/finding-numbering", pattern, viewerToken)).status).toBe(403);
  });
  it("validates nonempty codes, the allowed types and literal number formatting", async () => {
    for (const invalid of [
      { ...pattern, padding: 1.5 }, { ...pattern, prefix: "{source}" },
      { ...pattern, codes: { ...pattern.codes, "Minor NC": "" } },
      { ...pattern, codes: { ...pattern.codes, "Not applicable": "NA" } },
    ]) expect((await api("PUT", "/admin/finding-numbering", invalid)).status).toBe(422);
    expect((await api("PUT", "/admin/finding-numbering", pattern)).status).toBe(200);
  });
  it("assigns on Save Finding and retains the same number on duplicate saves", async () => {
    const input = payload();
    const created = await api("POST", `/audits/${auditId}/finding-items`, { ...input, findingNumber: "FORGED" });
    expect(created.status).toBe(201);
    expect(created.body.checklist.at(-1).findingNumber).toBe("AGH-FP100-MNC-27-0001");
    const retry = await api("POST", `/audits/${auditId}/finding-items`, input);
    expect(retry.status).toBe(201);
    expect(retry.body.checklist).toEqual(created.body.checklist);
    const stored = await api("GET", `/audits/${auditId}`);
    expect(stored.body.checklist.at(-1).findingNumber).toBe("AGH-FP100-MNC-27-0001");
    expect((await readFindingNumberState(orgId)).ranges["Major NC"]?.[`project:${projectId}`]?.["2027"]).toBe(1);
    expect(created.body.checklist[0].clientReference).toBe("B.1.1");
    expect(created.body.checklist[0].findingNumber).toBeUndefined();
  });
  it("starts each finding type at 1 and rejects Not applicable without consuming a counter", async () => {
    expect((await api("POST", `/audits/${auditId}/finding-items`, payload("Minor NC"))).body.checklist.at(-1).findingNumber).toBe("AGH-FP100-MIN-27-0001");
    const before = await readFindingNumberState(orgId);
    expect((await api("POST", `/audits/${auditId}/finding-items`, payload("Not applicable"))).status).toBe(422);
    expect(await readFindingNumberState(orgId)).toEqual(before);
  });
  it("allocates distinct numbers during concurrent saves and deduplicates concurrent retries", async () => {
    const saved = await Promise.all(Array.from({ length: 4 }, () => api("POST", `/audits/${auditId}/finding-items`, payload())));
    expect(saved.every(result => result.status === 201)).toBe(true);
    const keys = saved.map(result => result.body.checklist.at(-1).findingNumber);
    expect(new Set(keys).size).toBe(4);
    const input = payload("OFI");
    const replayed = await Promise.all([api("POST", `/audits/${auditId}/finding-items`, input), api("POST", `/audits/${auditId}/finding-items`, input)]);
    expect(replayed.every(result => result.status === 201)).toBe(true);
    expect(replayed[0].body.checklist).toEqual(replayed[1].body.checklist);
    expect((await readFindingNumberState(orgId)).ranges.OFI?.[`project:${projectId}`]?.["2027"]).toBe(1);
  });
  it("preserves finding numbers when updating assignment or a stale checklist", async () => {
    const current = await api("GET", `/audits/${auditId}`);
    const item = current.body.checklist.find((entry: any) => entry.findingNumber);
    const reassigned = await api("PATCH", `/audits/${auditId}/finding-items/${item.id}/action-taker`, {
      actionTakerId: userId, recommendedPriorityAction: "Prevent recurrence",
    });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.checklist.find((entry: any) => entry.id === item.id).findingNumber).toBe(item.findingNumber);
    const checklist = await api("PUT", `/audits/${auditId}/checklist`, [{ ...current.body.checklist[0], findingNumber: "FORGED" },
      { ...item, source: undefined, findingNumber: "FORGED" }]);
    expect(checklist.status).toBe(200);
    expect(checklist.body.checklist.filter((entry: any) => entry.id === item.id)).toHaveLength(1);
    expect(checklist.body.checklist.find((entry: any) => entry.id === item.id).findingNumber).toBe(item.findingNumber);
    expect(checklist.body.checklist[0].findingNumber).toBeUndefined();
  });
  it("uses Department master Value and resets independent department and yearly sequences", async () => {
    expect((await issue("Major NC", null, "2027-06-15", "Engineering label")).findingNumber).toBe("AGH-ENG-MNC-27-0001");
    expect((await issue("Minor NC", null, "2027-06-15", "ENG")).findingNumber).toBe("AGH-ENG-MIN-27-0001");
    expect((await issue("Major NC", null, "2028-01-01", "ENG")).findingNumber).toBe("AGH-ENG-MNC-28-0001");
    expect((await issue("Major NC", projectId, "2028-01-01")).findingNumber).toBe("AGH-FP100-MNC-28-0001");
  });
  it("uses the linked Plan and Schedule when Save Finding belongs to a process audit", async () => {
    const [schedule] = await db.insert(auditSchedules).values({
      organizationId: orgId, title: "Process finding fixture", year: 2029,
      status: JSON.stringify({ plannedStartDate: "2029-05-01", plannedEndDate: "2029-05-03",
        departmentProject: "Engineering label", auditTypes: ["Quality Internal Process Audit"] }),
    }).returning();
    // A legacy process Plan can retain a project; process numbering must still use Department Value.
    const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, projectId,
      auditScheduleId: schedule!.id, scope: "Process scope", location: "Department" }).returning();
    const [audit] = await db.insert(audits).values({ organizationId: orgId, auditPlanId: plan!.id,
      referenceNumber: `Process finding ${suffix}`, workflowState: "planned", checklistState: [] }).returning();
    const result = await api("POST", `/audits/${audit!.id}/finding-items`, payload("Major NC"));
    expect(result.status).toBe(201);
    expect(result.body.checklist.at(-1).findingNumber).toBe("AGH-ENG-MNC-29-0001");
    const [unlinked] = await db.insert(audits).values({ organizationId: orgId, projectId,
      referenceNumber: `Unlinked finding ${suffix}`, workflowState: "planned", checklistState: [] }).returning();
    const before = await readFindingNumberState(orgId);
    const rejected = await api("POST", `/audits/${unlinked!.id}/finding-items`, payload());
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toMatch(/linked Audit Plan/);
    expect(await readFindingNumberState(orgId)).toEqual(before);
  });
  it("rolls back failed allocations and leaves Plan and Report counters unchanged", async () => {
    const before = await readFindingNumberState(orgId), plan = await readPlanNumberState(orgId), report = await readReportNumberState(orgId);
    await expect(issue("OFI", missingProjectId, "2027-03-01")).rejects.toThrow(/Cost Center/);
    await expect(issue("OFI", projectId, "2027-02-30")).rejects.toThrow(/calendar/);
    await expect(db.transaction(async tx => {
      const { settings } = await lockScheduleNumbering(tx, orgId);
      await allocateFindingNumber(tx, settings, "OFI", projectId, undefined, "2027-03-01");
      throw new Error("Rollback finding save");
    })).rejects.toThrow("Rollback");
    expect(await readFindingNumberState(orgId)).toEqual(before);
    expect(await readPlanNumberState(orgId)).toEqual(plan);
    expect(await readReportNumberState(orgId)).toEqual(report);
  });
  it("keeps counters across format changes and prevents collisions with previously issued numbers", async () => {
    const before = await readFindingNumberState(orgId);
    await saveFindingNumbering(orgId, { ...pattern, codes: { ...pattern.codes, "Major NC": "NEW" } });
    const number = await issue("Major NC", projectId, "2027-03-01");
    expect(number.findingNumberSequence).toBe(before.ranges["Major NC"]?.[`project:${projectId}`]?.["2027"]! + 1);
    expect((await api("GET", `/audits/${auditId}`)).body.checklist.some((entry: any) => entry.findingNumber === "AGH-FP100-MNC-27-0001")).toBe(true);
    const changed = { ...pattern, codes: { ...pattern.codes, "Major NC": "NEW", "Moderate NC": "MNC" } };
    await saveFindingNumbering(orgId, changed);
    expect((await issue("Moderate NC", projectId, "2027-03-01")).findingNumber).toBe("AGH-FP100-MNC-27-0001");
    await saveFindingNumbering(orgId, pattern);
    await db.update(projects).set({ customFields: { costCentre: "FP100" } }).where(eq(projects.id, missingProjectId));
    await expect(issue("Major NC", missingProjectId, "2027-03-01")).rejects.toThrow(/already exists for this finding type/);
    expect((await readFindingNumberState(orgId)).ranges["Major NC"]?.[`project:${missingProjectId}`]).toBeUndefined();
  });
  it("saves shared codes and issues overlapping numbers across types with independent counters and retries", async () => {
    const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
    const [plan] = await db.select().from(auditPlans).where(eq(auditPlans.id, audit!.auditPlanId!));
    const [schedule] = await db.select().from(auditSchedules).where(eq(auditSchedules.id, plan!.auditScheduleId!));
    const shared = { ...pattern, codes: { ...pattern.codes, "Minor NC": "NCR", "Moderate NC": "NCR", "Major NC": "NCR" } };
    try {
      const saved = await api("PUT", "/admin/finding-numbering", shared);
      expect(saved.status).toBe(200);
      expect((await api("GET", "/admin/finding-numbering")).body.pattern.codes).toEqual(shared.codes);
      await db.update(auditSchedules).set({
        status: JSON.stringify({ ...JSON.parse(schedule!.status!), plannedStartDate: "2031-03-01", plannedEndDate: "2031-03-05" }),
      }).where(eq(auditSchedules.id, schedule!.id));
      const requests = ["Minor NC", "Moderate NC", "Major NC"].map(type => payload(type));
      for (const input of requests) {
        const savedFinding = await api("POST", `/audits/${auditId}/finding-items`, input);
        expect(savedFinding.status).toBe(201);
        expect(savedFinding.body.checklist.find((item: any) => item.clientReference === input.clientReference).findingNumber).toBe("AGH-FP100-NCR-31-0001");
      }
      const retry = await api("POST", `/audits/${auditId}/finding-items`, requests[2]);
      expect(retry.body.checklist.filter((item: any) => item.clientReference === requests[2]!.clientReference)).toHaveLength(1);
      const secondMajor = await api("POST", `/audits/${auditId}/finding-items`, payload("Major NC"));
      expect(secondMajor.body.checklist.at(-1).findingNumber).toBe("AGH-FP100-NCR-31-0002");
      const state = await readFindingNumberState(orgId);
      expect(state.ranges["Minor NC"]?.[`project:${projectId}`]?.["2031"]).toBe(1);
      expect(state.ranges["Moderate NC"]?.[`project:${projectId}`]?.["2031"]).toBe(1);
      expect(state.ranges["Major NC"]?.[`project:${projectId}`]?.["2031"]).toBe(2);
      const reloaded = await api("GET", `/audits/${auditId}`);
      expect(reloaded.body.checklist.filter((item: any) => item.findingNumber === "AGH-FP100-NCR-31-0001")).toHaveLength(3);
    } finally {
      await db.update(auditSchedules).set({ status: schedule!.status }).where(eq(auditSchedules.id, schedule!.id));
      await saveFindingNumbering(orgId, pattern);
    }
  });
  it("maintains next finding numbers per type/source/year and rejects invalid or backward ranges", async () => {
    const range = { findingType: "Major NC", scope: `project:${projectId}`, year: 2032, nextNumber: 126 };
    const before = await readFindingNumberState(orgId);
    const planState = await readPlanNumberState(orgId), reportState = await readReportNumberState(orgId);
    expect((await api("PUT", "/admin/finding-numbering/ranges", range, viewerToken)).status).toBe(403);
    expect((await api("PUT", "/admin/finding-numbering/ranges", { ...range, scope: `project:${randomUUID()}` })).status).toBe(404);
    for (const invalid of [
      { ...range, findingType: "Not applicable" }, { ...range, nextNumber: 0 },
      { ...range, nextNumber: 1.5 }, { ...range, nextNumber: 1000000000000 },
      { ...range, year: 2032.5 }, { ...range, year: 1899 },
    ]) expect((await api("PUT", "/admin/finding-numbering/ranges", invalid)).status).toBe(422);
    expect(await readFindingNumberState(orgId)).toEqual(before);
    expect((await api("PUT", "/admin/finding-numbering/ranges", range)).status).toBe(200);
    const saved = await api("GET", "/admin/finding-numbering");
    expect(saved.body.ranges["Major NC"][range.scope]["2032"]).toBe(125);
    expect(saved.body.pattern).toEqual(before.pattern);
    expect(saved.body.ranges["Minor NC"]).toEqual(before.ranges["Minor NC"]);
    expect((await api("PUT", "/admin/finding-numbering/ranges", { ...range, nextNumber: 125 })).status).toBe(409);
    const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
    const [plan] = await db.select().from(auditPlans).where(eq(auditPlans.id, audit!.auditPlanId!));
    const [schedule] = await db.select().from(auditSchedules).where(eq(auditSchedules.id, plan!.auditScheduleId!));
    const checklistBefore = (await api("GET", `/audits/${auditId}`)).body.checklist;
    try {
      await db.update(auditSchedules).set({
        status: JSON.stringify({ ...JSON.parse(schedule!.status!), plannedStartDate: "2032-03-01", plannedEndDate: "2032-03-05" }),
      }).where(eq(auditSchedules.id, schedule!.id));
      const input = payload();
      const created = await api("POST", `/audits/${auditId}/finding-items`, input);
      expect(created.status).toBe(201);
      expect(created.body.checklist.at(-1).findingNumber).toBe("AGH-FP100-MNC-32-0126");
      expect(created.body.checklist.slice(0, checklistBefore.length)).toEqual(checklistBefore);
      await api("POST", `/audits/${auditId}/finding-items`, input);
      expect((await readFindingNumberState(orgId)).ranges["Major NC"]?.[range.scope]?.["2032"]).toBe(126);
      expect((await api("PUT", "/admin/finding-numbering/ranges", range)).status).toBe(409);
      expect((await api("PUT", "/admin/finding-numbering/ranges", { ...range, nextNumber: 127 })).status).toBe(200);
      const minor = await api("POST", `/audits/${auditId}/finding-items`, payload("Minor NC"));
      expect(minor.body.checklist.at(-1).findingNumber).toBe("AGH-FP100-MIN-32-0001");
      const departmentRange = { ...range, scope: `department:${departmentId}`, nextNumber: 12 };
      expect((await api("PUT", "/admin/finding-numbering/ranges", departmentRange)).status).toBe(200);
      expect((await issue("Major NC", null, "2032-03-01", "ENG")).findingNumber).toBe("AGH-ENG-MNC-32-0012");
      expect((await api("PUT", "/admin/finding-numbering/ranges", { ...range, year: 2033, nextNumber: 1 })).status).toBe(200);
      expect((await issue("Major NC", projectId, "2033-03-01")).findingNumberSequence).toBe(1);
      expect(await readPlanNumberState(orgId)).toEqual(planState);
      expect(await readReportNumberState(orgId)).toEqual(reportState);
    } finally {
      await db.update(auditSchedules).set({ status: schedule!.status }).where(eq(auditSchedules.id, schedule!.id));
    }
  });
});

it.skipIf(process.env.QMS_AUDIT_FINDING_CLEANUP !== "1")("removes only the isolated browser fixture", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  await cleanup(fixture.orgId);
  await unlink(fixturePath);
});
