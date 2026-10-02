import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { inArray } from "drizzle-orm";
import {
  applicationAccess, auditLogEntries, db, organizations, permissions, platformRoles, projects,
  qaqcReportSubmissions, reportTemplates, userWorkspaceRoles, users, workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import { issueToken } from "../src/lib/auth";

const { objects, uploadKeys } = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  uploadKeys: new Map<string, string>(),
}));

vi.mock("../src/lib/objectStorage", () => ({
  signedUploadUrl: vi.fn(async (relativePath: string) => {
    const storageKey = `gcs:${process.env.PRIVATE_OBJECT_DIR}/${relativePath}`;
    const uploadUrl = `http://fake-upload.invalid/${encodeURIComponent(storageKey)}`;
    uploadKeys.set(uploadUrl, storageKey);
    return { storageKey, uploadUrl };
  }),
  storeObject: vi.fn(async (relativePath: string, bytes: Buffer) => {
    const storageKey = `${process.env.PRIVATE_OBJECT_DIR}/${relativePath}`;
    objects.set(storageKey, Uint8Array.from(bytes));
    return storageKey;
  }),
  getObject: vi.fn(async (storagePath: string) => {
    const bytes = objects.get(storagePath);
    if (!bytes) throw new Error(`Missing in-memory test object: ${storagePath}`);
    return new Response(Uint8Array.from(bytes), { headers: { "content-length": String(bytes.byteLength) } });
  }),
  removeObject: vi.fn(async () => undefined),
}));

import pdfTemplatesRouter from "../src/routes/qaqc-pdf-templates";
import reportingToolsRouter from "../src/routes/qaqc-reporting-tools";
import { exportQaqcDashboardPdf, exportQaqcReportPdf } from "../src/lib/qaqc-reporting-export";

let server: Server;
let baseUrl: string;
let orgId: string;
let foreignOrgId: string;
let projectId: string;
let admin: { id: string; token: string; username: string };
let member: { id: string; token: string; username: string };
let foreignAdmin: { id: string; token: string; username: string };
const orgIds: string[] = [];
const suffix = Math.random().toString(36).slice(2, 9);

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* binary downloads */ }
  return { status: response.status, json, bytes, response };
}

async function createUser(name: string, organizationId: string, platformRoleId?: string) {
  const userName = `${name}.${suffix}`.toLowerCase().replaceAll(" ", ".");
  const [row] = await db.insert(users).values({
    organizationId, email: `${userName}@test.invalid`, username: userName, fullName: name,
    platformRoleId: platformRoleId ?? null,
  }).returning();
  return { id: row!.id, username: row!.username, token: issueToken(row!) };
}

async function grantMember(userId: string, projectIds: string[]) {
  const [role] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: `QA/QC reporting viewer ${suffix}` }).returning();
  const [permission] = await db.insert(permissions).values({
    organizationId: orgId, key: "view_all", label: "QA/QC report view", category: "qaqc",
  }).returning();
  await db.insert(workspaceRolePermissions).values({
    organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full",
  });
  await db.insert(userWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: role!.id, projectIds });
}

async function makePdf(options: { pages?: number; fields?: boolean; xfa?: boolean } = {}) {
  const document = await PDFDocument.create();
  for (let index = 0; index < (options.pages ?? 2); index++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Designed template page ${index + 1}`, { x: 40, y: 740, font: await document.embedFont(StandardFonts.Helvetica) });
  }
  if (options.fields) {
    const form = document.getForm();
    const field = form.createTextField("report.reference");
    field.setText("PREPOPULATED VALUE");
    field.addToPage(document.getPages()[0]!, { x: 40, y: 680, width: 220, height: 28 });
  }
  if (options.xfa) {
    const acroForm = document.context.lookup(document.catalog.get(PDFName.of("AcroForm"))!) as PDFDict;
    acroForm.set(PDFName.of("XFA"), PDFString.of("<xdp:xdp/>"));
  }
  return Buffer.from(await document.save({ updateFieldAppearances: !options.xfa }));
}

async function createTemplate(token: string, name: string, version = "1", reportType = "monthly", kind = "report") {
  const pdf = await makePdf({ fields: true });
  const created = await api("POST", "/", token, { name, version, reportType, kind, fileName: `${name}.pdf`, fileSize: pdf.length });
  expect(created.status).toBe(201);
  const key = uploadKeys.get(created.json.uploadUrl);
  if (!key) throw new Error("Fake upload URL did not resolve to a storage key");
  objects.set(key.replace(/^gcs:/, ""), Uint8Array.from(pdf));
  return { template: created.json.template, pdf };
}

async function uploadPdf(token: string, name: string, pdf: Buffer) {
  const created = await api("POST", "/", token, {
    name, version: "1", reportType: "monthly", kind: "report", fileName: `${name}.pdf`, fileSize: pdf.length,
  });
  expect(created.status).toBe(201);
  objects.set(uploadKeys.get(created.json.uploadUrl)!.replace(/^gcs:/, ""), Uint8Array.from(pdf));
  return created.json.template;
}

async function inspect(token: string, id: string) {
  return api("POST", `/${id}/inspect`, token);
}

const fieldMapping = [{ source: "referenceNumber", pdfField: "report.reference" }];

async function makeReady(token: string, name: string, version = "1", reportType = "monthly", kind = "report", mapping = fieldMapping) {
  const created = await createTemplate(token, name, version, reportType, kind);
  const inspection = await inspect(token, created.template.id);
  expect(inspection.status).toBe(200);
  expect(inspection.json.fields).toContainEqual({ name: "report.reference", type: "PDFTextField" });
  const saved = await api("PUT", `/${created.template.id}`, token, { mappings: mapping });
  expect(saved.status).toBe(200);
  return { ...created, inspected: inspection.json, saved: saved.json };
}

async function publish(token: string, id: string, isDefault = false) {
  const preview = await api("GET", `/${id}/pdf?preview=true`, token);
  expect(preview.status).toBe(200);
  const published = await api("POST", `/${id}/publish`, token, { state: "published", isDefault });
  return { preview, published };
}

beforeAll(async () => {
  vi.stubEnv("PRIVATE_OBJECT_DIR", "/test-bucket/private");
  const app = express();
  app.use(express.json());
  app.use("/api/qaqc/reporting/pdf-templates", pdfTemplatesRouter);
  app.use("/api/qaqc/reporting", reportingToolsRouter);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind PDF-template integration server");
  baseUrl = `http://127.0.0.1:${address.port}/api/qaqc/reporting/pdf-templates`;

  const [organization, foreign] = await db.insert(organizations).values([
    { name: `PDF template integration ${suffix}`, code: `PT${suffix}` },
    { name: `PDF template foreign ${suffix}`, code: `PF${suffix}` },
  ]).returning();
  orgId = organization!.id;
  foreignOrgId = foreign!.id;
  orgIds.push(orgId, foreignOrgId);
  const [orgAdminRole] = await db.insert(platformRoles).values({
    organizationId: orgId, name: "Org Admin", isSystem: true,
  }).returning();
  const [foreignAdminRole] = await db.insert(platformRoles).values({
    organizationId: foreignOrgId, name: "Org Admin", isSystem: true,
  }).returning();
  const orgAdminUser = await createUser("PDF admin", orgId, orgAdminRole!.id);
  const memberUser = await createUser("PDF member", orgId);
  const foreignAdminUser = await createUser("PDF foreign admin", foreignOrgId, foreignAdminRole!.id);
  admin = orgAdminUser;
  member = memberUser;
  foreignAdmin = foreignAdminUser;
  const [project] = await db.insert(projects).values([
    { organizationId: orgId, code: `P-${suffix}`, name: "PDF test project" },
  ]).returning();
  projectId = project!.id;
  await db.insert(applicationAccess).values([
    { organizationId: orgId, username: member.username, canOpenQaqc: true },
  ]);
  await grantMember(member.id, [projectId]);
});

afterAll(async () => {
  if (orgIds.length) {
    await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, orgIds));
    await db.delete(qaqcReportSubmissions).where(inArray(qaqcReportSubmissions.organizationId, orgIds));
    await db.delete(reportTemplates).where(inArray(reportTemplates.organizationId, orgIds));
    await db.delete(applicationAccess).where(inArray(applicationAccess.organizationId, orgIds));
    await db.delete(userWorkspaceRoles).where(inArray(userWorkspaceRoles.organizationId, orgIds));
    await db.delete(workspaceRolePermissions).where(inArray(workspaceRolePermissions.organizationId, orgIds));
    await db.delete(permissions).where(inArray(permissions.organizationId, orgIds));
    await db.delete(workspaceRoles).where(inArray(workspaceRoles.organizationId, orgIds));
    await db.delete(projects).where(inArray(projects.organizationId, orgIds));
    await db.delete(users).where(inArray(users.organizationId, orgIds));
    await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  objects.clear();
  uploadKeys.clear();
  vi.unstubAllEnvs();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("QA/QC reporting PDF template HTTP and export integration", () => {
  it("runs draft upload, inspection, mapping, sample preview, publish, and version duplicate validation", async () => {
    const draft = await createTemplate(admin.token, "Monthly template");
    expect(draft.template).toMatchObject({ state: "draft", uploaded: false, pages: [], mappings: [] });
    const duplicate = await api("POST", "/", admin.token, {
      name: " monthly TEMPLATE ", version: "1", reportType: "monthly", kind: "report",
      fileName: "different.pdf", fileSize: draft.pdf.length,
    });
    expect(duplicate.status).toBe(409);
    const wrongSize = await api("POST", "/", admin.token, {
      name: "Wrong size", version: "1", reportType: "monthly", kind: "report",
      fileName: "wrong.pdf", fileSize: draft.pdf.length + 1,
    });
    // The upload request declares metadata only; actual byte-size validation
    // happens after the direct upload, at inspection.
    expect(wrongSize.status).toBe(201);
    objects.set(uploadKeys.get(wrongSize.json.uploadUrl)!.replace(/^gcs:/, ""), draft.pdf);
    expect((await inspect(admin.token, wrongSize.json.template.id)).status).toBe(422);
    const invalidFileName = await api("POST", "/", admin.token, {
      name: "Wrong extension", version: "1", reportType: "monthly", kind: "report",
      fileName: "wrong.txt", fileSize: 10,
    });
    expect(invalidFileName.status).toBe(422);

    const inspection = await inspect(admin.token, draft.template.id);
    expect(inspection.status).toBe(200);
    expect(inspection.json).toMatchObject({
      uploaded: true, pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }],
      fields: [{ name: "report.reference", type: "PDFTextField" }],
    });
    const invalidMapping = await api("PUT", `/${draft.template.id}`, admin.token, {
      mappings: [{ source: "referenceNumber", pdfField: "missing.field" }],
    });
    expect(invalidMapping.status).toBe(422);
    expect((await api("POST", `/${draft.template.id}/publish`, admin.token, { state: "published", isDefault: true })).status).toBe(422);

    const mappings = await api("PUT", `/${draft.template.id}`, admin.token, { mappings: fieldMapping });
    expect(mappings.status).toBe(200);
    const blankForm = await api("GET", `/${draft.template.id}/pdf`, admin.token);
    expect(blankForm.status).toBe(200);
    const blankDocument = await PDFDocument.load(blankForm.bytes);
    expect(blankDocument.getPageCount()).toBe(2);
    expect(blankDocument.getForm().getTextField("report.reference").getText() ?? "").toBe("");
    const preview = await api("GET", `/${draft.template.id}/pdf?preview=true`, admin.token);
    expect(preview.status).toBe(200);
    const rendered = await PDFDocument.load(preview.bytes);
    expect(rendered.getPageCount()).toBe(2);
    expect(rendered.getForm().getFields()).toHaveLength(0);
    const published = await api("POST", `/${draft.template.id}/publish`, admin.token, { state: "published", isDefault: true });
    expect(published.status).toBe(200);
    expect(published.json).toMatchObject({ state: "published", isDefault: true });

    expect((await api("POST", `/${draft.template.id}/inspect`, admin.token)).status).toBe(409);
    expect((await api("POST", `/${draft.template.id}/upload`, admin.token, {
      fileName: "replacement.pdf", fileSize: draft.pdf.length,
    })).status).toBe(409);
    expect((await api("PUT", `/${draft.template.id}`, admin.token, { mappings: [] })).status).toBe(409);
    expect((await api("GET", `/${draft.template.id}/pdf?preview=true`, member.token)).status).toBe(403);
  });

  it("rejects malformed uploads, supports upload resume, mapping invalidation, and incomplete draft publication", async () => {
    const draft = await createTemplate(admin.token, "Resumable");
    const malformed = Buffer.from("not-a-pdf");
    const storedPath = `${process.env.PRIVATE_OBJECT_DIR}/qaqc-pdf-templates/${orgId}/drafts/${draft.template.id}.pdf`;
    objects.set(storedPath, malformed);
    expect((await inspect(admin.token, draft.template.id)).status).toBe(422);
    objects.set(storedPath, Uint8Array.from([...draft.pdf, 0]));
    expect((await inspect(admin.token, draft.template.id)).status).toBe(422);
    const resumed = await api("POST", `/${draft.template.id}/upload`, admin.token, {
      fileName: "resumed.pdf", fileSize: draft.pdf.length,
    });
    expect(resumed.status).toBe(200);
    objects.set(uploadKeys.get(resumed.json.uploadUrl)!.replace(/^gcs:/, ""), Uint8Array.from(draft.pdf));
    expect((await inspect(admin.token, draft.template.id)).status).toBe(200);
    expect((await api("PUT", `/${draft.template.id}`, admin.token, { mappings: fieldMapping })).status).toBe(200);
    expect((await api("GET", `/${draft.template.id}/pdf?preview=true`, admin.token)).status).toBe(200);
    expect((await api("PUT", `/${draft.template.id}`, admin.token, { mappings: [{ source: "referenceNumber", page: 1, x: 50, y: 50, width: 160, height: 24 }] })).status).toBe(200);
    expect((await api("POST", `/${draft.template.id}/publish`, admin.token, { state: "published", isDefault: false })).status).toBe(422);

    const invalidSource = await createTemplate(admin.token, "Invalid sample source");
    await inspect(admin.token, invalidSource.template.id);
    await api("PUT", `/${invalidSource.template.id}`, admin.token, { mappings: [{ source: "not.a.real.source", page: 1, x: 30, y: 30, width: 200, height: 40 }] });
    expect((await api("GET", `/${invalidSource.template.id}/pdf?preview=true`, admin.token)).status).toBe(422);

    const xfaTemplate = await uploadPdf(admin.token, "XFA form", await makePdf({ fields: true, xfa: true }));
    const xfaInspection = await inspect(admin.token, xfaTemplate.id);
    expect(xfaInspection.status).toBe(422);
    expect(xfaInspection.json.error).toMatch(/XFA PDFs are not supported/);
  });

  it("enforces member read-only access, project select permission, tenant isolation, and published-only listing", async () => {
    const ready = await makeReady(admin.token, "Member visible");
    await publish(admin.token, ready.template.id, false);
    const hiddenDraft = await createTemplate(admin.token, "Admin draft only");
    const list = await api("GET", "/", member.token);
    expect(list.status).toBe(200);
    expect(list.json.map((template: { id: string }) => template.id)).toContain(ready.template.id);
    expect(list.json.map((template: { id: string }) => template.id)).not.toContain(hiddenDraft.template.id);
    expect((await api("GET", "/?includeDrafts=true", member.token)).status).toBe(403);
    expect((await api("POST", "/", member.token, {
      name: "No member write", version: "1", reportType: "monthly", kind: "report", fileName: "x.pdf", fileSize: 100,
    })).status).toBe(403);
    expect((await api("GET", `/${hiddenDraft.template.id}/pdf?preview=true`, admin.token)).status).toBe(422);
    expect((await api("GET", `/${ready.template.id}/pdf`, member.token)).status).toBe(200);

    const foreignCreated = await api("POST", "/", foreignAdmin.token, {
      name: "Foreign", version: "1", reportType: "monthly", kind: "report", fileName: "foreign.pdf", fileSize: 100,
    });
    expect(foreignCreated.status).toBe(201);
    expect((await api("GET", `/${foreignCreated.json.template.id}/pdf`, admin.token)).status).toBe(404);
    expect((await api("GET", `/${ready.template.id}/pdf?preview=true`, foreignAdmin.token)).status).toBe(404);
  });

  it("switches the default atomically, archives without deleting, and keeps default metadata tenant scoped", async () => {
    const first = await makeReady(admin.token, "Default v1", "1");
    expect((await publish(admin.token, first.template.id, true)).published.status).toBe(200);
    const second = await makeReady(admin.token, "Default v2", "2");
    expect((await publish(admin.token, second.template.id, true)).published.status).toBe(200);
    const rows = (await api("GET", "/?includeDrafts=true&reportType=monthly&kind=report", admin.token)).json;
    expect(rows.find((item: { id: string }) => item.id === first.template.id)).toMatchObject({ state: "published", isDefault: false });
    expect(rows.find((item: { id: string }) => item.id === second.template.id)).toMatchObject({ state: "published", isDefault: true });
    const archived = await api("POST", `/${first.template.id}/publish`, admin.token, { state: "archived", isDefault: false });
    expect(archived.status).toBe(200);
    expect(archived.json.state).toBe("archived");
    expect((await api("GET", "/?includeDrafts=true", admin.token)).json.map((item: { id: string }) => item.id)).toContain(first.template.id);
    expect((await api("POST", `/${first.template.id}/publish`, admin.token, { state: "published", isDefault: true })).status).toBe(409);
  });

  it("previews and publishes sample layouts for monthly, daily, and CSAT reports", async () => {
    for (const [type, version] of [["monthly", "11"], ["daily", "12"], ["csat", "13"]] as const) {
      const ready = await makeReady(admin.token, `Type ${type}`, version, type);
      const result = await publish(admin.token, ready.template.id);
      expect(result.preview.status).toBe(200);
      expect((await PDFDocument.load(result.preview.bytes)).getForm().getFields()).toHaveLength(0);
      expect(result.published.status).toBe(200);
    }
  });

  it("exports selected report PDFs as template pages plus the complete report appendix, and validates selection", async () => {
    const ready = await makeReady(admin.token, "Export report");
    await publish(admin.token, ready.template.id, false);
    const [report] = await db.insert(qaqcReportSubmissions).values({
      organizationId: orgId, projectId, reportType: "monthly", period: "2025-01-01", state: "approved",
      data: { narrative: "appendix-preserved-report-row" }, computed: { marker: "computed-preserved" },
      baseline: { marker: "frozen-baseline-preserved" }, createdById: member.id,
    }).returning();
    const reportValue = {
      id: report!.id, organizationId: orgId, projectId, projectName: "PDF test project", projectCode: `P-${suffix}`,
      reportType: "monthly", period: "2025-01-01", state: "approved", data: report!.data as Record<string, unknown>,
      referenceNumber: report!.referenceNumber,
      computed: report!.computed as Record<string, unknown>, baseline: report!.baseline as Record<string, unknown>,
      reportTemplates: [{ name: "Export report", template: { format: "qaqc-exact-pdf-v1", state: "published", isDefault: false, kind: "report", reportType: "monthly" } }],
    };
    const selected = await exportQaqcReportPdf(reportValue, { templateId: ready.template.id });
    const baseline = await exportQaqcReportPdf(reportValue, { templateId: "builtin" });
    const designed = await PDFDocument.load(selected);
    const builtIn = await PDFDocument.load(baseline);
    expect(designed.getPageCount()).toBe(2 + builtIn.getPageCount());
    expect(designed.getForm().getFields()).toHaveLength(0);
    expect((await PDFDocument.load(await exportQaqcReportPdf(reportValue))).getPageCount()).toBe(builtIn.getPageCount());
    const wrongType = await makeReady(admin.token, "Daily report layout", "1", "daily");
    await publish(admin.token, wrongType.template.id);
    await expect(exportQaqcReportPdf(reportValue, { templateId: wrongType.template.id })).rejects.toThrow(/correct report type/);

    const reportingUrl = baseUrl.replace("/pdf-templates", "");
    const selectedResponse = await fetch(`${reportingUrl}/reports/${report!.id}/export?format=pdf&templateId=${ready.template.id}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(selectedResponse.status).toBe(200);
    const actualPages = (await PDFDocument.load(Buffer.from(await selectedResponse.arrayBuffer()))).getPageCount();
    const builtinResponse = await fetch(`${reportingUrl}/reports/${report!.id}/export?format=pdf&templateId=builtin`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const completePages = (await PDFDocument.load(Buffer.from(await builtinResponse.arrayBuffer()))).getPageCount();
    // HTTP includes the tenant's complete template metadata and audit history,
    // whereas the direct fixture deliberately contains only one metadata row.
    expect(actualPages).toBe(2 + completePages);
    const wrongTypeResponse = await fetch(`${reportingUrl}/reports/${report!.id}/export?format=pdf&templateId=${wrongType.template.id}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(wrongTypeResponse.status).toBe(422);
    const foreignSelected = await fetch(`${reportingUrl}/reports/${report!.id}/export?format=pdf&templateId=${ready.template.id}`, {
      headers: { authorization: `Bearer ${foreignAdmin.token}` },
    });
    expect(foreignSelected.status).toBe(404);
  });

  it("renders manual and scheduled dashboard shapes with selected/default templates and preserves all appended rows and filters", async () => {
    const ready = await makeReady(admin.token, "Dashboard layout", "1", "monthly", "dashboard", [
      { source: "title", page: 1, x: 42, y: 600, width: 400, height: 40 },
    ]);
    await publish(admin.token, ready.template.id, true);
    const report = {
      id: "scheduled-report", organizationId: orgId, projectId, projectName: "PDF test project", projectCode: `P-${suffix}`,
      reportType: "monthly", period: "2025-01-01", state: "approved", data: { narrative: "schedule-report-row" },
      computed: { pqi: 90 }, baseline: { pqi: 80 }, history: [{ action: "approved" }],
    };
    const manual = {
      organizationId: orgId, reportType: "monthly", title: "Manual dashboard shape",
      filters: { from: "2025-01-01", to: "2025-01-31", projectId },
      summary: { projects: 1 }, rows: [{ projectName: "Visible row", pqi: 90 }],
      dashboardData: { marker: "full-dashboard-data" }, trends: [{ period: "2025-01-01" }],
      reports: [report],
    };
    const selected = await exportQaqcDashboardPdf(manual, { templateId: ready.template.id });
    const defaulted = await exportQaqcDashboardPdf({
      ...manual,
      reports: [{ ...report, reportTemplates: [{ name: "Dashboard layout", template: {
        format: "qaqc-exact-pdf-v1", state: "published", isDefault: true, kind: "dashboard", reportType: "monthly",
      } }] }],
    });
    const baseline = await exportQaqcDashboardPdf(manual, { templateId: "builtin" });
    const selectedDoc = await PDFDocument.load(selected);
    expect(selectedDoc.getPageCount()).toBe((await PDFDocument.load(baseline)).getPageCount() + 2);
    expect((await PDFDocument.load(defaulted)).getPageCount()).toBe(selectedDoc.getPageCount());
    const scheduled = {
      ...manual,
      title: "Scheduled-shaped dashboard",
      filters: { from: "2025-01-01", to: "2025-01-31", reportType: "monthly" },
      reports: [{ ...report, reportTemplates: [{ name: "Dashboard layout", template: {
        format: "qaqc-exact-pdf-v1", state: "published", isDefault: true, kind: "dashboard", reportType: "monthly",
      } }] }],
    };
    expect((await PDFDocument.load(await exportQaqcDashboardPdf(scheduled, { templateId: ready.template.id }))).getPageCount())
      .toBe(selectedDoc.getPageCount());
    expect((await PDFDocument.load(await exportQaqcDashboardPdf(scheduled))).getPageCount()).toBe(selectedDoc.getPageCount());
    expect((await PDFDocument.load(await exportQaqcDashboardPdf(manual, { templateId: "builtin" }))).getPageCount())
      .toBe((await PDFDocument.load(baseline)).getPageCount());
    const reportingUrl = baseUrl.replace("/pdf-templates", "");
    const selectedResponse = await fetch(`${reportingUrl}/dashboard/export?format=pdf&reportType=monthly&templateId=${ready.template.id}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(selectedResponse.status).toBe(200);
    const apiSelected = await PDFDocument.load(Buffer.from(await selectedResponse.arrayBuffer()));
    expect(apiSelected.getPageCount()).toBeGreaterThan(2);
  });
});