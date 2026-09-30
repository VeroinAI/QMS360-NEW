import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { renderAuditScheduleApprovalPdf } from "./audit-schedule-approval-pdf";

function decodedPageText(pdf: Buffer) {
  const source = pdf.toString("latin1");
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match => {
      try { return inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1"); } catch { return ""; }
    })
    .join("\n");
  return streams.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

describe("renderAuditScheduleApprovalPdf", () => {
  it("renders memo, subject, and the ISO-week programme on one page for a short approval", async () => {
    const pdf = await renderAuditScheduleApprovalPdf({
      title: "Annual Audit Programme",
      subject: "Approval requested",
      memo: "Please review the proposed schedule.",
      rows: [{
        title: "Supplier audit",
        auditType: "Quality Internal Process Audit",
        fromDate: "2026-02-02",
        toDate: "2026-02-13",
        departmentProject: "Operations",
        ownerName: "A. Reviewer",
        auditNumber: "AUD-026",
        qaqcReference: "QA-04",
        scope: "Supplier quality controls",
        clauses: "8.4, 9.2",
        remarks: "Coordinate site access",
      }],
    });
    const parsed = await PDFDocument.load(pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Annual Audit Programme");
    expect(parsed.getSubject()).toBe("Approval requested");
    expect(parsed.getPages()[0]!.getSize()).toEqual({ width: 1684, height: 1191 });
    expect(decodedPageText(pdf)).toContain("Supplier audit");
  });

  it("flows the entire submitted memo across pages before rendering the schedule", async () => {
    const longMemo = Array.from({ length: 1800 }, (_, index) =>
      `Memo paragraph ${index + 1}: Review the audit scope, timing, and assigned owner.`,
    ).join("\n");
    const pdf = await renderAuditScheduleApprovalPdf({
      title: "Programme",
      subject: "Final approval",
      memo: longMemo,
      rows: [{
        title: "Long-running audit",
        fromDate: "2025-12-29",
        toDate: "2026-01-09",
        remarks: "Crosses the ISO year boundary",
      }],
    });
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(2);
    const text = decodedPageText(pdf);
    expect(text).toContain("Memo paragraph 1:");
    expect(text).toContain("Memo paragraph 1800:");
    expect(text).toContain("Audit Schedule Programme - 2025");
  });

  it("supports empty schedules and malformed dates without failing", async () => {
    const emptyPdf = await renderAuditScheduleApprovalPdf({
      title: "Empty programme",
      subject: "",
      memo: "",
      rows: [],
    });
    const emptyParsed = await PDFDocument.load(emptyPdf);
    expect(emptyParsed.getPageCount()).toBe(1);
    expect(decodedPageText(emptyPdf)).toContain("No audit schedule rows");

    const malformedPdf = await renderAuditScheduleApprovalPdf({
      title: "Invalid schedule dates",
      subject: "",
      memo: "",
      rows: [{
        title: "Unscheduled",
        fromDate: "2026-02-30",
        toDate: "not-a-date",
      }],
    });
    const parsed = await PDFDocument.load(malformedPdf);
    expect(parsed.getPageCount()).toBe(1);
    expect(decodedPageText(malformedPdf)).toContain("Unscheduled");
  });
});