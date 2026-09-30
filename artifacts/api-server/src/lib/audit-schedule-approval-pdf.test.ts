import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { renderAuditScheduleApprovalPdf } from "./audit-schedule-approval-pdf";

function decodedStreams(pdf: Buffer) {
  const source = pdf.toString("latin1");
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match => {
      try { return inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1"); } catch { return ""; }
    }).map(stream => stream.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) =>
      Buffer.from(hex, "hex").toString("latin1")));
}
const decodedPageText = (pdf: Buffer) => decodedStreams(pdf).join("\n");

describe("renderAuditScheduleApprovalPdf", () => {
  it("places the memo on page one and the approved chart with signatories on page two", async () => {
    const pdf = await renderAuditScheduleApprovalPdf({
      title: "Annual Audit Programme",
      reference: "QMS/2026/042",
      from: "Audit Programme Manager",
      to: "Approvals Committee",
      subject: "Approval requested",
      memo: "Please review the proposed schedule.\n\nRegards,\nThe Audit Team",
      signatories: {
        preparedBy: { name: "P. Creator", role: "Audit Program Manager" },
        reviewedBy: [{ name: "A. Reviewer", role: "QA Manager" }],
        approvedBy: { name: "F. Approver", role: "CEO" },
      },
      rows: [{
        title: "Supplier audit",
        auditCategory: "Supplier audit",
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
    expect(parsed.getPageCount()).toBe(2);
    expect(parsed.getTitle()).toBe("Annual Audit Programme");
    expect(parsed.getSubject()).toBe("Approval requested");
    expect(parsed.getPages()[0]!.getSize()).toEqual({ width: 1684, height: 1191 });
    expect(decodedPageText(pdf)).toContain("Supplier audit");
    expect(decodedPageText(pdf)).toContain("Prepared By");
    expect(decodedPageText(pdf)).toContain("Reviewed By");
    expect(decodedPageText(pdf)).toContain("Approved By");
    expect(decodedPageText(pdf)).toContain("F. Approver");
    const memoStream = decodedStreams(pdf).find(stream => stream.includes("Submitted Memo"));
    const chartStream = decodedStreams(pdf).find(stream => stream.includes("Business Category"));
    expect(memoStream).toContain("Reference");
    expect(memoStream).toContain("QMS/2026/042");
    expect(memoStream).toContain("From");
    expect(memoStream).toContain("Audit Programme Manager");
    expect(memoStream).toContain("To");
    expect(memoStream).toContain("Approvals Committee");
    expect(memoStream).toContain("Subject");
    expect(memoStream!.indexOf("Reference")).toBeLessThan(memoStream!.indexOf("From"));
    expect(memoStream!.indexOf("From")).toBeLessThan(memoStream!.indexOf("To"));
    expect(memoStream!.indexOf("To")).toBeLessThan(memoStream!.indexOf("Subject"));
    expect(memoStream!.indexOf("Subject")).toBeLessThan(memoStream!.indexOf("Submitted Memo"));
    expect(memoStream).toContain("Please review the proposed schedule.");
    expect(memoStream).toContain("Regards,");
    expect(memoStream).toContain("The Audit Team");
    expect(memoStream).not.toContain("Business Category");
    expect(chartStream).toContain("F. Approver");
    expect(chartStream).not.toContain("Submitted Memo");
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
    expect(text).toContain("Long-running audit");
  });

  it("supports empty schedules and malformed dates without failing", async () => {
    const emptyPdf = await renderAuditScheduleApprovalPdf({
      title: "Empty programme",
      subject: "",
      memo: "",
      rows: [],
    });
    const emptyParsed = await PDFDocument.load(emptyPdf);
    expect(emptyParsed.getPageCount()).toBe(2);
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
    expect(parsed.getPageCount()).toBe(2);
    expect(decodedPageText(malformedPdf)).toContain("Unscheduled");
  });
});