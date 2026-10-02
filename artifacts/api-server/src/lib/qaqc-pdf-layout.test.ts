import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import {
  inspectPdf,
  renderPdfLayout,
  sampleTemplateValues,
  templateSourceCatalog,
  validatePdfMappings,
  type PdfMapping,
} from "./qaqc-pdf-layout";
import { validateReportData } from "./qaqc-reporting-model";

async function fixture(options: { unsupported?: boolean; readOnly?: boolean; pages?: number; rotated?: boolean; maxLength?: boolean } = {}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < (options.pages ?? 2); i++) {
    const page = pdf.addPage([300, 400]);
    page.drawText(`Uploaded background page ${i + 1}`, { x: 12, y: 380, size: 10, font: await pdf.embedFont(StandardFonts.Helvetica) });
  }
  if (options.rotated) pdf.getPages()[0]!.setRotation(degrees(90));
  const form = pdf.getForm();
  const title = form.createTextField("identity.title");
  title.addToPage(pdf.getPages()[0]!);
  if (options.maxLength) title.setMaxLength(5);
  title.setText(options.maxLength ? "Old" : "Old content");
  if (options.readOnly) title.enableReadOnly();
  const project = form.createTextField("identity.project");
  project.addToPage(pdf.getPages()[0]!);
  project.setText("Old project");
  const checkbox = form.createCheckBox("flags.approved");
  checkbox.addToPage(pdf.getPages()[0]!);
  checkbox.check();
  const dropdown = form.createDropdown("selection.status");
  dropdown.addOptions(["Approved", "Draft"]);
  dropdown.addToPage(pdf.getPages()[0]!);
  if (options.unsupported) {
    const list = form.createOptionList("unsupported.list");
    list.addOptions(["A", "B"]);
    list.select("A");
    list.addToPage(pdf.getPages()[0]!);
  }
  return Buffer.from(await pdf.save());
}

describe("QA/QC PDF layout", () => {
  it("identifies fillable fields even when the server bundle renames constructors", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const field = document.getForm().createTextField("projectName");
    field.addToPage(page, { x: 20, y: 20, width: 250, height: 30 });
    const constructor = field.constructor;
    const descriptor = Object.getOwnPropertyDescriptor(constructor, "name")!;
    Object.defineProperty(constructor, "name", { ...descriptor, value: "PDFTextField2" });
    try {
      const bytes = Buffer.from(await document.save());
      const inspection = await inspectPdf(bytes);
      expect(inspection.fields).toEqual([{ name: "projectName", type: "PDFTextField" }]);
      const rendered = await renderPdfLayout(bytes, [{ source: "projectName", pdfField: "projectName" }], { projectName: "Bundled server" });
      expect((await PDFDocument.load(rendered)).getForm().getFields()).toHaveLength(0);
    } finally {
      Object.defineProperty(constructor, "name", descriptor);
    }
  });
  it("inspects pages and supported fields, and retains the uploaded background pages", async () => {
    const source = await fixture();
    const inspection = await inspectPdf(source);
    expect(inspection.pages).toEqual([{ width: 300, height: 400 }, { width: 300, height: 400 }]);
    expect(inspection.fields.map((field) => field.name)).toContain("identity.title");

    const rendered = await renderPdfLayout(source, [
      { source: "projectName", pdfField: "identity.title" },
      { source: "data.narrative", page: 1, x: 20, y: 60, width: 150, height: 45, fontSize: 10 },
    ], { projectName: "Monthly QA/QC", data: { narrative: "Line one\nLine two" } });
    const output = await PDFDocument.load(rendered);
    expect(output.getPageCount()).toBe(2);
    expect(output.getForm().getFields()).toHaveLength(0);
    expect((await PDFDocument.load(source)).getForm().getFields()).toHaveLength(4);
  });

  it.each(["monthly", "daily", "csat"] as const)("maps a valid %s report sample without mutating source values", async (reportType) => {
    const values = sampleTemplateValues(reportType, "report");
    const reportData = values.data as Record<string, unknown>;
    const baseline = values.baseline as Record<string, unknown>;
    expect(validateReportData(reportType, reportData, baseline, true)).toMatchObject({ valid: true });
    expect(values).toMatchObject({
      createdById: expect.any(String), submittedById: expect.any(String), approverId: expect.any(String),
      submittedAt: expect.any(String), approvedAt: expect.any(String), reviewComments: expect.any(String),
      referenceNumber: expect.any(String), history: expect.any(Array), reportTemplates: expect.any(Array),
    });
    if (reportType === "monthly") {
      expect(reportData).toMatchObject({ pqpOther: null, pqpSubmittedDate: expect.any(String), reportReference: expect.any(String) });
      expect((reportData.documents as any).drawings.remarks).toEqual(expect.any(String));
      expect((baseline.metrics as any).external_ncr).toMatchObject({ accumulatedIssued: expect.any(Number), accumulatedClosed: expect.any(Number) });
    } else if (reportType === "csat") {
      expect(reportData).toMatchObject({
        satisfactoryAspects: expect.any(String), improvementSuggestions: expect.any(String), comments: expect.any(String),
      });
    } else {
      expect(reportData).toMatchObject({ documentTypes: expect.any(Object), revisions: { drawings: expect.any(Array), submittals: expect.any(Array) } });
      expect(baseline.previousPeriod).toBe("2025-01-30");
    }
    const originalData = JSON.stringify(values.data);
    const source = await fixture();
    const output = await renderPdfLayout(source, [
      { source: "reportType", pdfField: "identity.title" },
      { source: "projectName", pdfField: "identity.project" },
      { source: "period", page: 1, x: 20, y: 100, width: 100, height: 20 },
      { source: "data", page: 2, x: 20, y: 100, width: 250, height: 220, fontSize: 5 },
    ], values);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
    expect(JSON.stringify(values.data)).toBe(originalData);
    expect(values.reportType).toBe(reportType);
    expect(templateSourceCatalog(reportType, "report").map((entry) => entry.path)).toContain("computed");
  });

  it("provides dashboard sample paths with zero-based array indexing", () => {
    for (const reportType of ["monthly", "daily", "csat"] as const) {
      const values = sampleTemplateValues(reportType, "dashboard");
      const data = values.dashboardData as Record<string, any>;
      expect(values).toHaveProperty("filters");
      expect(values).toHaveProperty("summary");
      expect(values).toHaveProperty("rows");
      expect(values).toHaveProperty("dashboardData");
      expect(values).toHaveProperty("trends");
      expect(values).toHaveProperty("reports");
      expect(data).toEqual(expect.objectContaining({ filters: expect.any(Object), monthly: expect.any(Array), aggregates: expect.any(Array), csat: expect.any(Array), csatAverage: expect.any(Number), daily: expect.any(Array) }));
      expect((values.reports as any[])[0]).toMatchObject({ data: expect.any(Object), computed: expect.any(Object), baseline: expect.any(Object), history: expect.any(Array), reportTemplates: expect.any(Array) });
      const catalogPaths = templateSourceCatalog(reportType, "dashboard").map((entry) => entry.path);
      const representativePath = reportType === "monthly" ? "dashboardData.monthly.0.data.metrics"
        : reportType === "daily" ? "dashboardData.daily.0.snapshot.disciplineTotals"
          : "dashboardData.csat.0.data.ratings.quality";
      expect(catalogPaths).toContain(representativePath);
      expect(catalogPaths).toContain("reports.0.reviewComments");
    }
  });

  it("recursively catalogs scalar paths and whole object/array groups", () => {
    const catalog = templateSourceCatalog("monthly", "report");
    const paths = new Set(catalog.map((entry) => entry.path));
    for (const path of [
      "data.pqpOther", "data.meetings.0.lastDate", "data.metrics.external_ncr.ageing.0.count",
      "data.documents.drawings.remarks", "data.qmsReports.0.documentName", "baseline.metrics.external_ncr.accumulatedIssued",
      "computed.metrics.external_ncr.accumulatedRate", "history.0.after.state", "reportTemplates.0.template.revision",
    ]) expect(paths.has(path)).toBe(true);
    for (const path of ["data", "data.metrics", "data.meetings", "baseline", "computed", "history.0.after"]) {
      expect(paths.has(path)).toBe(true);
      expect(catalog.find((entry) => entry.path === path)?.example.length).toBeGreaterThan(0);
    }
  });

  it("clears unmapped fillable values on a blank template and permits optional nulls", async () => {
    const source = await fixture({ unsupported: true });
    const blank = await renderPdfLayout(source, [], {});
    const document = await PDFDocument.load(blank);
    const fields = document.getForm().getFields() as any[];
    expect(fields.find((field) => field.getName() === "identity.title").getText() ?? "").toBe("");
    expect(fields.find((field) => field.getName() === "identity.project").getText() ?? "").toBe("");
    expect(fields.find((field) => field.getName() === "flags.approved").isChecked()).toBe(false);
    expect(document.getForm().getOptionList("unsupported.list").getSelected()).toEqual([]);

    const optional = await renderPdfLayout(source, [{ source: "optional", pdfField: "identity.title" }], { optional: null });
    expect((await PDFDocument.load(optional)).getForm().getFields()).toHaveLength(0);
  });

  it("validates missing sources, unsafe paths, unsupported/read-only fields, and bad coordinates", async () => {
    const source = await fixture({ unsupported: true });
    const inspection = await inspectPdf(source);
    expect(() => validatePdfMappings([{ source: "missing.value", pdfField: "identity.title" }], inspection)).not.toThrow();
    await expect(renderPdfLayout(source, [{ source: "missing.value", pdfField: "identity.title" }], {})).rejects.toThrow(/Missing data/);
    expect(() => validatePdfMappings([{ source: "constructor.prototype", pdfField: "identity.title" }], inspection)).toThrow(/Unsafe/);
    expect(() => validatePdfMappings([{ source: "x", pdfField: "unsupported.list" }], inspection)).toThrow(/Unsupported PDF field type/);
    expect(() => validatePdfMappings([{ source: "x", page: 1, x: 280, y: 10, width: 30, height: 20 }], inspection)).toThrow(/outside page/);
    expect(() => validatePdfMappings([{ source: "x", page: 3, x: 0, y: 0, width: 10, height: 10 }], inspection)).toThrow(/one-based page/);
    expect(() => validatePdfMappings([
      { source: "x", pdfField: "identity.title" }, { source: "y", pdfField: "identity.title" },
    ], inspection)).toThrow(/mapped more than once/);

    const readOnlyInspection = await inspectPdf(await fixture({ readOnly: true }));
    expect(() => validatePdfMappings([{ source: "x", pdfField: "identity.title" }], readOnlyInspection)).toThrow(/read-only/);
    const rotatedInspection = await inspectPdf(await fixture({ rotated: true }));
    expect(() => validatePdfMappings([{ source: "x", page: 1, x: 0, y: 0, width: 10, height: 10 }], rotatedInspection)).toThrow(/rotated page/);
  });

  it("wraps multiline strings in bounds and rejects overflowing text", async () => {
    const source = await fixture();
    const mapping: PdfMapping = { source: "message", page: 1, x: 10, y: 80, width: 90, height: 60, fontSize: 10 };
    await expect(renderPdfLayout(source, [mapping], { message: "A reasonably long sentence that wraps across several lines." })).resolves.toBeInstanceOf(Buffer);
    await expect(renderPdfLayout(source, [{ ...mapping, height: 12 }], { message: "First line\nSecond line\nThird line" })).rejects.toThrow(/overflows/);
  });

  it("autofits text fields where possible and explicitly rejects values beyond field length", async () => {
    const shortLimitPdf = await fixture({ maxLength: true });
    await expect(renderPdfLayout(shortLimitPdf, [{ source: "value", pdfField: "identity.title" }], { value: "Too long" })).rejects.toThrow(/at most 5 characters/);
  });

  it("rejects non-PDF and encrypted-looking input explicitly", async () => {
    await expect(inspectPdf(Buffer.from("not a pdf"))).rejects.toThrow(/%PDF-/);
    await expect(inspectPdf(Buffer.from("%PDF-1.7\nnot a complete document"))).rejects.toThrow(/Unable to read PDF/);
  });
});