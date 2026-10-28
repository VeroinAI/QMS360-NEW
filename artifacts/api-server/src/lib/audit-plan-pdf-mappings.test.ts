import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATE_FORMATS, getDateFormat, setDateFormatResolver } from "@workspace/spreadsheet-dates";
import { auditPlanReportData, mapped, NO_DATA, TO_BE_MAPPED, type AuditPlanReportData } from "./audit-plan-report-data";
import { renderAuditPlanPdf } from "./audit-plan-pdf";

const previous = getDateFormat();
beforeAll(() => setDateFormatResolver(() => "DD-MM-YYYY"));
afterAll(() => setDateFormatResolver(() => previous));
const remarks = {
  startDateTimeRemark: "Start note\nStart second line",
  endDateTimeRemark: "End note\nEnd second line",
  openingMeetingDateTimeRemark: "Opening note\nOpening second line",
  closingMeetingDateTimeRemark: "Closing note\nClosing second line",
};
const report = (meta: Record<string, unknown> = {}) =>
  auditPlanReportData({}, meta, {}, undefined, new Map(), new Map(), "UTC");
async function extractedReport(data: AuditPlanReportData, filename?: string) {
  const bytes = await renderAuditPlanPdf(data);
  const dir = await mkdtemp(join(tmpdir(), "audit-plan-"));
  try {
    const path = join(dir, "report.pdf");
    await writeFile(path, bytes);
    if (filename) await writeFile(`/tmp/${filename}.pdf`, bytes);
    return execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const extracted = (meta: Record<string, unknown>, filename?: string) => extractedReport(report(meta), filename);
const canonicalProject = {
  name: "Actual Project",
  customFields: {
    contractNumber: "Old contract", clientName: "Old client", mainContractor: "Old contractor",
    tccDate: "Old TCC", pacDate: "Old PAC", facDate: "Old FAC", contractSignedDate: "Old signed",
    consultantName: "Actual consultant", pmName: "Actual manager", contractValue: 0, ptsNo: 0,
    qmsAdditionalData: {
      contractProjectNumber: "Saved contract", client: "Saved client", contractor: "Saved contractor",
      contractSigned: "2026-01-01", tcc: "2027-03-04 tentative", pac: "After handover", fac: "Pending client agreement",
      name: "Contact, not manager", contractPeriod: "Not a value", email: "Not a consultant", phone: "Not PTS",
    },
  },
};
const projectReport = (project: unknown, zone = "UTC") =>
  auditPlanReportData({}, {}, {}, project as any, new Map(), new Map(), zone);

describe("Project Master Additional Data — 2 mapping", () => {
  it("prefers the exact saved keys without reusing unrelated contact or contract fields", () => {
    const before = structuredClone(canonicalProject);
    expect(projectReport(canonicalProject).project.map(([, value]) => value)).toEqual([
      "Actual Project", "Saved contract", "Saved client", "Actual consultant", "Saved contractor", "Actual manager",
      "2027-03-04 tentative", "After handover", "Pending client agreement", "0", "01-01-2026", "0",
    ]);
    expect(canonicalProject).toEqual(before);
    const nestedOnly = projectReport({ name: "Identity", code: "Not a contract",
      customFields: { costCentre: "Not PTS", qmsAdditionalData: canonicalProject.customFields.qmsAdditionalData } });
    for (const label of ["Consultant", "Project Manager", "Contract Value", "PTS #"]) {
      expect(nestedOnly.project).toContainEqual([label, "-"]);
    }
  });
  it.each([null, "", " \t\n", {}, [], false])("does not revive old aliases when canonical values are cleared or invalid (%s)", value => {
    const project = structuredClone(canonicalProject);
    project.customFields.qmsAdditionalData = Object.fromEntries(
      Object.keys(project.customFields.qmsAdditionalData).map(key => [key, value]),
    ) as any;
    const rows = Object.fromEntries(projectReport(project).project);
    for (const label of ["Contract #", "Client", "Main contractor", "TCC", "PAC", "FAC", "Contract Signed Date"]) {
      expect(rows[label]).toBe("-");
    }
    expect(rows["Contract Value"]).toBe("0");
  });
  it.each([undefined, null, "", 42, [], ["not metadata"]])("safely falls back for malformed or absent nested metadata (%s)", qmsAdditionalData => {
    const rows = Object.fromEntries(projectReport({ ...canonicalProject,
      customFields: { ...canonicalProject.customFields, qmsAdditionalData } }).project);
    expect(rows).toMatchObject({ "Contract #": "Old contract", Client: "Old client",
      "Main contractor": "Old contractor", "Contract Signed Date": "Old signed" });
  });
  it.each([null, "invalid", 42, []])("handles malformed customFields (%s)", customFields => {
    expect(projectReport({ name: "Identity", customFields }).project.slice(1).every(([, value]) => value === "-")).toBe(true);
  });
  it("falls back independently for missing keys, not for the whole nested object", () => {
    const rows = Object.fromEntries(projectReport({ ...canonicalProject, customFields: {
      ...canonicalProject.customFields, qmsAdditionalData: { client: "Only canonical client" },
    } }).project);
    expect(rows).toMatchObject({ Client: "Only canonical client", "Contract #": "Old contract", TCC: "Old TCC" });
  });
  it("formats the signed calendar day in every organization format without timezone shifts", () => {
    const project = { ...canonicalProject, customFields: { qmsAdditionalData: { contractSigned: "2026-01-23" } } };
    const expected = ["23/01/2026", "01/23/2026", "2026-01-23", "23-01-2026", "01-23-2026"];
    try {
      DATE_FORMATS.forEach((format, i) => {
        setDateFormatResolver(() => format);
        for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
          expect(projectReport(project, zone).project).toContainEqual(["Contract Signed Date", expected[i]]);
        }
      });
    } finally { setDateFormatResolver(() => "DD-MM-YYYY"); }
  });
  it.each(["2026-02-30", "not a date", 0])("does not roll over or fall back for invalid canonical dates (%s)", contractSigned => {
    const rows = projectReport({ ...canonicalProject, customFields: { ...canonicalProject.customFields,
      qmsAdditionalData: { contractSigned } } }).project;
    expect(rows).toContainEqual(["Contract Signed Date", "-"]);
  });
  it("retains long nested project values in labelled PDF continuations", async () => {
    const parts = Array.from({ length: 20 }, (_, i) => `CLIENT-${String(i).padStart(2, "0")}`);
    const phrases = parts.map(part => `${part} full legal name`);
    const client = `${phrases.join(" ")} CLIENT-FINAL`;
    const data = projectReport({ ...canonicalProject, customFields: { qmsAdditionalData: { client } } });
    const text = (await extractedReport(data)).replace(/\s+/g, " ");
    expect(text).toContain("Client (continuation)");
    for (const part of parts) expect(text).toContain(part);
    expect(text).toContain("CLIENT-FINAL");
  });
});

describe("Audit Plan mapped values versus missing mapping logic", () => {
  it.each([undefined, null, "", " \n\t", {}, [], NaN, Infinity])("prints a dash for absent/invalid mapped values (%s)", value => {
    expect(mapped(value)).toBe(NO_DATA);
  });
  it("preserves zero and user-authored mapping-like text without global replacement", () => {
    expect(mapped(0)).toBe("0");
    expect(mapped(" To Be Mapped ")).toBe("To Be Mapped");
    expect(mapped("To be mapped")).toBe("To be mapped");
    const data = auditPlanReportData({}, {}, {}, { customFields: {
      contractNumber: "-", contractNo: "Must not replace explicit dash",
    } }, new Map(), new Map(), "UTC");
    expect(data.project.find(([label]) => label === "Contract #")?.[1]).toBe("-");
  });
  it("maps all four remarks independently without mutating saved metadata", () => {
    const meta = Object.freeze({ ...remarks });
    expect(report(meta)).toMatchObject({
      startRemark: remarks.startDateTimeRemark, endRemark: remarks.endDateTimeRemark,
      openingRemark: remarks.openingMeetingDateTimeRemark, closingRemark: remarks.closingMeetingDateTimeRemark,
    });
    expect(meta).toEqual(remarks);
  });
  it.each([undefined, "", " \t\n"])("treats legacy, cleared and whitespace remarks as absent (%s)", value => {
    expect(report(Object.fromEntries(Object.keys(remarks).map(key => [key, value])))).toMatchObject({
      startRemark: "-", endRemark: "-", openingRemark: "-", closingRemark: "-",
    });
  });
  it("marks only revision as genuinely unmapped in a sparse report", () => {
    const data = report();
    expect(data.revision).toBe("To be mapped");
    expect(JSON.stringify(data).split(TO_BE_MAPPED)).toHaveLength(2);
    expect(data.project.every(([, value]) => value === "-")).toBe(true);
    expect(data).toMatchObject({ title: "-", reference: "-", lead: "-", team: "-", auditee: "-",
      programManager: "-", standards: "-", language: "-", sheqReference: "-", start: "-", end: "-", opening: "-", closing: "-" });
  });
  it("preserves explicit blanks rather than reviving legacy fallbacks and resolves missing references as dashes", () => {
    const data = auditPlanReportData({ scope: "Old scope", auditDate: "2026-01-01", teamMemberIds: ["missing"] },
      { qaqcScope: "", startDateTime: "", auditeeRoleIds: ["missing"], leadAuditorId: "missing" },
      { plannedStartDate: "2026-02-01" }, undefined, new Map(), new Map(), "UTC", "missing");
    expect(data).toMatchObject({ scope: "-", start: "-", lead: "-", team: "-", auditee: "-", programManager: "-" });
  });
  it("maps every project custom alias, including zero, without inferring a contract number from code", () => {
    const data = auditPlanReportData({}, {}, {}, { name: "Project", code: "NOT-CONTRACT", customFields: {
      "contract no": "C-1", clientName: "Client", consultantName: "Consultant", mainContractorName: "Contractor",
      pmName: "Manager", tccDate: "TCC", pacDate: "PAC", facDate: "FAC", contractValue: 0,
      contractSignedDate: "Saved date", ptsNo: "P-1",
    } }, new Map(), new Map(), "UTC");
    expect(data.project.map(([, value]) => value)).toEqual([
      "Project", "C-1", "Client", "Consultant", "Contractor", "Manager", "TCC", "PAC", "FAC", "0", "Saved date", "P-1",
    ]);
  });
});

describe("Extracted Audit Plan PDF output", () => {
  it("includes complete long signer names even though the signature blocks render after other continuations", async () => {
    const data = report();
    data.lead = `${"Long lead name ".repeat(70)}LEAD-NAME-END`;
    data.programManager = `${"Long manager name ".repeat(70)}MANAGER-NAME-END`;
    const text = (await extractedReport(data)).replace(/\s+/g, " ");
    expect(text).toContain("Prepared by (continuation)");
    expect(text).toContain("Audit Program Manager (continuation)");
    expect(text).toContain("LEAD-NAME-END");
    expect(text).toContain("MANAGER-NAME-END");
    expect(text).not.toContain("To be mapped");
  });
  it("prints a populated record's cover, dates, project details, activities and signer names", async () => {
    const data = auditPlanReportData({ teamMemberIds: ["team"], createdAt: "2026-01-01T00:00Z" },
      { ...remarks, leadAuditorId: "lead", auditeeRoleIds: ["role"], planNumber: "PLAN-2026-01", qaqcScope: "Saved scope",
        auditTypes: ["Internal"], auditLanguage: "English", qaqcReference: "SHEQ-01",
        startDateTime: "2026-01-02T08:00", endDateTime: "2026-01-03T17:00",
        openingMeetingDateTime: "2026-01-02T08:15+14:00", closingMeetingDateTime: "2026-01-03T16:45-12:00",
        activities: [{ section: "Saved Activity", remarks: "Saved activity notes", roleIds: ["role"],
          plannedStartDateTime: "2026-01-02T09:00", plannedEndDateTime: "2026-01-02T10:00" }] },
      { auditNumber: "AUD-001", qaqcClauses: "ISO 9001" },
      { name: "Saved Project", customFields: { contractNumber: "CON-1", client: "Saved Client", consultant: "Saved Consultant",
        mainContractor: "Saved Contractor", projectManager: "Saved Manager", tcc: "TCC value", pac: "PAC value",
        fac: "FAC value", contractValue: 0, contractSignedDate: "Signed date value", ptsNumber: "PTS-1" } },
      new Map([["lead", "Saved Lead"], ["team", "Saved Team"], ["creator", "Saved Creator"]]),
      new Map([["role", "Saved Role"]]), "UTC", "creator");
    const text = (await extractedReport(data, "audit-plan-populated-verification")).replace(/\s+/g, " ");
    for (const value of ["SAVED PROJECT", "PLAN-2026-01", "AUD-001", "Saved Lead", "Saved Team", "Saved Creator",
      "Saved Role", "Saved scope", "Internal", "English", "SHEQ-01", "ISO 9001", "02-01-2026", "03-01-2026",
      "08:15", "16:45", "Saved Activity", "Saved activity notes", "09:00", "10:00",
      ...data.project.map(([, value]) => value)]) expect(text).toContain(value);
    expect(text).toContain("Contract Value 0");
    expect(text).not.toContain("To be mapped");
  });
  it("prints all four saved multiline remarks in their matching rows/labelled continuations", async () => {
    const text = await extracted(remarks, "audit-plan-remarks-verification");
    for (const value of Object.values(remarks)) {
      for (const line of value.split("\n")) expect(text).toContain(line);
    }
    expect(text).not.toContain("Revision:");
    expect(text.match(/Signature: -/g)).toHaveLength(2);
    expect(text).not.toContain("To be mapped");
  });
  it("prints dashes for cleared remarks and missing signatures, never old mapping labels", async () => {
    const text = await extracted(Object.fromEntries(Object.keys(remarks).map(key => [key, " \n"])), "audit-plan-sparse-verification");
    expect(text).not.toContain("To Be Mapped");
    expect(text).not.toContain("To be mapped");
    expect(text).toMatch(/Start Date:\s+-\s+-/);
    expect(text).toMatch(/Closing Meeting:\s+-\s+-/);
  });
  it("retains the complete maximum-length text for every remark across continuation pages", async () => {
    const long = Object.fromEntries(Object.keys(remarks).map((key, i) => [
      key, `${i} BEGIN\n${Array.from({ length: 180 }, (_, n) => `R${i}-${String(n).padStart(3, "0")} Saved remark.`).join("\n")}\n${i} FINAL REMARK`.padEnd(4000, "."),
    ]));
    expect(Object.values(long).map(value => value.length)).toEqual([4000, 4000, 4000, 4000]);
    const text = (await extracted(long, "audit-plan-long-remarks-verification")).replace(/\s+/g, " ");
    for (const [i, label] of ["Start Date", "End Date", "Opening Meeting", "Closing Meeting"].entries()) {
      expect(text).toContain(`${label} Remarks (continuation)`);
      expect(text).toContain(`${i} FINAL REMARK`);
    }
    for (const marker of Object.values(long).join("").match(/R\d-\d{3}/g)!) expect(text).toContain(marker);
    expect(text).not.toContain("To be mapped");
  }, 30_000);
});
