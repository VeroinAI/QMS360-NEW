import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, reportTemplates } from "@workspace/db";
import { PDFDocument } from "pdf-lib";
import type { QaqcPdfTemplate } from "@workspace/api-zod";
import { getObject } from "./objectStorage";
import { HttpError } from "./workspace";
import { inspectPdf, renderPdfLayout, type PdfMapping } from "./qaqc-pdf-layout";

export const PDF_TEMPLATE_MARKER = "qaqc-exact-pdf-v1";
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export type TemplateRow = typeof reportTemplates.$inferSelect;
export type TemplateMetadata = Omit<QaqcPdfTemplate, "id" | "name"> & {
  format: typeof PDF_TEMPLATE_MARKER;
  storagePath: string;
  fileSize: number;
  previewedAt?: string;
};

export function isPdfTemplate(row: TemplateRow) {
  return row.template.format === PDF_TEMPLATE_MARKER;
}

export function templateMetadata(row: TemplateRow): TemplateMetadata {
  if (!isPdfTemplate(row)) throw new HttpError(404, "PDF template was not found");
  return row.template as TemplateMetadata;
}

export function publicTemplate(row: TemplateRow): QaqcPdfTemplate {
  const { format: _format, storagePath: _path, fileSize: _size, previewedAt: _preview, ...metadata } = templateMetadata(row);
  return { id: row.id, name: row.name, ...metadata };
}

export function safeTemplateMetadata(template: Record<string, unknown>) {
  const { storagePath: _private, previewedAt: _preview, ...metadata } = template;
  return metadata;
}

export const tenantTemplates = (organizationId: string) =>
  and(eq(reportTemplates.organizationId, organizationId), isNull(reportTemplates.deletedAt));

export async function findPdfTemplate(organizationId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(422, "Invalid PDF template identifier");
  }
  const [row] = await db.select().from(reportTemplates)
    .where(and(tenantTemplates(organizationId), eq(reportTemplates.id, id))).limit(1);
  if (!row || !isPdfTemplate(row)) throw new HttpError(404, "PDF template was not found");
  return row;
}

export async function listPdfTemplateRows(organizationId: string) {
  return (await db.select().from(reportTemplates).where(tenantTemplates(organizationId))
    .orderBy(asc(reportTemplates.name), asc(reportTemplates.createdAt))).filter(isPdfTemplate);
}

// All template mutations take the same tenant advisory lock, including default switches.
export async function changePdfTemplates<T>(organizationId: string, action: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`qaqc-pdf-templates:${organizationId}`}))`);
    return action(tx as unknown as typeof db);
  });
}

export async function readTemplatePdf(organizationId: string, row: TemplateRow) {
  const metadata = templateMetadata(row);
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  const prefix = root && `${root}/qaqc-pdf-templates/${organizationId}/`;
  if (!prefix || !metadata.storagePath.startsWith(prefix)
    || metadata.storagePath.includes("..") || !metadata.storagePath.endsWith(`/${row.id}.pdf`)) {
    throw new HttpError(422, "Invalid tenant PDF template storage reference");
  }
  const response = await getObject(metadata.storagePath);
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_TEMPLATE_BYTES) {
    await response.body?.cancel();
    throw new HttpError(422, "PDF template must be under 10 MB");
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TEMPLATE_BYTES) {
        await reader.cancel();
        throw new HttpError(422, "PDF template must be under 10 MB");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== metadata.fileSize) throw new HttpError(422, "Uploaded PDF size differs from the selected file; upload it again");
  return bytes;
}

export async function validatedTemplatePdf(organizationId: string, row: TemplateRow) {
  const bytes = await readTemplatePdf(organizationId, row);
  try { await inspectPdf(bytes); } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "Invalid PDF template");
  }
  return bytes;
}

export async function applyPdfTemplate(input: {
  organizationId: string; kind: "report" | "dashboard"; reportType?: string;
  templateId?: string; values: Record<string, unknown>; completePdf: Buffer;
}) {
  if (input.templateId === "builtin") return input.completePdf;
  let row: TemplateRow | undefined;
  if (input.templateId) row = await findPdfTemplate(input.organizationId, input.templateId);
  else if (input.reportType) {
    row = (await listPdfTemplateRows(input.organizationId)).find((candidate) => {
      const meta = templateMetadata(candidate);
      return meta.state === "published" && meta.isDefault && meta.kind === input.kind && meta.reportType === input.reportType;
    });
  }
  if (!row) return input.completePdf;
  const meta = templateMetadata(row);
  if (meta.state !== "published" || !meta.uploaded || meta.kind !== input.kind
    || (input.kind === "report" && meta.reportType !== input.reportType)) {
    throw new HttpError(422, "Select a published PDF template of the correct report type");
  }
  try {
    const bytes = await validatedTemplatePdf(input.organizationId, row);
    const designed = await renderPdfLayout(bytes, meta.mappings as PdfMapping[], input.values);
    // A mapping may deliberately cover only selected fields. Always retain the complete
    // existing report/dashboard as an appendix, including history and frozen baselines.
    const output = await PDFDocument.load(designed);
    const appendix = await PDFDocument.load(input.completePdf);
    for (const page of await output.copyPages(appendix, appendix.getPageIndices())) output.addPage(page);
    return Buffer.from(await output.save());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, error instanceof Error ? error.message : "PDF template could not render");
  }
}