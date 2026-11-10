import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { auditPptxSignoff, applyAuditPptxSignoff } from "../src/lib/audit-pptx-signoff";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import type { AuditReportApprovalState } from "../src/lib/audit-report-approval";
import { documentControlPages } from "../src/lib/audit-pptx-document-control-layout";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
const text = (node: Document | Element) => Array.from(node.getElementsByTagNameNS(A, "t")).map(t => t.textContent).join("\n");
const approval = (): AuditReportApprovalState => ({
  status: "Approved", submittedById: "creator", submittedAt: "2026-11-01T08:00:00Z", index: 1,
  steps: [{ level: 1, roleIds: ["review"], approvers: [{ id: "reviewer", name: "Eligible, not necessarily actual reviewer" }] },
    { level: 2, roleIds: ["final"], approvers: [{ id: "approver", name: "Eligible final" }] }],
  history: [
    { decision: "approve", userId: "old", userName: "Old-cycle reviewer", level: 1, remarks: "", at: "2026-10-01T08:00:00Z" },
    { decision: "send_back", userId: "approver", userName: "Final Approver", level: 2, remarks: "Revise", at: "2026-10-02T08:00:00Z" },
    { decision: "approve", userId: "reviewer", userName: "Recorded Reviewer", level: 1, remarks: "", at: "2026-11-02T09:00:00Z" },
    { decision: "approve", userId: "approver", userName: "Recorded Final Approver", level: 2, remarks: "", at: "2026-11-03T10:00:00Z" },
  ],
});
const names = new Map([["lead", "Recorded Team Lead"], ["reviewer", "Renamed account"], ["creator", "Creator is not the team lead"]]);
const sections = () => buildConsolidatedAuditReport({
  audit: { title: "Conclusion sign-off verification", checklist: [], reportDetails: {
    values: { headlineConclusion: "Recorded audit conclusion", reportIssueDate: "2099-01-01" },
    rows: { signOff: [{ role: "Approved by", name: "Manually entered, not actual approval" }] },
  } }, legacyFindings: [], cars: [], evidence: [], names, roleNames: new Map(), pptxWorkbookMappings: true,
});
describe("Audit PowerPoint conclusion sign-off", () => {
  it("maps document control to the same actual signers and retains chronological approval history across cycles", () => {
    const data = sections(), state = approval();
    applyAuditPptxSignoff(data, auditPptxSignoff({ leadId: "lead",
      completedAt: "2026-11-01T08:00:00Z", approval: state }, names));
    const control = data.find(section => section.key === "document-control")!;
    expect(control.tables[0]!.rows).toEqual(data.find(section => section.key === "conclusion")!.tables[0]!.rows);
    expect(control.tables[0]!.rows.map(row => row[1])).toEqual(["Recorded Team Lead", "Recorded Reviewer", "Recorded Final Approver"]);
    expect(control.tables[1]!.title).toBe("Approval History");
    expect(control.tables[1]!.columns).toEqual(["Date", "Approval details", "By"]);
    expect(control.tables[1]!.rows.map(row => row[1])).toEqual(["L1 — Approved", "L2 — Sent back\nRevise", "L1 — Approved", "L2 — Approved"]);
    expect(control.tables[1]!.rows.map(row => row[2])).toEqual(["Old-cycle reviewer", "Final Approver", "Recorded Reviewer", "Recorded Final Approver"]);
  });

  it("renders document-control signatures, removes the Revision column and continues long approval history without losing decisions", async () => {
    const data = sections(), state = approval();
    state.history.push(...Array.from({ length: 12 }, (_, i) => ({
      decision: "approve", userId: `history-${i}`, userName: `Historical reviewer ${i}`, level: 1,
      remarks: `Recorded decision details ${i}. ` + "Checked the actual audit evidence. ".repeat(12),
      at: `2026-10-${String(i + 3).padStart(2, "0")}T08:00:00Z`,
    })));
    applyAuditPptxSignoff(data, auditPptxSignoff({ leadId: "lead",
      completedAt: "2026-11-01T08:00:00Z", approval: state }, names));
    const control = data.find(section => section.key === "document-control")!;
    const planned = documentControlPages(control);
    for (const page of planned) {
      expect(page.approvals.reduce((sum, row) => sum + row.height, 365760)).toBeLessThanOrEqual(2350000);
      expect(page.history.reduce((sum, row) => sum + row.height, 365760)).toBeLessThanOrEqual(1737360);
    }
    const roundTrip: string[][] = [];
    for (const row of planned.flatMap(page => page.history)) {
      if (!row.continued) roundTrip.push(["", "", ""]);
      row.cells.forEach((cell, col) => { roundTrip.at(-1)![col] += cell; });
    }
    const normalize = (value: string) => value.replace(/\s+/g, "");
    expect(roundTrip.map(row => row.map(normalize))).toEqual(control.tables[1]!.rows.map(row => row.map(normalize)));
    const image = await sharp(Buffer.from('<svg width="260" height="65"><path d="M10 50 Q50 5 80 40 T240 42" fill="none" stroke="black"/></svg>')).png().toBuffer();
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data,
      signoffSignatures: new Map(["Prepared by", "Reviewed by", "Approved by"].map(role => [role, [image]])) }));
    const slides = Object.entries(files).filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .map(([, bytes]) => parse(bytes)).filter(doc => text(doc).includes("Document control and approval"));
    expect(slides.length).toBeGreaterThan(1);
    const all = slides.map(text).join(" ");
    for (let i = 0; i < 12; i++) expect(all).toContain(`Recorded decision details ${i}.`);
    expect(all).toContain("Approval History");
    expect(all).not.toContain("Revision history");
    for (const doc of slides) {
      const tables = Array.from(doc.getElementsByTagNameNS(A, "tbl"));
      expect(Array.from(tables[1]!.getElementsByTagNameNS(A, "tr")[0]!.getElementsByTagNameNS(A, "tc")).map(text))
        .toEqual(["Date", "Approval details", "By"]);
      // The left Document information's Form Revision is intentionally retained.
      expect(doc.getElementsByTagNameNS(P, "pic").length).toBe(3);
      const ids = Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).map(node => node.getAttribute("id"));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("uses the selected Team Lead and actual decisions in the current cycle only", () => {
    const result = auditPptxSignoff({ leadId: "lead", completedAt: "2026-11-01T08:00:00Z", approval: approval() }, names);
    expect(result.prepared.name).toBe("Recorded Team Lead");
    expect(result.reviewed.map(row => row.name)).toEqual(["Recorded Reviewer"]);
    expect(result.approved?.name).toBe("Recorded Final Approver");
    expect(result.approved?.at).toBe("2026-11-03T10:00:00Z");
  });
  it("never labels a pending final decision as approved or invents missing signers/dates", () => {
    const state = approval(); state.status = "Pending approval"; state.history.pop();
    const result = auditPptxSignoff({ approval: state }, names);
    expect(result.approved).toBeUndefined();
    expect(result.prepared).toEqual({ userId: undefined, name: "-", at: undefined });
    const data = sections();
    applyAuditPptxSignoff(data, result);
    const conclusion = data.find(section => section.key === "conclusion")!;
    expect(conclusion.fields.find(field => field.label === "Report issue date")?.value).toBe("-");
    expect(conclusion.tables[0].rows[2]).toEqual(["Approved by", "-", "-", "-"]);
    expect(JSON.stringify(conclusion)).not.toContain("Manually entered");
  });
  it("handles a single final level without inventing a reviewer, and clears returned-cycle decisions", () => {
    const state = approval(); state.steps = state.steps.slice(1); state.history = state.history.slice(-1);
    expect(auditPptxSignoff({ approval: state }, names).reviewed).toEqual([]);
    state.status = "Sent back"; state.history.push({ ...state.history[0], decision: "send_back", at: "2026-11-04" });
    state.submittedAt = "";
    const result = auditPptxSignoff({ approval: state }, names);
    expect(result.reviewed).toEqual([]);
    expect(result.approved).toBeUndefined();
  });
  it("renders three actual signature images above visible lines, removes obsolete blocks, and retains valid package relationships", async () => {
    const data = sections();
    applyAuditPptxSignoff(data, auditPptxSignoff({
      leadId: "lead", completedAt: "2026-11-01T08:00:00Z", approval: approval(),
    }, names));
    const image = await sharp(Buffer.from('<svg width="260" height="65"><path d="M10 50 Q50 5 80 40 T150 30 T240 42" fill="none" stroke="#182544" stroke-width="3"/></svg>')).png().toBuffer();
    const bytes = await renderConsolidatedAuditPptx({ sections: data,
      signoffSignatures: new Map(["Prepared by", "Reviewed by", "Approved by"].map(role => [role, [image]])) });
    const files = unzipSync(bytes), doc = parse(files["ppt/slides/slide17.xml"]);
    const control = parse(files["ppt/slides/slide2.xml"]);
    for (const name of ["Recorded Team Lead", "Recorded Reviewer", "Recorded Final Approver"]) expect(text(control)).toContain(name);
    expect(control.getElementsByTagNameNS(P, "pic").length).toBe(3);
    const content = text(doc);
    for (const name of ["Recorded Team Lead", "Recorded Reviewer", "Recorded Final Approver"]) expect(content).toContain(name);
    expect(content).not.toMatch(/Acknowledged by|Distribution:|Lead auditor:|Old-cycle|2099|Manually entered/);
    expect(Array.from(doc.getElementsByTagNameNS(P, "pic"))).toHaveLength(3);
    const rels = parse(files["ppt/slides/_rels/slide17.xml.rels"]);
    const links = Array.from(rels.getElementsByTagNameNS(REL, "Relationship"));
    const ids = links.map(row => row.getAttribute("Id"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const link of links.filter(row => row.getAttribute("Id")?.startsWith("auditReportSignature")))
      expect(files[`ppt/${link.getAttribute("Target")!.replace("../", "")}`]).toBeDefined();
    for (const node of Array.from(doc.getElementsByTagNameNS(A, "p"))) {
      const order = Array.from(node.childNodes).filter(child => child.nodeType === 1).map(child => child.localName);
      if (order.includes("endParaRPr")) expect(order.at(-1)).toBe("endParaRPr");
    }
    await mkdir("../../generated-artifacts", { recursive: true });
    await writeFile("../../generated-artifacts/audit-conclusion-signoff-preview.pptx", bytes);
  });
  it("keeps explicit dashes in signature and date boxes when nothing is recorded", async () => {
    const data = sections();
    applyAuditPptxSignoff(data, auditPptxSignoff({}, names));
    const files = unzipSync(await renderConsolidatedAuditPptx({ sections: data }));
    const doc = parse(files["ppt/slides/slide17.xml"]);
    const control = parse(files["ppt/slides/slide2.xml"]);
    expect(text(control)).toContain("No approval decisions recorded.");
    expect(control.getElementsByTagNameNS(P, "pic").length).toBe(0);
    expect(Array.from(doc.getElementsByTagNameNS(P, "pic"))).toHaveLength(0);
    expect(text(doc)).toContain("Report issue date: -");
    const boxes = Array.from(doc.getElementsByTagNameNS(P, "sp"))
      .filter(node => node.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name") === "Audit report sign-off");
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      expect(text(box)).toBe("-");
      expect(Number(box.getElementsByTagNameNS(A, "ext")[0].getAttribute("cy"))).toBeGreaterThan(0);
    }
  });
});
