import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import { auditPlanReportData, TO_BE_MAPPED } from "./audit-plan-report-data";
import { renderAuditPlanPdf } from "./audit-plan-pdf";

const people = new Map([["lead", "Test Lead Auditor"], ["team", "Test Team Member"], ["owner", "Test Activity Owner"]]);
const roles = new Map([["role", "Project Team"]]);
const meta = {
  leadAuditorId: "lead", auditeeRoleIds: ["role"], qaqcScope: "Project management and construction", auditTypes: ["Internal"],
  auditLanguage: "Verbal: English\nWriting: English", qaqcReference: "QAM-IA/26-007",
  startDateTime: "2026-01-26T03:30:00Z", endDateTime: "2026-01-27T11:00:00Z",
  openingMeetingDateTime: "2026-01-26T03:30:00Z", closingMeetingDateTime: "2026-01-27T11:00:00Z",
  activityDateTime: "2026-01-26T04:00:00Z",
  activities: [{ section: "General Requirement", remarks: "Quality policy\nQuality records\nDocument controls", auditeeId: "owner" }],
};
const plan = { teamMemberIds: ["team"], createdAt: "2026-01-22T12:00:00Z" };
const schedule = { auditNumber: "AGC-007", qaqcClauses: "ISO 9001:2015" };
const project = { name: "TEST PROJECT FOR AUDIT PLAN", code: "Not a contract number", customFields: {
  "Contract Number": "TEST-44001", Client: "Test Client", Consultant: "Test Consultant", "Project Manager": "Test Manager",
} };
const data = () => auditPlanReportData(plan, meta, schedule, project, people, roles, "Asia/Kolkata");

describe("Audit Plan PDF mappings", () => {
  it("resolves distinct lead, team, plan auditee roles, and activity auditee users", () => {
    const report = data();
    expect(report.lead).toBe("Test Lead Auditor");
    expect(report.team).toBe("Test Team Member");
    expect(report.auditee).toBe("Project Team");
    expect(report.activities[0]?.auditee).toBe("Test Activity Owner");
    expect(report.sheqReference).toBe("QAM-IA/26-007");
    expect(report.standards).toBe("ISO 9001:2015");
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
  it("formats meeting times in the downloading user's timezone", () => {
    expect(data().opening).toBe("26-01-2026\n09:00");
    expect(data().start).toBe("26-01-2026");
  });
  it("preserves repeatable activity order and supports legacy single activity fields", () => {
    const multiple = auditPlanReportData(plan, { ...meta, activities: [...meta.activities, { section: "Design", remarks: "Design records", auditeeId: "team" }] }, schedule, project, people, roles, "UTC");
    expect(multiple.activities.map(r => r.section)).toEqual(["General Requirement", "Design"]);
    const legacy = auditPlanReportData(plan, { activitySection: "Legacy section", activityRemarks: "Legacy notes", activityAuditeeId: "owner" }, schedule, project, people, roles, "UTC");
    expect(legacy.activities[0]).toMatchObject({ section: "Legacy section", remarks: "Legacy notes", auditee: "Test Activity Owner" });
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
      auditee: "Test Activity Owner", dateTime: "26-01-2026\n09:30" }));
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