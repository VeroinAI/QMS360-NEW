import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import {
  db, organizations, projects, platformRoles, users, applicationAccess, auditWorkspaceRoles,
  auditPermissions, auditWorkspaceRolePermissions, auditUserWorkspaceRoles, masterDataGroups,
  masterDataValues, auditSchedules, auditPlans, audits, auditAuditLogEntries, organizationSettings,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { readFindingNumberState, saveFindingNumbering } from "../src/lib/audit-finding-numbering";

let server: Server, base: string, orgId: string, projectId: string, otherProjectId: string;
let token: string, editorToken: string, viewerToken: string, userId: string, departmentId: string;
let retainedForBrowser = false;
const suffix = randomUUID().slice(0, 8);
const fixturePath = "/tmp/qms-finding-number-repair-fixture.json";
const cleanupOnly = process.env.QMS_FINDING_REPAIR_CLEANUP === "1";
async function cleanup(id: string) {
  for (const table of [auditAuditLogEntries, audits, auditPlans, auditSchedules, organizationSettings,
    masterDataValues, masterDataGroups, auditUserWorkspaceRoles, auditWorkspaceRolePermissions,
    auditWorkspaceRoles, auditPermissions, applicationAccess, users, platformRoles, projects]) {
    await db.delete(table).where(eq(table.organizationId, id));
  }
  await db.delete(organizations).where(eq(organizations.id, id));
}
async function api(path: string, auth = token, method = "POST", data?: unknown) {
  const response = await fetch(`${base}/api/audit${path}`, {
    method, headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function makeAudit(project: string | null = projectId, process = false) {
  const [schedule] = await db.insert(auditSchedules).values({
    organizationId: orgId, projectId: project, title: "Historical finding repair schedule", year: 2026,
    status: JSON.stringify({ plannedStartDate: "2026-03-01", plannedEndDate: "2026-03-03",
      auditTypes: [process ? "Quality Internal Process Audit" : "Quality Internal Product Audit"],
      ...(process ? { departmentProject: departmentId } : {}) }),
  }).returning();
  const [plan] = await db.insert(auditPlans).values({
    organizationId: orgId, projectId: project, auditScheduleId: schedule!.id,
    scope: "Historical repair verification", location: "Test site",
  }).returning();
  const items = ["Major NC", "Moderate NC", "OFI", "Not applicable"].map((auditFinding, i) => ({
    id: randomUUID(), clause: `${i + 1}`, auditArea: "Civil", question: `Saved question ${i + 1}`,
    auditFinding, description: `Saved finding ${i + 1}`, notes: "Original note", evidenceIds: [],
    actionTakerId: userId, recommendedPriorityAction: "Correct and close", findingCreatedAt: "2026-03-01T08:00:00Z",
    ...(i === 1 ? { source: "finding" } : {}),
  }));
  const [audit] = await db.insert(audits).values({
    organizationId: orgId, projectId: project, auditPlanId: plan!.id, referenceNumber: `Historical repair ${randomUUID()}`,
    workflowState: "closed", checklistState: items,
    status: JSON.stringify({ title: "Historical finding repair verification", reportNumber: `REPORT-${suffix}`, reportDetails: { values: {}, rows: {} } }),
  }).returning();
  return { audit: audit!, plan: plan!, items };
}
const numberPath = (auditId: string, itemId: string) => `/audits/${auditId}/finding-items/${itemId}/number`;
beforeAll(async () => {
  if (cleanupOnly) return;
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [org] = await db.insert(organizations).values({ name: `Finding repair ${suffix}`, code: `FR${suffix}` }).returning();
  orgId = org!.id;
  const projectRows = await db.insert(projects).values([
    { organizationId: orgId, name: "Historical repair project", code: `FR1${suffix}`, customFields: { qmsAdditionalData: { contractProjectNumber: "000123" } } },
    { organizationId: orgId, name: "Out of scope repair project", code: `FR2${suffix}` },
  ]).returning();
  projectId = projectRows[0]!.id; otherProjectId = projectRows[1]!.id;
  const roles = await db.insert(platformRoles).values([
    { organizationId: orgId, name: "Org Admin", isSystem: true }, { organizationId: orgId, name: "Employee", isSystem: true },
  ]).returning();
  const people = await db.insert(users).values([0, 1, 1].map((r, i) => ({
    organizationId: orgId, platformRoleId: roles[r]!.id, fullName: ["Repair administrator", "Repair scoped editor", "Repair viewer"][i]!,
    email: `repair-${i}-${suffix}@example.test`, username: `repair-${i}-${suffix}`,
  }))).returning();
  [token, editorToken, viewerToken] = people.map(issueToken); userId = people[0]!.id;
  await db.insert(applicationAccess).values(people.map(person => ({
    organizationId: orgId, username: person.username, canOpenAudit: true, status: "active",
  })));
  for (const [i, person] of people.entries()) {
    const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: `Repair role ${i}` }).returning();
    await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: person.id,
      workspaceRoleId: role!.id, projectIds: i ? [projectId] : [] });
    for (const module of ["audits", "plans", "schedules", "findings", "reports"]) {
      for (const op of ["view_all", ...(module === "findings" && i !== 2 ? ["create_edit"] : [])]) {
        const key = `audit.${module}.${op}`;
        let [permission] = await db.select().from(auditPermissions).where(and(eq(auditPermissions.organizationId, orgId), eq(auditPermissions.key, key)));
        if (!permission) [permission] = await db.insert(auditPermissions).values({ organizationId: orgId, key, label: key, category: "audit" }).returning();
        await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id });
      }
    }
  }
  const groups = await db.insert(masterDataGroups).values([
    { organizationId: orgId, name: "Department Master", code: "Department", appKey: "audit" },
    { organizationId: orgId, name: "Audit Area", code: "Audit Area", appKey: "audit" },
  ]).returning();
  const [department] = await db.insert(masterDataValues).values({ organizationId: orgId, groupId: groups[0]!.id,
    value: "CIV", label: "Civil department", metadata: { costId: "000456" } }).returning();
  departmentId = department!.id;
  await db.insert(masterDataValues).values({ organizationId: orgId, groupId: groups[1]!.id, value: "Civil", label: "Civil" });
  await saveFindingNumbering(orgId, { prefix: "QAM-IA", separator: "-", padding: 4,
    codes: { "Minor NC": "NCR", "Moderate NC": "NCR", "Major NC": "NCR", OFI: "OFI" } });
}, 30_000);
afterAll(async () => {
  if (cleanupOnly) return;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (orgId && !retainedForBrowser) await cleanup(orgId);
});

describe.skipIf(cleanupOnly)("Saved finding number repair API", () => {
  it("repairs completed checklist findings once, preserves content/status/dates, and exports the issued number", async () => {
    const { audit, items } = await makeAudit();
    const path = numberPath(audit.id, items[0]!.id);
    const before = await readFindingNumberState(orgId);
    const responses = await Promise.all(Array.from({ length: 4 }, () => api(path, editorToken)));
    expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200]);
    const item = responses[0]!.body.checklist.find((entry: any) => entry.id === items[0]!.id);
    expect(item.findingNumber).toMatch(/^QAM-IA-000123-NCR-26-\d{4}$/);
    const { findingNumber, findingNumberScope, findingNumberSequence, findingNumberYear, findingNumberType, ...rest } = item;
    expect(rest).toEqual(items[0]);
    const [saved] = await db.select().from(audits).where(eq(audits.id, audit.id));
    expect(saved!.workflowState).toBe(audit.workflowState);
    expect(saved!.status).toBe(audit.status); expect(saved!.createdAt).toEqual(audit.createdAt);
    const after = await readFindingNumberState(orgId);
    expect(after.ranges["Major NC"]![`project:${projectId}`]!["2026"]).toBe((before.ranges["Major NC"]?.[`project:${projectId}`]?.["2026"] ?? 0) + 1);
    const logs = await db.select().from(auditAuditLogEntries).where(and(eq(auditAuditLogEntries.organizationId, orgId),
      eq(auditAuditLogEntries.entityId, audit.id), eq(auditAuditLogEntries.action, "generate_missing_finding_number")));
    expect(logs).toHaveLength(1);
    const download = await fetch(`${base}/api/audit/audits/${audit.id}/report/pptx`, { headers: { authorization: `Bearer ${token}` } });
    expect(download.status).toBe(200);
    const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    expect(strFromU8(files["ppt/slides/slide11.xml"]!)).toContain(findingNumber);
    // A bulk checklist save cannot erase or forge the repaired reference.
    const save = await api(`/audits/${audit.id}/checklist`, token, "PUT",
      responses[0]!.body.checklist.map((row: any) => ({ ...row, findingNumber: "FORGED" })));
    expect(save.status).toBe(200);
    expect(save.body.checklist.find((row: any) => row.id === item.id).findingNumber).toBe(findingNumber);
  }, 30_000);
  it("repairs finding-only rows, uses per-type counters and never rewrites issued numbers after a format change", async () => {
    const { audit, items } = await makeAudit();
    const one = await api(numberPath(audit.id, items[1]!.id));
    expect(one.status).toBe(200);
    const numbered = one.body.checklist.find((item: any) => item.id === items[1]!.id);
    const before = await readFindingNumberState(orgId);
    await saveFindingNumbering(orgId, { ...before.pattern, prefix: "CHANGED" });
    const retry = await api(numberPath(audit.id, items[1]!.id));
    expect(retry.body.checklist.find((item: any) => item.id === items[1]!.id)).toEqual(numbered);
    expect((await readFindingNumberState(orgId)).ranges).toEqual(before.ranges);
    await saveFindingNumbering(orgId, before.pattern);
  });
  it("denies read-only users, out-of-project editors and missing findings without consuming numbers", async () => {
    const { audit, items } = await makeAudit(otherProjectId);
    const before = await readFindingNumberState(orgId);
    expect((await api(numberPath(audit.id, items[0]!.id), viewerToken)).status).toBe(403);
    expect([403, 404]).toContain((await api(numberPath(audit.id, items[0]!.id), editorToken)).status);
    expect((await api(numberPath(audit.id, randomUUID()))).status).toBe(404);
    expect((await api(numberPath(audit.id, items[3]!.id))).status).toBe(422);
    expect((await api(numberPath(randomUUID(), items[0]!.id))).status).toBe(404);
    expect(await readFindingNumberState(orgId)).toEqual(before);
  });
  it("reports missing master data and rolls back; department repairs use Cost ID and the original schedule year", async () => {
    const missing = await makeAudit(otherProjectId), before = await readFindingNumberState(orgId);
    const rejected = await api(numberPath(missing.audit.id, missing.items[0]!.id));
    expect(rejected.status).toBe(422); expect(rejected.body.error).toMatch(/Contract/);
    expect(await readFindingNumberState(orgId)).toEqual(before);
    const process = await makeAudit(null, true);
    expect([403, 404]).toContain((await api(numberPath(process.audit.id, process.items[0]!.id), editorToken)).status);
    const saved = await api(numberPath(process.audit.id, process.items[0]!.id));
    expect(saved.status).toBe(200);
    expect(saved.body.checklist.find((row: any) => row.id === process.items[0]!.id).findingNumber).toMatch(/^QAM-IA-000456-NCR-26-\d{4}$/);
  });
  it.skipIf(process.env.QMS_FINDING_REPAIR_BROWSER !== "1")("prepares an isolated UI fixture", async () => {
    const fixture = await makeAudit();
    await writeFile(fixturePath, JSON.stringify({ orgId, token, editorToken, viewerToken, auditId: fixture.audit.id,
      itemId: fixture.items[0]!.id, original: fixture.audit, projectId }), { mode: 0o600 });
    retainedForBrowser = true;
  });
});
it.skipIf(!cleanupOnly)("removes the isolated UI fixture and tokens", async () => {
  const { orgId: id } = JSON.parse(await readFile(fixturePath, "utf8"));
  await cleanup(id); await unlink(fixturePath);
});
