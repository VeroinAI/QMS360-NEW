import { describe, expect, it } from "vitest";
import type { AuditSchedule } from "@workspace/api-client-react";
import { buildProgrammePdf } from "./index";
import type { ProgrammeSignatories } from "./index";

const winAnsi: Record<number, string> = {
  133: "…", 145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—",
};
const decodePdfString = (value: string) => value
  .replace(/\\([0-7]{3})/g, (_, octal: string) => {
    const code = Number.parseInt(octal, 8);
    return winAnsi[code] ?? String.fromCharCode(code);
  })
  .replace(/\\([\\()])/g, "$1");

const extractText = (pdf: Uint8Array) => {
  const source = new TextDecoder("latin1").decode(pdf);
  return [...source.matchAll(/\(((?:\\(?:[0-7]{3}|.)|[^\\)])*)\)\s*Tj/g)]
    .map(match => decodePdfString(match[1]))
    .join(" ");
};

const schedule = (index: number): AuditSchedule => ({
  id: `schedule-${index}`,
  year: 2026,
  auditCategory: "Quality Assurance and Quality Control",
  departmentProject: `Project ${index}`,
  processProductOwner: "Quality & Compliance",
  auditNumber: `AUD-2026-${String(index).padStart(3, "0")}`,
  qaqcReference: "QMS–REF/“2026”",
  qaqcScope: "Full quality assurance and quality control scope covering procurement, inspection, testing, handover, records, and final acceptance without abbreviation",
  qaqcClauses: "ISO 9001:2015 clauses 4.1 through 10.3 — including context, leadership, planning, support, operation, performance evaluation, and improvement",
  remarks: "Owner’s review • verify “as-built” records, supplier certificates, test packs, NCR close-out, and handover evidence — no omissions.",
  plannedStartDate: "2026-01-01",
  plannedEndDate: "2026-12-31",
} as AuditSchedule);

describe("Audit Programme PDF", () => {
  it("preserves wrapped text, WinAnsi punctuation, ISO weeks, and valid paginated page bounds", () => {
    const rows = Array.from({ length: 40 }, (_, index) => schedule(index + 1));
    const pdf = buildProgrammePdf(rows, "2026 Audit Programme");
    const source = new TextDecoder("latin1").decode(pdf);
    const text = extractText(pdf);

    expect(source.startsWith("%PDF-1.4")).toBe(true);
    expect(source.endsWith("%%EOF")).toBe(true);
    expect(source.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(source).toContain("/MediaBox [0 0 1684 1191]");

    for (const value of [
      rows[0].qaqcScope,
      rows[0].qaqcClauses,
      rows[0].remarks,
    ]) {
      const words = String(value).split(/\s+/);
      for (const word of words) expect(text).toContain(word);
    }
    expect(text).toContain("QMS–REF/“2026”");
    expect(text).toContain("Owner’s");
    expect(text).toContain("•");
    expect(text).not.toContain("...");
    expect(text).not.toContain("…");

    for (let week = 1; week <= 53; week += 1) expect(text).toContain(`W${week}`);
    expect(text).not.toMatch(/\bW(?:5[4-9]|[6-9]\d|\d{3,})\b/);

    const rowBottoms = [...source.matchAll(/0\.45 G 0\.35 w [\d.]+ (-?[\d.]+) [\d.]+ [\d.]+ re S/g)]
      .map(match => Number(match[1]));
    expect(rowBottoms.length).toBeGreaterThan(0);
    expect(Math.min(...rowBottoms)).toBeGreaterThanOrEqual(18);
  });

  it("adds a non-overlapping signoff footer after multipage schedules and embeds real signatures", () => {
    const rows = Array.from({ length: 40 }, (_, index) => schedule(index + 1));
    const signatories: ProgrammeSignatories = {
      preparedBy: {
        userId: "u1", name: "Alex Prepared", designation: "Audit Manager", role: "Prepared By",
        signatureDataUrl: "data:image/jpeg;base64,AQIDBA==",
      },
      reviewedBy: [{
        userId: "u2", name: "Robin Reviewer", designation: "Quality Lead", role: "Reviewer",
        signatureDataUrl: "data:image/jpeg;base64,BQYHCA==",
      }],
      approvedBy: {
        userId: "u3", name: "Taylor Approver", designation: "Director", role: "Approver",
        signatureDataUrl: "data:image/jpeg;base64,CQoLDA==",
      },
    };
    const pdf = buildProgrammePdf(rows, "2026 Audit Programme", signatories);
    const source = new TextDecoder("latin1").decode(pdf);
    const text = extractText(pdf);

    expect(source.startsWith("%PDF-1.4")).toBe(true);
    expect(source.endsWith("%%EOF")).toBe(true);
    expect(source.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(text).toContain("Prepared By");
    expect(text).toContain("Reviewed By");
    expect(text).toContain("Approved By");
    expect(text).toContain("Alex Prepared");
    expect(text).toContain("Audit Manager");
    expect(text).toContain("Robin Reviewer");
    expect(text).toContain("Quality Lead");
    expect(text).toContain("Taylor Approver");
    expect(text).toContain("Director");
    expect(source.match(/\/Subtype \/Image/g)?.length).toBe(4);
    expect(source.match(/\/Sig\d+ Do/g)?.length).toBe(3);

    const pageStreams = [...source.matchAll(/stream\n([\s\S]*?)endstream/g)].map(match => match[1]);
    const footerPage = pageStreams.find(stream => stream.includes("Prepared By"));
    expect(footerPage).toBeDefined();
    const footerRectangles = [...footerPage!.matchAll(/0\.45 G 0\.35 w ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S/g)]
      .map(match => ({ y: Number(match[2]), height: Number(match[4]) }));
    expect(footerRectangles.some(rectangle => rectangle.y === 18 && rectangle.height === 112)).toBe(true);
    expect(Math.min(...footerRectangles.filter(rectangle => rectangle.height !== 112).map(rectangle => rectangle.y))).toBeGreaterThanOrEqual(130);
    expect(source).toContain("/MediaBox [0 0 1684 1191]");
  });

  it("shows pending signoff fields without inventing signature images", () => {
    const pdf = buildProgrammePdf([], "Pending Audit Programme", {
      preparedBy: null,
      reviewedBy: [],
      approvedBy: null,
    });
    const source = new TextDecoder("latin1").decode(pdf);
    const text = extractText(pdf);

    expect(text).toContain("Prepared By");
    expect(text).toContain("Reviewed By");
    expect(text).toContain("Approved By");
    expect(source.match(/\/Subtype \/Image/g)?.length).toBe(1);
    expect(source).not.toContain("/Sig0 Do");
  });
});