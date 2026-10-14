import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  applicationAccess, auditAuditLogEntries, auditEvidenceFiles, auditFindings, auditNotifications, auditPermissions, auditPlans,
  auditSchedules, audits, auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  correctiveActionReports, db, masterDataGroups, masterDataValues, organizations, organizationSettings,
  platformRoles, projects, users,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { readCarNumberState, saveCarNumbering } from "../src/lib/audit-car-numbering";
import { readPlanNumberState } from "../src/lib/audit-plan-numbering";
import { readReportNumberState } from "../src/lib/audit-report-numbering";
import { readFindingNumberState } from "../src/lib/audit-finding-numbering";
import { carWordReportData } from "../src/lib/car-word-report-data";

let server: Server, base: string, orgId: string, userId: string, projectId: string, missingProjectId: string;
let token: string, otherToken: string, employeeToken: string, employeeId: string, departmentId: string, browserAuditId: string;
const suffix = randomUUID().slice(0, 8), fixturePath = "/tmp/qms-audit-car-fixture.json";
const pattern = { prefix: "QAM", middle: "CAR", separator: "-", padding: 4 };
const response = { rootCause: "Root cause", correction: "Correction", correctiveAction: "Prevent recurrence" };
async function api(method: string, path: string, data?: unknown, auth = token) {
  const result = await fetch(`${base}/api/audit${path}`, { method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: result.status, body: await result.json() };
}
async function cleanup(org: string) {
  for (const table of [auditNotifications, auditAuditLogEntries, auditEvidenceFiles, correctiveActionReports, auditFindings, audits,
    auditPlans, auditSchedules, organizationSettings, masterDataValues, masterDataGroups,
    auditWorkspaceRolePermissions, auditUserWorkspaceRoles, auditWorkspaceRoles, auditPermissions,
    applicationAccess, users, platformRoles, projects]) {
    await db.delete(table).where(eq(table.organizationId, org));
  }
  await db.delete(organizations).where(eq(organizations.id, org));
}
async function makeAudit(year = 2027, project: string | null = projectId, process = false) {
  const [schedule] = await db.insert(auditSchedules).values({
    organizationId: orgId, projectId: project, title: "CAR fixture schedule", year,
    status: JSON.stringify({ plannedStartDate: `${year}-03-01`, plannedEndDate: `${year}-03-05`,
      departmentProject: process ? "Engineering label" : undefined,
      auditTypes: [process ? "Quality Internal Process Audit" : "Quality Internal Product Audit"] }),
  }).returning();
  const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, projectId: project,
    auditScheduleId: schedule!.id, scope: "CAR numbering fixture", location: "Site",
    status: JSON.stringify({ leadAuditorId: userId }) }).returning();
  const itemIds = [randomUUID(), randomUUID()];
  const [audit] = await db.insert(audits).values({ organizationId: orgId, projectId: process ? null : project,
    auditPlanId: plan!.id, referenceNumber: `CAR audit ${randomUUID().slice(0, 8)}`, workflowState: "planned",
    status: JSON.stringify({ title: "CAR browser audit" }),
    checklistState: itemIds.map((id, i) => ({ id, source: "finding", clause: `9.${i + 1}`, auditArea: "Construction",
      auditFinding: "Major NC", description: `CAR numbering finding ${i + 1}`, actionTakerId: userId })),
  }).returning();
  return { audit: audit!, plan: plan!, schedule: schedule!, itemIds };
}
async function makeCar(year = 2027, project: string | null = projectId, process = false) {
  const fixture = await makeAudit(year, project, process);
  const created = await api("POST", "/car-register/start", { auditId: fixture.audit.id, itemId: fixture.itemIds[0] });
  expect(created.status).toBe(200);
  return { ...fixture, carId: created.body.id as string };
}
beforeAll(async () => {
  if (process.env.QMS_AUDIT_CAR_CLEANUP === "1") return;
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [org] = await db.insert(organizations).values({ name: `CAR numbering ${suffix}`, code: `CN${suffix}` }).returning();
  orgId = org!.id;
  const roles = await db.insert(platformRoles).values([
    { organizationId: orgId, name: "Org Admin", isSystem: true },
    { organizationId: orgId, name: "Employee", isSystem: true },
  ]).returning();
  const people = await db.insert(users).values([0, 0, 1].map((role, i) => ({
    organizationId: orgId, platformRoleId: roles[role]!.id, fullName: ["CAR administrator", "Other administrator", "CAR viewer"][i]!,
    email: `car-${i}-${suffix}@example.test`, username: `car-${i}-${suffix}`,
  }))).returning();
  userId = people[0]!.id; token = issueToken(people[0]!); otherToken = issueToken(people[1]!); employeeToken = issueToken(people[2]!);
  employeeId = people[2]!.id;
  await db.insert(applicationAccess).values(people.map(person => ({
    organizationId: orgId, username: person.username, canOpenAudit: true, status: "active",
  })));
  const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: "CAR operator" }).returning();
  const [permission] = await db.insert(auditPermissions).values({ organizationId: orgId, key: "audit_team_lead", label: "Audit Team Lead", category: "audit", description: "Lead reviewer" }).returning();
  await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: role!.id });
  const projectRows = await db.insert(projects).values([
    { organizationId: orgId, name: "CAR numbering project", code: `CP${suffix}`, customFields: { costCentre: "CC100" } },
    { organizationId: orgId, name: "CAR missing Cost Center", code: `CM${suffix}` },
  ]).returning();
  projectId = projectRows[0]!.id; missingProjectId = projectRows[1]!.id;
  const [group] = await db.insert(masterDataGroups).values({ organizationId: orgId, name: "Department Master", code: "Department", appKey: "audit" }).returning();
  const [department] = await db.insert(masterDataValues).values({ organizationId: orgId, groupId: group!.id, value: "ENG", label: "Engineering label" }).returning();
  departmentId = department!.id;
  const [areaGroup] = await db.insert(masterDataGroups).values({ organizationId: orgId, name: "Audit Area", code: "Audit Area", appKey: "audit" }).returning();
  await db.insert(masterDataValues).values({ organizationId: orgId, groupId: areaGroup!.id, value: "Construction", label: "Construction" });
  await saveCarNumbering(orgId, pattern);
  browserAuditId = (await makeAudit(2035)).audit.id;
});
afterAll(async () => {
  if (process.env.QMS_AUDIT_CAR_CLEANUP !== "1" && orgId) {
    if (process.env.QMS_AUDIT_CAR_BROWSER === "1") {
      const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: "Module verification user" }).returning();
      for (const module of ["dashboard", "schedules", "plans", "audits", "findings", "cars", "reports"]) {
        const [permission] = await db.insert(auditPermissions).values({
          organizationId: orgId, key: `audit.${module}.view_all`, label: `${module} view`, category: "audit",
        }).returning();
        await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id });
      }
      await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: employeeId, workspaceRoleId: role!.id });
      await writeFile(fixturePath, JSON.stringify({
        orgId, token, otherToken, userId, projectId, auditId: browserAuditId, year: 2035,
        moduleRoleId: role!.id, moduleUserId: employeeId, moduleToken: employeeToken,
      }), { mode: 0o600 });
    }
    else await cleanup(orgId);
  }
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

describe.skipIf(process.env.QMS_AUDIT_CAR_CLEANUP === "1")("Audit CAR numbering", () => {
  it("exposes independent settings and prevents non-admin maintenance", async () => {
    const settings = await api("GET", "/admin/car-numbering");
    expect(settings.status).toBe(200); expect(settings.body.pattern).toEqual(pattern);
    expect((await api("GET", "/admin/car-numbering", undefined, employeeToken)).status).toBe(403);
    expect((await api("PUT", "/admin/car-numbering", pattern, employeeToken)).status).toBe(403);
    expect((await api("PUT", "/admin/car-numbering", { ...pattern, padding: 1.5 })).status).toBe(422);
    expect((await api("PUT", "/admin/car-numbering", { ...pattern, prefix: "{project}" })).status).toBe(422);
  });
  it("does not number opening a CAR; saves once and retains the number through edits, submission and review", async () => {
    const f = await makeCar();
    expect((await api("GET", `/cars/${f.carId}`)).body.carNumber).toBeNull();
    expect((await readCarNumberState(orgId)).ranges[`project:${projectId}`]).toBeUndefined();
    const saved = await api("PUT", `/cars/${f.carId}`, { ...response, carNumber: "FORGED" });
    expect(saved.status).toBe(200); expect(saved.body.carNumber).toBe("QAM-CC100-CAR-27-0001");
    const nextBefore = await readCarNumberState(orgId);
    expect((await api("PUT", `/cars/${f.carId}`, response)).body.carNumber).toBe(saved.body.carNumber);
    const submit = await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true });
    expect(submit.status).toBe(200); expect(submit.body.carNumber).toBe(saved.body.carNumber);
    expect(submit.body.status).toBe("Submitted");
    const review = await api("POST", `/cars/${f.carId}/review`, { decision: "query", comments: "Clarify" });
    expect(review.status).toBe(200); expect(review.body.carNumber).toBe(saved.body.carNumber);
    expect((await api("PUT", `/cars/${f.carId}`, response)).body.carNumber).toBe(saved.body.carNumber);
    expect(await readCarNumberState(orgId)).toEqual(nextBefore);
    const register = await api("GET", "/car-register");
    expect(register.body.items.find((item: any) => item.car?.id === f.carId).car.carNumber).toBe(saved.body.carNumber);
    const dto = await carWordReportData({ currentUser: { id: userId, organizationId: orgId, platformRoleName: "Org Admin" },
      permissionProjectScope: { unrestricted: true, projectIds: [] }, permissionFullProjectScope: { unrestricted: true, projectIds: [] } } as any,
      { auditId: f.audit.id, itemId: f.itemIds[0]!, carId: f.carId });
    expect(dto.carNumber).toBe(saved.body.carNumber);
  });
  it("assigns on first Save and Submit and validates before consuming numbers", async () => {
    const f = await makeCar();
    const before = await readCarNumberState(orgId);
    expect((await api("PUT", `/cars/${f.carId}`, { saveAndSubmit: true })).status).toBe(422);
    expect((await api("PUT", `/cars/${f.carId}`, response, otherToken)).status).toBe(403);
    expect(await readCarNumberState(orgId)).toEqual(before);
    const result = await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true });
    expect(result.status).toBe(200); expect(result.body.carNumber).toBe("QAM-CC100-CAR-27-0002");
    expect((await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true })).status).toBe(409);
    expect((await readCarNumberState(orgId)).ranges[`project:${projectId}`]?.["2027"]).toBe(2);
  });
  it("serializes concurrent response saves without consuming duplicate numbers", async () => {
    const a = await makeCar(), b = await makeCar();
    const results = await Promise.all([a, b].map(f => api("PUT", `/cars/${f.carId}`, response)));
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(new Set(results.map(r => r.body.carNumber))).toEqual(new Set(["QAM-CC100-CAR-27-0003", "QAM-CC100-CAR-27-0004"]));
    const draft = await makeCar();
    const retries = await Promise.all([1, 2].map(() => api("PUT", `/cars/${draft.carId}`, response)));
    expect(retries.filter(r => r.status === 200).length).toBeGreaterThan(0);
    expect(retries.every(r => [200, 409].includes(r.status))).toBe(true);
    expect((await readCarNumberState(orgId)).ranges[`project:${projectId}`]?.["2027"]).toBe(5);
  });
  it("resets by full Schedule From Date year and uses Department Value even with a legacy process Plan project", async () => {
    const project = await makeCar(2028);
    expect((await api("PUT", `/cars/${project.carId}`, response)).body.carNumber).toBe("QAM-CC100-CAR-28-0001");
    const process = await makeCar(2028, projectId, true);
    expect((await api("PUT", `/cars/${process.carId}`, response)).body.carNumber).toBe("QAM-ENG-CAR-28-0001");
    expect((await readCarNumberState(orgId)).ranges[`department:${departmentId}`]?.["2028"]).toBe(1);
  });
  it("rejects missing Cost Center or linkage without writing responses or consuming counters", async () => {
    const f = await makeCar(2028, missingProjectId);
    const before = await readCarNumberState(orgId);
    expect((await api("PUT", `/cars/${f.carId}`, response)).status).toBe(422);
    expect((await api("GET", `/cars/${f.carId}`)).body.rootCause).toBeNull();
    const unlinked = await makeCar(2028);
    await db.update(audits).set({ auditPlanId: null }).where(eq(audits.id, unlinked.audit.id));
    expect((await api("PUT", `/cars/${unlinked.carId}`, response)).status).toBe(422);
    expect(await readCarNumberState(orgId)).toEqual(before);
  });
  it("supports existing standalone CAR submission and preserves metadata", async () => {
    const f = await makeCar(2029);
    await db.update(correctiveActionReports).set({ ...response, effectivenessNotes: JSON.stringify({
      sourceChecklistItemId: f.itemIds[0], extensionReason: "Retain original metadata" }),
    }).where(eq(correctiveActionReports.id, f.carId));
    const submitted = await api("POST", `/cars/${f.carId}/submit`);
    expect(submitted.status).toBe(200); expect(submitted.body.carNumber).toBe("QAM-CC100-CAR-29-0001");
    const [stored] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, f.carId));
    expect(JSON.parse(stored!.effectivenessNotes!).extensionReason).toBe("Retain original metadata");
  });
  it("scopes response evidence to a CAR and enforces assignment, lifecycle, type and size limits", async () => {
    const f = await makeCar(2034);
    const evidence = { recordType: "car", recordId: f.carId, category: "attachment",
      fileName: "response.txt", mimeType: "text/plain", sizeBytes: 5, clientReference: randomUUID() };
    // Reject before creating any upload intent or issuing a number.
    expect((await api("POST", "/evidence", evidence, otherToken)).status).toBe(403);
    expect((await api("POST", "/evidence", { ...evidence, mimeType: "application/x-msdownload" })).status).toBe(422);
    expect((await api("POST", "/evidence", { ...evidence, sizeBytes: 26 * 1024 * 1024 })).status).toBe(422);
    // Seed an existing confirmed attachment to verify read/list/download access without contacting cloud storage.
    const [file] = await db.insert(auditEvidenceFiles).values({ organizationId: orgId,
      recordType: "car", recordId: f.carId, category: "attachment", fileName: "response.txt",
      mimeType: "text/plain", sizeBytes: 5, storageKey: "", status: "stored", uploadedById: userId }).returning();
    await db.insert(auditEvidenceFiles).values({ organizationId: orgId,
      recordType: "car", recordId: f.carId, category: "attachment", fileName: "pending.txt",
      mimeType: "text/plain", sizeBytes: 5, storageKey: "", status: "uploading", uploadedById: userId });
    const listed = await api("GET", `/evidence?recordType=car&recordId=${f.carId}&page=1&limit=200`, undefined, otherToken);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((row: { id: string }) => row.id)).toEqual([file!.id]);
    expect((await api("GET", `/cars/${f.carId}`)).body.carNumber).toBeNull();
    expect((await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true })).status).toBe(200);
    expect((await api("POST", "/evidence", evidence)).status).toBe(409);
    expect((await api("PUT", `/evidence/${file!.id}/confirm`)).status).toBe(409);
    const overwrite = await fetch(`${base}/api/files/${file!.id}`, { method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "other" });
    expect(overwrite.status).toBe(404);
    expect((await api("GET", `/evidence?recordType=car&recordId=${f.carId}&page=1&limit=200`)).body.items).toHaveLength(1);
  });
  it("maintains next number with backward protection and does not change Plan, Report or Finding ranges", async () => {
    const before = await readCarNumberState(orgId);
    const other = [await readPlanNumberState(orgId), await readReportNumberState(orgId), await readFindingNumberState(orgId)];
    const range = { scope: `project:${projectId}`, year: 2030, nextNumber: 126 };
    expect((await api("PUT", "/admin/car-numbering/ranges", range, employeeToken)).status).toBe(403);
    expect((await api("PUT", "/admin/car-numbering/ranges", { ...range, scope: `project:${randomUUID()}` })).status).toBe(404);
    for (const invalid of [{ ...range, nextNumber: 0 }, { ...range, nextNumber: 1.5 }, { ...range, year: 2030.5 }]) {
      expect((await api("PUT", "/admin/car-numbering/ranges", invalid)).status).toBe(422);
    }
    expect(await readCarNumberState(orgId)).toEqual(before);
    expect((await api("PUT", "/admin/car-numbering/ranges", range)).status).toBe(200);
    expect((await api("PUT", "/admin/car-numbering/ranges", { ...range, nextNumber: 125 })).status).toBe(409);
    const f = await makeCar(2030);
    expect((await api("PUT", `/cars/${f.carId}`, response)).body.carNumber).toBe("QAM-CC100-CAR-30-0126");
    expect((await api("PUT", "/admin/car-numbering", { ...pattern, prefix: "NEW" })).status).toBe(200);
    const second = await makeCar(2030);
    expect((await api("PUT", `/cars/${second.carId}`, response)).body.carNumber).toBe("NEW-CC100-CAR-30-0127");
    expect((await api("GET", `/cars/${f.carId}`)).body.carNumber).toBe("QAM-CC100-CAR-30-0126");
    expect([await readPlanNumberState(orgId), await readReportNumberState(orgId), await readFindingNumberState(orgId)]).toEqual(other);
    await saveCarNumbering(orgId, pattern);
  });
  it("honors CAR module actions for the assigned user without substituting other module grants", async () => {
    const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: `Module response ${suffix}` }).returning();
    const grant = async (key: string) => {
      const [permission] = await db.insert(auditPermissions).values({ organizationId: orgId, key, label: key, category: "audit" }).returning();
      await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id });
    };
    await grant("audit.cars.view_all"); await grant("audit.cars.create_edit");
    await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: employeeId, workspaceRoleId: role!.id });
    const f = await makeCar(2036);
    await db.update(audits).set({ checklistState: (f.audit.checklistState as Record<string, unknown>[]).map(item =>
      item.id === f.itemIds[0] ? { ...item, actionTakerId: employeeId } : item) }).where(eq(audits.id, f.audit.id));
    expect((await api("PUT", `/cars/${f.carId}`, response, employeeToken)).status).toBe(200);
    expect((await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true }, employeeToken)).status).toBe(403);
    await grant("audit.cars.submit");
    expect((await api("PUT", `/cars/${f.carId}`, { ...response, saveAndSubmit: true }, employeeToken)).status).toBe(200);
    const review = await makeCar(2037);
    await db.update(auditPlans).set({ status: JSON.stringify({ leadAuditorId: employeeId }) }).where(eq(auditPlans.id, review.plan.id));
    expect((await api("PUT", `/cars/${review.carId}`, { ...response, saveAndSubmit: true })).status).toBe(200);
    expect((await api("POST", `/cars/${review.carId}/review`, { decision: "accept" }, employeeToken)).status).toBe(403);
    await grant("audit.cars.approve_reject");
    expect((await api("POST", `/cars/${review.carId}/review`, { decision: "accept" }, employeeToken)).status).toBe(200);
  });
});
it.skipIf(process.env.QMS_AUDIT_CAR_CLEANUP !== "1")("removes only the isolated CAR browser fixture", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  await cleanup(fixture.orgId); await unlink(fixturePath);
});
