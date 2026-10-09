import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import { auditPlanReportData, TO_BE_MAPPED } from "./audit-plan-report-data";
import { renderAuditPlanPdf } from "./audit-plan-pdf";
import { auditPlanDateErrors } from "@workspace/field-controls";
import { getDateFormat, setDateFormatResolver } from "@workspace/spreadsheet-dates";

const previousDateFormat = getDateFormat();
beforeAll(() => setDateFormatResolver(() => "DD-MM-YYYY"));
afterAll(() => setDateFormatResolver(() => previousDateFormat));

const people = new Map([["lead", "Test Lead Auditor"], ["team", "Test Team Member"], ["owner", "Test Activity Owner"]]);
const roles = new Map([["role", "Project Team"], ["procurement", "Procurement Lead"], ["quality", "Quality Manager"]]);
const meta = {
  leadAuditorId: "lead", auditeeRoleIds: ["role"], qaqcScope: "Project management and construction", auditTypes: ["Internal"],
  auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "QAM-IA/26-007",
  startDateTime: "2026-01-26T03:30:00Z", endDateTime: "2026-01-27T11:00:00Z",
  openingMeetingDateTime: "2026-01-26T03:30:00Z", closingMeetingDateTime: "2026-01-27T11:00:00Z",
  activityDateTime: "2026-01-26T04:00:00Z",
  activities: [{ section: "General Requirement", remarks: "Quality policy\nQuality records\nDocument controls", roleIds: ["procurement", "quality"], auditeeId: "owner" }],
};
const plan = { teamMemberIds: ["team"], createdAt: "2026-01-22T12:00:00Z" };
const schedule = { auditNumber: "AGC-007", qaqcClauses: "ISO 9001:2015" };
const project = { name: "TEST PROJECT FOR AUDIT PLAN", code: "Not a contract number", customFields: {
  "Contract Number": "TEST-44001", Client: "Test Client", Consultant: "Test Consultant", "Project Manager": "Test Manager",
} };
const data = () => auditPlanReportData(plan, meta, schedule, project, people, roles, "Asia/Kolkata");

describe("Audit Plan PDF mappings", () => {
  it("maps each activity range independently, preserves local times and marks legacy derivation", () => {
    const report = auditPlanReportData(plan, { ...meta, activities: [
      { ...meta.activities[0], plannedStartDateTime: "2026-01-26T09:00", plannedEndDateTime: "2026-01-26T10:00" },
      { section: "Design", remarks: "Design records", auditeeId: "team", plannedStartDateTime: "2026-01-27T22:00", plannedEndDateTime: "2026-01-27T23:59" },
    ] }, schedule, project, people, roles, "Asia/Kolkata");
    expect(report.activities[0]?.plannedStart).toBe("26-01-2026\n09:00");
    expect(report.activities[1]?.plannedEnd).toBe("27-01-2026\n23:59");
    expect(report.activities[1]?.dateTime).not.toContain("26-01-2026");
    expect(data().activities[0]?.legacyDateTimeDerived).toBe(true);
    const unavailable = auditPlanReportData({}, {}, {}, undefined, people, roles, "UTC");
    expect(unavailable.activities[0]?.plannedStart).toBe(TO_BE_MAPPED);
    expect(unavailable.activities[0]?.plannedEnd).toBe(TO_BE_MAPPED);
  });
  it("resolves distinct lead, team, plan auditee roles, and activity Auditee Roles", () => {
    const report = data();
    expect(report.lead).toBe("Test Lead Auditor");
    expect(report.team).toBe("Test Team Member");
    expect(report.auditee).toBe("Project Team");
    expect(report.activities[0]?.auditee).toBe("Procurement Lead, Quality Manager");
    expect(report.sheqReference).toBe("QAM-IA/26-007");
    expect(report.standards).toBe("ISO 9001:2015");
  });
  it("uses each row's saved roles, not assigned people or the plan-level Auditee", () => {
    const report = auditPlanReportData(plan, { ...meta, activities: [
      { ...meta.activities[0], auditeeIds: ["owner", "team"] },
      { ...meta.activities[0], section: "Design", roleIds: ["quality"], auditeeIds: ["owner"] },
    ] }, schedule, project, people, roles, "UTC");
    expect(report.activities.map(row => row.auditee)).toEqual(["Procurement Lead, Quality Manager", "Quality Manager"]);
    expect(report.auditee).toBe("Project Team");
  });
  it.each([undefined, [], ["missing-role"]])("does not substitute user names when activity roles are unavailable (%s)", roleIds => {
    const report = auditPlanReportData(plan, { ...meta, activities: [{ ...meta.activities[0], roleIds }] },
      schedule, project, people, roles, "UTC");
    expect(report.activities[0]?.auditee).toBe(TO_BE_MAPPED);
  });
  it("uses explicit project master fields, not project codes as contract numbers", () => {
    expect(data().project.find(([key]) => key === "Contract #")?.[1]).toBe("TEST-44001");
    const report = auditPlanReportData(plan, meta, schedule, { ...project, customFields: {} }, people, roles, "UTC");
    expect(report.project.find(([key]) => key === "Contract #")?.[1]).toBe(TO_BE_MAPPED);
    expect(data().project.find(([key]) => key === "Contract Value")?.[1]).toBe(TO_BE_MAPPED);
  });
  it("does not fabricate dates, sample people or sample activity topics for legacy records", () => {
    const report = auditPlanReportData({}, {}, {}, undefined, new Map(), new Map(), "UTC");
    expect(report.opening).toBe(TO_BE_MAPPED);
    expect(report.preparedDate).toBe(TO_BE_MAPPED);
    expect(report.lead).toBe(TO_BE_MAPPED);
    expect(report.activities[0]?.section).toBe(TO_BE_MAPPED);
  });
  it("preserves planned meeting times rather than converting them to the downloading user's timezone", () => {
    expect(data().opening).toBe("26-01-2026\n03:30");
    expect(data().start).toBe("26-01-2026");
  });
  it.each(["Z", "+14:00", "-12:00"])("preserves boundary dates and wall-clock times for planned timestamps ending in %s", suffix => {
    const start = `2026-01-01T00:15${suffix}`, end = `2026-01-02T23:59${suffix}`;
    const planned = { ...meta, startDateTime: start, endDateTime: end,
      openingMeetingDateTime: start, closingMeetingDateTime: end,
      activities: [{ ...meta.activities[0], plannedStartDateTime: start, plannedEndDateTime: end }] };
    expect(auditPlanDateErrors(planned, { plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02" }, planned.activities)).toEqual({});
    for (const zone of ["Asia/Kolkata", "America/Los_Angeles", "UTC"]) {
      const report = auditPlanReportData(plan, planned, schedule, project, people, roles, zone);
      expect(report.start).toBe("01-01-2026");
      expect(report.end).toBe("02-01-2026");
      expect(report.opening).toBe("01-01-2026\n00:15");
      expect(report.closing).toBe("02-01-2026\n23:59");
      expect(report.activities[0]?.plannedStart).toBe("01-01-2026\n00:15");
      expect(report.activities[0]?.plannedEnd).toBe("02-01-2026\n23:59");
    }
  });
  it("converts actual preparation timestamps to the requested timezone", () => {
    const created = { ...plan, createdAt: "2026-01-22T23:45:00Z" };
    expect(auditPlanReportData(created, meta, schedule, project, people, roles, "Asia/Kolkata").preparedDate).toBe("23-01-2026");
    expect(auditPlanReportData(created, meta, schedule, project, people, roles, "America/Los_Angeles").preparedDate).toBe("22-01-2026");
  });
  it("keeps invalid planned dates unavailable instead of rolling them into another day", () => {
    const report = auditPlanReportData(plan, { ...meta, activities: [
      { ...meta.activities[0], plannedStartDateTime: "2026-02-30T00:15Z", plannedEndDateTime: "2026-01-02T23:59-24:00" },
    ] }, schedule, project, people, roles, "Asia/Kolkata");
    expect(report.activities[0]?.plannedStart).toBe(TO_BE_MAPPED);
    expect(report.activities[0]?.plannedEnd).toBe(TO_BE_MAPPED);
  });
  it("preserves repeatable activity order and supports legacy single activity fields", () => {
    const multiple = auditPlanReportData(plan, { ...meta, activities: [...meta.activities, { section: "Design", remarks: "Design records", auditeeId: "team" }] }, schedule, project, people, roles, "UTC");
    expect(multiple.activities.map(r => r.section)).toEqual(["General Requirement", "Design"]);
    const legacy = auditPlanReportData(plan, { activitySection: "Legacy section", activityRemarks: "Legacy notes", activityAuditeeId: "owner" }, schedule, project, people, roles, "UTC");
    expect(legacy.activities[0]).toMatchObject({ section: "Legacy section", remarks: "Legacy notes", auditee: TO_BE_MAPPED });
  });
});

describe("Audit Plan PDF rendering", () => {
  it("produces an A4 branded PDF using the blank template", async () => {
    const bytes = await renderAuditPlanPdf(data());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.32, 1);
    expect(pdf.getTitle()).toBe("Audit Plan - TEST PROJECT FOR AUDIT PLAN");
    await writeFile("/tmp/audit-plan-report-verification.pdf", bytes);
  });
  it("paginates long activities instead of dropping rows", async () => {
    const report = data();
    report.activities = Array.from({ length: 12 }, (_, i) => ({ section: `Section ${i + 1}`, remarks: "A long activity description with quality requirements. ".repeat(35),
       auditee: "Procurement Lead, Quality Manager", dateTime: "26-01-2026\n09:30" }));
    report.lead = "Long auditor name ".repeat(35);
    const bytes = await renderAuditPlanPdf(report);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
    await writeFile("/tmp/audit-plan-report-long-verification.pdf", bytes);
  }, 30_000);
  it("has no sample textual data or signature page in the template", async () => {
    const bytes = await readFile(new URL("../assets/audit-plan-template.pdf", import.meta.url));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});