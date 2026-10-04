import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, reportTemplates } from "@workspace/db";
import {
  CreateQaqcPdfTemplateBody, CreateQaqcPdfTemplateResponse,
  ListQaqcPdfTemplatesResponse, GetQaqcPdfTemplateCatalogQueryParams, GetQaqcPdfTemplateCatalogResponse,
  UpdateQaqcPdfTemplateBody, UpdateQaqcPdfTemplateResponse,
  PublishQaqcPdfTemplateBody, PublishQaqcPdfTemplateResponse, InspectQaqcPdfTemplateResponse,
  ResumeQaqcPdfTemplateUploadBody, ResumeQaqcPdfTemplateUploadResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getAppAdminScope, getAuthorizedProjectScope, requireAppAccess } from "../middlewares/rbac";
import { asyncHandler, HttpError, writeAuditLog } from "../lib/workspace";
import { signedUploadUrl, storeObject } from "../lib/objectStorage";
import { inspectPdf, renderPdfLayout, sampleTemplateValues, templateSourceCatalog, validatePdfMappings } from "../lib/qaqc-pdf-layout";
import {
  changePdfTemplates, findPdfTemplate, listPdfTemplateRows, PDF_TEMPLATE_MARKER,
  publicTemplate, readTemplatePdf, templateMetadata, tenantTemplates, validatedTemplatePdf,
  type TemplateMetadata, type TemplateRow,
} from "../lib/qaqc-pdf-templates";

const router: IRouter = Router();
router.use(requireAuth, requireAppAccess("qaqc"));
const org = (req: Request) => req.currentUser!.organizationId;
async function admin(req: Request) {
  if (!(await getAuthorizedProjectScope(req, "qaqc", { module: "administration", action: "full", operation: "configure_masters" })).unrestricted) {
    throw new HttpError(403, "Organization-wide QA/QC administrator access is required to manage shared PDF templates");
  }
}
async function canRead(req: Request, type: string) {
  const module = type === "daily" ? "daily_reports" : type === "csat" ? "csat_reports" : "monthly_reports";
  const scope = await getAuthorizedProjectScope(req, "qaqc", { module, action: "select" });
  return scope.unrestricted || scope.projectIds.length > 0;
}
function checked<T>(result: { success: boolean; data?: T; error?: unknown }): T {
  if (!result.success) throw new HttpError(422, "Invalid PDF template request");
  return result.data!;
}
function pdf(res: any, bytes: Buffer, name: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf"`);
  res.send(bytes);
}
async function audit(req: Request, action: string, row: TemplateRow) {
  await writeAuditLog(db, "qaqc", {
    organizationId: org(req), actorId: req.currentUser!.id, action,
    entityType: "qaqc_pdf_template", entityId: row.id, after: { ...publicTemplate(row) },
  }, { dispatch: false });
}
async function replaceDraft(req: Request, id: string, update: (row: TemplateRow) => Promise<TemplateMetadata>) {
  return changePdfTemplates(org(req), async (tx) => {
    const [row] = await tx.select().from(reportTemplates)
      .where(and(tenantTemplates(org(req)), eq(reportTemplates.id, id))).limit(1);
    if (!row) throw new HttpError(404, "PDF template was not found");
    const meta = templateMetadata(row);
    if (meta.state !== "draft") throw new HttpError(409, "Published and archived versions are immutable; upload a new version");
    const next = await update(row);
    const [saved] = await tx.update(reportTemplates).set({ template: next, updatedAt: new Date() })
      .where(and(tenantTemplates(org(req)), eq(reportTemplates.id, id))).returning();
    return saved;
  });
}

router.get("/", asyncHandler(async (req, res) => {
  const drafts = req.query.includeDrafts === "true";
  if (drafts) await admin(req);
  if (req.query.reportType && !["monthly", "daily", "csat"].includes(String(req.query.reportType))) throw new HttpError(422, "Invalid report type");
  if (req.query.kind && !["report", "dashboard"].includes(String(req.query.kind))) throw new HttpError(422, "Invalid template kind");
  const readable = new Set<string>();
  for (const type of ["monthly", "daily", "csat"]) if (drafts || await canRead(req, type)) readable.add(type);
  const rows = (await listPdfTemplateRows(org(req))).filter(row => {
    const meta = templateMetadata(row);
    return readable.has(meta.reportType) && (drafts || meta.state === "published")
      && (!req.query.reportType || meta.reportType === req.query.reportType)
      && (!req.query.kind || meta.kind === req.query.kind);
  });
  res.json(ListQaqcPdfTemplatesResponse.parse(rows.map(publicTemplate)));
}));

router.get("/catalog", asyncHandler(async (req, res) => {
  await admin(req);
  const query = checked(GetQaqcPdfTemplateCatalogQueryParams.safeParse(req.query));
  res.json(GetQaqcPdfTemplateCatalogResponse.parse(templateSourceCatalog(query.reportType, query.kind)));
}));

router.post("/", asyncHandler(async (req, res) => {
  await admin(req);
  const body = checked(CreateQaqcPdfTemplateBody.safeParse(req.body));
  if (!body.name.trim() || !body.version.trim() || !Number.isInteger(body.fileSize) || !/\.pdf$/i.test(body.fileName)) {
    throw new HttpError(422, "Provide a name, version and PDF file under 10 MB");
  }
  const id = randomUUID();
  const upload = await signedUploadUrl(`qaqc-pdf-templates/${org(req)}/drafts/${id}.pdf`);
  const storagePath = upload.storageKey.replace(/^gcs:/, "");
  const row = await changePdfTemplates(org(req), async (tx) => {
    const existing = await tx.select().from(reportTemplates).where(tenantTemplates(org(req)));
    if (existing.some(candidate => candidate.name.trim().toLowerCase() === body.name.trim().toLowerCase()
      && candidate.template.format === PDF_TEMPLATE_MARKER && candidate.template.version === body.version.trim()
      && candidate.template.reportType === body.reportType && candidate.template.kind === body.kind)) {
      throw new HttpError(409, "This template name and version already exist; use a different version or name");
    }
    const meta: TemplateMetadata = { format: PDF_TEMPLATE_MARKER, storagePath, fileSize: body.fileSize,
      version: body.version.trim(), reportType: body.reportType, kind: body.kind, fileName: body.fileName,
      state: "draft", isDefault: false, uploaded: false, pages: [], fields: [], mappings: [] };
    const [created] = await tx.insert(reportTemplates).values({
      id, organizationId: org(req), name: body.name.trim(), template: meta,
    }).returning();
    return created;
  });
  await audit(req, "pdf_template_upload_requested", row);
  res.status(201).json(CreateQaqcPdfTemplateResponse.parse({ template: publicTemplate(row), uploadUrl: upload.uploadUrl }));
}));

router.post("/:id/inspect", asyncHandler(async (req, res) => {
  await admin(req);
  const source = await findPdfTemplate(org(req), String(req.params.id));
  const saved = await replaceDraft(req, source.id, async row => {
    const meta = templateMetadata(row);
    if (meta.uploaded) return meta;
    const bytes = await readTemplatePdf(org(req), row);
    let inspection;
    try { inspection = await inspectPdf(bytes); } catch (error) {
      throw new HttpError(422, error instanceof Error ? error.message : "Invalid PDF template");
    }
    // Copy out of the PUT-signed location: the upload URL cannot modify an inspected version.
    const storagePath = await storeObject(`qaqc-pdf-templates/${org(req)}/verified/${row.id}.pdf`, bytes, "application/pdf");
    return { ...meta, storagePath, uploaded: true, ...inspection, mappings: [], previewedAt: undefined };
  });
  await audit(req, "pdf_template_inspected", saved);
  res.json(InspectQaqcPdfTemplateResponse.parse(publicTemplate(saved)));
}));

router.post("/:id/upload", asyncHandler(async (req, res) => {
  await admin(req);
  const body = checked(ResumeQaqcPdfTemplateUploadBody.safeParse(req.body));
  if (!Number.isInteger(body.fileSize) || !/\.pdf$/i.test(body.fileName)) throw new HttpError(422, "Select a PDF under 10 MB");
  const source = await findPdfTemplate(org(req), String(req.params.id));
  const upload = await signedUploadUrl(`qaqc-pdf-templates/${org(req)}/drafts/${source.id}.pdf`);
  const saved = await replaceDraft(req, source.id, async row => {
    const meta = templateMetadata(row);
    if (meta.uploaded) throw new HttpError(409, "An inspected PDF cannot be replaced; upload a new version");
    return { ...meta, fileName: body.fileName, fileSize: body.fileSize };
  });
  await audit(req, "pdf_template_upload_resumed", saved);
  res.json(ResumeQaqcPdfTemplateUploadResponse.parse({ template: publicTemplate(saved), uploadUrl: upload.uploadUrl }));
}));

router.put("/:id", asyncHandler(async (req, res) => {
  await admin(req);
  const input = checked(UpdateQaqcPdfTemplateBody.safeParse(req.body));
  const source = await findPdfTemplate(org(req), String(req.params.id));
  const saved = await replaceDraft(req, source.id, async row => {
    const meta = templateMetadata(row);
    if (!meta.uploaded) throw new HttpError(422, "Upload and inspect the PDF first");
    try { validatePdfMappings(input.mappings, meta); } catch (error) {
      throw new HttpError(422, error instanceof Error ? error.message : "Invalid field mappings");
    }
    return { ...meta, mappings: input.mappings, previewedAt: undefined };
  });
  await audit(req, "pdf_template_mapping_saved", saved);
  res.json(UpdateQaqcPdfTemplateResponse.parse(publicTemplate(saved)));
}));

router.post("/:id/publish", asyncHandler(async (req, res) => {
  await admin(req);
  const body = checked(PublishQaqcPdfTemplateBody.safeParse(req.body));
  const source = await findPdfTemplate(org(req), String(req.params.id));
  const saved = await changePdfTemplates(org(req), async tx => {
    const rows = await tx.select().from(reportTemplates).where(tenantTemplates(org(req)));
    const row = rows.find(candidate => candidate.id === source.id)!;
    const meta = templateMetadata(row);
    if (body.state === "published") {
      if (meta.state === "archived") throw new HttpError(409, "Archived versions cannot be republished; upload a new version");
      if (!meta.uploaded || !meta.mappings.length || !meta.previewedAt) {
        throw new HttpError(422, "Save mappings and download a successful sample preview before publishing");
      }
      const bytes = await validatedTemplatePdf(org(req), row);
      try { await renderPdfLayout(bytes, meta.mappings, sampleTemplateValues(meta.reportType, meta.kind)); } catch (error) {
        throw new HttpError(422, error instanceof Error ? error.message : "Template preview failed");
      }
    }
    if (body.state === "published" && body.isDefault) {
      for (const other of rows) if (other.id !== row.id && other.template.format === PDF_TEMPLATE_MARKER) {
        const previous = templateMetadata(other);
        if (previous.reportType === meta.reportType && previous.kind === meta.kind && previous.isDefault) {
          await tx.update(reportTemplates).set({ template: { ...previous, isDefault: false }, updatedAt: new Date() })
            .where(eq(reportTemplates.id, other.id));
        }
      }
    }
    const [updated] = await tx.update(reportTemplates)
      .set({ template: { ...meta, state: body.state, isDefault: body.state === "published" && body.isDefault },
        updatedAt: new Date() })
      .where(and(tenantTemplates(org(req)), eq(reportTemplates.id, row.id))).returning();
    return updated;
  });
  await audit(req, body.state === "published" ? "pdf_template_published" : "pdf_template_archived", saved);
  res.json(PublishQaqcPdfTemplateResponse.parse(publicTemplate(saved)));
}));

router.get("/:id/pdf", asyncHandler(async (req, res) => {
  const row = await findPdfTemplate(org(req), String(req.params.id));
  const meta = templateMetadata(row);
  const preview = req.query.preview === "true";
  const isAdmin = (await getAppAdminScope(req, "qaqc"))?.unrestricted;
  if (preview || meta.state !== "published") await admin(req);
  else if (!isAdmin && !await canRead(req, meta.reportType)) throw new HttpError(403, "Reporting view permission is required");
  if (!meta.uploaded) throw new HttpError(422, "Upload and inspect the PDF first");
  const bytes = await validatedTemplatePdf(org(req), row);
  if (!preview) {
    pdf(res, await renderPdfLayout(bytes, [], {}), `${row.name}-${meta.version}-blank`);
    return;
  }
  let rendered: Buffer;
  try { rendered = await renderPdfLayout(bytes, meta.mappings, sampleTemplateValues(meta.reportType, meta.kind)); } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "PDF preview failed");
  }
  if (meta.state === "draft") {
    await replaceDraft(req, row.id, async current => {
      if (JSON.stringify(templateMetadata(current).mappings) !== JSON.stringify(meta.mappings)) {
        throw new HttpError(409, "Mappings changed during preview; preview the saved version again");
      }
      return { ...templateMetadata(current), previewedAt: new Date().toISOString() };
    });
  }
  pdf(res, rendered, `${row.name}-${meta.version}-sample-preview`);
}));

export default router;