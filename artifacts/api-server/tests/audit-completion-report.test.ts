import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import {
  db, organizations, projects, platformRoles, users, applicationAccess,
  auditPlans, audits, auditFindings, correctiveActionReports, auditAuditLogEntries,
  auditPermissions, auditWorkspaceRoles, auditWorkspaceRolePermissions, auditUserWorkspaceRoles,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { buildConsolidatedAuditReport, auditIsComplete } from "../src/lib/audit-consolidated-report";
import { auditReportDetailsErrors } from "@workspace/field-controls";

const suffix = randomUUID().slice(0, 8);
let server: Server, base: string, orgId: string, token: string, viewerToken: string;
let auditId: string, browserAuditId: string, planId: string, projectId: string, findingId: string;
async function api(method: string, path: string, data?: unknown, auth = token) {
  const res = await fetch(`${base}/api/audit${path}`, { method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}
async function cleanup(id: string) {
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, id));
  await db.delete(correctiveActionReports).where(eq(correctiveActionReports.organizationId, id));
  await db.delete(auditFindings).where(eq(auditFindings.organizationId, id));
  await db.delete(audits).where(eq(audits.organizationId, id));
  await db.delete(auditPlans).where(eq(auditPlans.organizationId, id));
  await db.delete(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.organizationId, id));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, id));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, id));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, id));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, id));
  await db.delete(users).where(eq(users.organizationId, id));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, id));
  await db.delete(projects).where(eq(projects.organizationId, id));
  await db.delete(organizations).where(eq(organizations.id, id));
}
beforeAll(async () => {
  if (process.env.QMS_AUDIT_REPORT_CLEANUP === "1") return;
  if (process.env.QMS_AUDIT_REPORT_BROWSER === "1") {
    try {
      const fixture = JSON.parse(await readFile("/tmp/qms-audit-report-fixture.json", "utf8"));
      await cleanup(fixture.orgId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [org] = await db.insert(organizations).values({ name: `Report regression ${suffix}`, code: `RR${suffix}` }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ organizationId: orgId, name: "Regression project", code: `P${suffix}` }).returning();
  projectId = project!.id;
  const roles = await db.insert(platformRoles).values([
    { organizationId: orgId, name: "Org Admin", isSystem: true }, { organizationId: orgId, name: "Employee", isSystem: true },
  ]).returning();
  const people = await db.insert(users).values(roles.map((role, i) => ({
    organizationId: orgId, platformRoleId: role.id, fullName: i ? "Report viewer" : "Report administrator",
    email: `report-${i}-${suffix}@example.test`, username: `report-${i}-${suffix}`,
  }))).returning();
  token = issueToken(people[0]!); viewerToken = issueToken(people[1]!);
  const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: "Report reader" }).returning();
  const [permission] = await db.insert(auditPermissions).values({ organizationId: orgId, label: "Audit read", key: "audits", category: "Audit" }).returning();
  await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "select" });
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: people[1]!.id, workspaceRoleId: role!.id, projectIds: [projectId] });
  await db.insert(applicationAccess).values({ organizationId: orgId, username: people[1]!.username, projectId, canOpenAudit: true, status: "active" });
  const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, projectId, scope: "Actual scope", location: "Actual site" }).returning();
  planId = plan!.id;
  const rows = await db.insert(audits).values(["API report", "Browser completion"].map(title => ({
    organizationId: orgId, projectId, auditPlanId: planId, referenceNumber: `${title} ${suffix}`, workflowState: "planned",
    status: JSON.stringify({ title: `${title} ${suffix}`, additionalDocuments: {
      designStatus: [{ id: "a", label: "Status A", value: 4, remarks: "" }],
      goodPractices: [{ id: "gp", areaProcess: "Document control", verifiedConforming: "Controlled revision", evidenceReference: "Register 01", referenceNumber: "GP.1", evidenceId: null }],
    } }),
    checklistState: [{ id: "check-1", clause: "8.5", auditArea: "Construction", question: "Verify installation",
      description: "Installation record missing", auditFinding: "Major NC", evidenceIds: [], clientReference: "B.1.1" }],
  }))).returning();
  auditId = rows[0]!.id; browserAuditId = rows[1]!.id;
  const [finding] = await db.insert(auditFindings).values({ organizationId: orgId, auditId, title: "Legacy finding",
    description: "Legacy document gap", classification: "Minor NC", priority: "P6", status: "Open" }).returning();
  findingId = finding!.id;
  await db.insert(correctiveActionReports).values({ organizationId: orgId, auditFindingId: findingId, ownerId: people[0]!.id,
    responsibleDepartment: "QA", workflowState: "open", dueDate: "2026-10-20" });
}, 30_000);
afterAll(async () => {
  if (process.env.QMS_AUDIT_REPORT_CLEANUP === "1") return;
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (process.env.QMS_AUDIT_REPORT_BROWSER === "1" && browserAuditId) {
    await writeFile("/tmp/qms-audit-report-fixture.json", JSON.stringify({ orgId, token, viewerToken, auditId: browserAuditId, apiAuditId: auditId }), { mode: 0o600 });
    return;
  }
  if (orgId) await cleanup(orgId);
});
describe.skipIf(process.env.QMS_AUDIT_REPORT_CLEANUP === "1")("Audit completion and client report", () => {
  it("blocks unfinished reports, including CSV and PDF", async () => {
    expect((await api("GET", `/audits/${auditId}/report`)).status).toBe(409);
    expect((await api("GET", `/audits/${auditId}/report?format=csv`)).status).toBe(409);
    expect((await api("GET", `/audits/${auditId}/report/pdf`)).status).toBe(409);
    expect((await api("GET", `/audits/${auditId}/report/pptx`)).status).toBe(409);
  });
  it("does not grant completion or report editing to view-only users", async () => {
    expect((await api("GET", `/audits/${auditId}`, undefined, viewerToken)).body.canEdit).toBe(false);
    expect((await api("POST", `/audits/${auditId}/complete`, undefined, viewerToken)).status).toBe(403);
    expect((await api("PUT", `/audits/${auditId}/report-details`, { values: {}, rows: {} }, viewerToken)).status).toBe(403);
    expect((await api("GET", `/audits/${auditId}`)).body.canEdit).toBe(true);
  });
  it("rejects invalid report fields, dates, grades and phase weights", async () => {
    for (const values of [{ unknown: "x" }, { reportIssueDate: "2026-02-30" }, { overallRating: "Assumed effective" }]) {
      expect((await api("PUT", `/audits/${auditId}/report-details`, { values, rows: {} })).status).toBe(422);
    }
    expect(auditReportDetailsErrors({ values: {}, rows: { progress: [{ phase: "Build", weight: "70", plan: "101" }] } }).length).toBeGreaterThan(0);
    expect((await api("PUT", `/audits/${auditId}/report-details`, { values: {}, rows: { photographs: [{ fileName: "not-uploaded.png", date: "2026-10-04" }] } })).status).toBe(422);
  });
  it("saves report details without replacing other audit data", async () => {
    const result = await api("PUT", `/audits/${auditId}/report-details`, { values: { client: "Actual client", overallRating: "Effective", reportIssueDate: "2026-10-04" },
      rows: { recurringThemes: [{ theme: "Actual theme", indication: "Needs review", references: "B.1.1" }] } });
    expect(result.status).toBe(200); expect(result.body.reportDetails.values.client).toBe("Actual client");
    expect(result.body.additionalDocuments.goodPractices[0].verifiedConforming).toBe("Controlled revision");
    expect(result.body.checklist[0].clientReference).toBe("B.1.1");
  });
  it("completes idempotently, preserves metadata, and leaves CARs open", async () => {
    const first = await api("POST", `/audits/${auditId}/complete`);
    expect(first.status).toBe(200); expect(first.body.status).toBe("Complete"); expect(first.body.closedAt).toBeTruthy();
    expect((await api("POST", `/audits/${auditId}/complete`)).body.closedAt).toBe(first.body.closedAt);
    expect((await api("GET", `/audits/${auditId}`)).body.reportDetails.values.client).toBe("Actual client");
    const [car] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.auditFindingId, findingId));
    expect(car!.workflowState).toBe("open");
  });
  it("uses both checklist and legacy findings, actual document counts and all template sections", async () => {
    const result = await api("GET", `/audits/${auditId}/report`, undefined, viewerToken);
    expect(result.status).toBe(200);
    const sections = result.body.sections;
    expect(sections).toHaveLength(18);
    expect(sections.find((s: any) => s.key === "cover").fields.find((f: any) => f.label === "Audit dates").value).not.toContain("1970");
    expect(sections.find((s: any) => s.key === "cover").fields.find((f: any) => f.label === "Audit reference").value).toContain("API report");
    const summary = sections.find((s: any) => s.key === "executive-summary");
    expect(summary.fields.find((f: any) => f.label === "Non-conformities").value).toBe("2");
    expect(sections.find((s: any) => s.key === "non-conformities").tables[0].rows).toHaveLength(2);
    expect(sections.find((s: any) => s.key === "design-procurement").tables[0].rows[0]).toEqual(["Status A", "4", "100.00%"]);
    expect(sections.find((s: any) => s.key === "conforming").tables[1].rows[0]).toContain("Controlled revision");
    expect(sections.find((s: any) => s.key === "corrective-actions").tables[0].rows[0]).toContain("Open");
  });
  it("downloads PowerPoint read-only and preserves export access boundaries", async () => {
    const before = await db.select().from(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId));
    const res = await fetch(`${base}/api/audit/audits/${auditId}/report/pptx`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(res.headers.get("content-disposition")).toContain(`audit-report-${auditId}.pptx`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75]);
    expect((await db.select().from(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId))).length).toBe(before.length);
    const [car] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.auditFindingId, findingId));
    expect(car!.workflowState).toBe("open");
    // Legacy module "select" retains its existing export right; narrower modern view grants do not.
    const legacy = await fetch(`${base}/api/audit/audits/${auditId}/report/pptx`, { headers: { authorization: `Bearer ${viewerToken}` } });
    expect(legacy.status).toBe(200);
    const [permission] = await db.select().from(auditPermissions).where(eq(auditPermissions.organizationId, orgId));
    try {
      await db.update(auditPermissions).set({ key: "audit.audits.view_all" }).where(eq(auditPermissions.id, permission!.id));
      const denied = await fetch(`${base}/api/audit/audits/${auditId}/report/pptx`, { headers: { authorization: `Bearer ${viewerToken}` } });
      expect(denied.status).toBe(403);
    } finally {
      await db.update(auditPermissions).set({ key: "audits" }).where(eq(auditPermissions.id, permission!.id));
    }
    expect((await fetch(`${base}/api/audit/audits/${auditId}/report/pptx`)).status).toBe(401);
    expect((await fetch(`${base}/api/audit/audits/${randomUUID()}/report/pptx`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });
  it("preserves completion through concurrent meeting and report edits", async () => {
    const results = await Promise.all([
      api("PUT", `/audits/${auditId}/opening-meeting`, { heldAt: "2026-10-04T10:00:00Z", attendees: [], minutes: "Actual meeting" }),
      api("PUT", `/audits/${auditId}/report-details`, { values: { client: "Concurrent client" }, rows: {} }),
    ]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const result = await api("GET", `/audits/${auditId}`);
    expect(result.body.status).toBe("Complete"); expect(result.body.closedAt).toBeTruthy();
    expect(result.body.openingMeeting.minutes).toBe("Actual meeting");
    expect(result.body.reportDetails.values.client).toBe("Concurrent client");
  });
  it("downloads a readable PDF with all report sections", async () => {
    const res = await fetch(`${base}/api/audit/audits/${auditId}/report/pdf`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200); expect(res.headers.get("content-type")).toContain("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer()), pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(18);
    await writeFile("/tmp/qms-audit-consolidated-check.pdf", bytes);
  }, 30_000);
  it("recognizes legacy Closed and does not infer a system-effectiveness rating", () => {
    expect(auditIsComplete("closed")).toBe(true); expect(auditIsComplete("planned")).toBe(false);
    const sections = buildConsolidatedAuditReport({ audit: { title: "Process audit" }, legacyFindings: [], cars: [], evidence: [], names: new Map(), roleNames: new Map() });
    expect(sections.find(s => s.key === "executive-summary")!.fields.find(f => f.label === "Overall rating")!.value).toBe("Not recorded");
  });
  it("does not substitute upload time for a photograph capture date", () => {
    const input = { audit: { title: "Photo audit" }, legacyFindings: [], cars: [],
      evidence: [{ id: "photo", fileName: "inspection.png", mimeType: "image/png", createdAt: "2026-10-04T12:00:00Z" }],
      names: new Map<string, string>(), roleNames: new Map<string, string>() };
    const photo = (data: typeof input) => buildConsolidatedAuditReport(data).find(s => s.key === "photographs")!.photos[0]!;
    expect(photo(input).description).toContain("Date captured: Not recorded");
    const detailed = { ...input, audit: { ...input.audit, reportDetails: { values: {}, rows: {
      photographs: [{ fileName: "inspection.png", date: "2026-10-02", location: "Actual site" }],
    } } } };
    expect(photo(detailed).description).toContain("Date captured: 2026-10-02");
    expect(photo(detailed).description).toContain("Location: Actual site");
  });
});
it.skipIf(process.env.QMS_AUDIT_REPORT_CLEANUP !== "1")("removes only the temporary browser test organization", async () => {
  const fixture = JSON.parse(await readFile("/tmp/qms-audit-report-fixture.json", "utf8"));
  await cleanup(fixture.orgId);
  await unlink("/tmp/qms-audit-report-fixture.json");
});