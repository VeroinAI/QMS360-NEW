import { describe, expect, it } from "vitest";
import { buildAuditReportTable, reportDays, reportKeys, type ReportData, type ReportKey } from "./audit-report-tables";

function fixture(): ReportData {
  return {
    viewerId: "lead", fullAuditIds: new Set(["audit"]), now: "2026-11-04",
    schedules: [
      { id: "programme", year: 2026, title: "Annual programme", status: JSON.stringify({ programme: true }) },
      { id: "schedule", projectId: "project", year: 2026, title: "Civil audit", status: JSON.stringify({
        parentId: "programme", auditNumber: "AUD-1", qaqcReference: "QA-1", auditTypes: ["Product Audit"],
        auditCategory: "Product", plannedStartDate: "2026-11-01", plannedEndDate: "2026-11-02",
        location: "Site A", l1ReviewStatus: "Approved", l2ReviewStatus: "Pending",
      }) },
    ],
    plans: [{ id: "plan", auditScheduleId: "schedule", teamMemberIds: ["lead"], status: JSON.stringify({ leadAudorId: "unused", leadAuditorId: "lead" }) }],
    audits: [{ id: "audit", auditPlanId: "plan", projectId: "project", referenceNumber: "EXEC-1", workflowState: "in progress",
      status: JSON.stringify({ title: "Civil execution" }), checklistState: [
        { id: "item", auditFinding: "Major NC", findingNumber: "F-1", findingDate: "2026-11-01",
          actionTakerId: "owner", description: "Missing inspection record", clause: "8.1", evidenceIds: ["proof"] },
        { id: "na", auditFinding: "Not applicable", description: "Must not appear" },
      ] }],
    findings: [
      { id: "mirror", auditId: "audit", classification: "Major NC", status: "active", evidence: { sourceChecklistItemId: "item" } },
      { id: "legacy", auditId: "audit", classification: "Minor NC", status: "Open", description: "Legacy finding",
        evidence: { findingNumber: "F-2", findingDate: "2026-11-02", clause: "9.1" } },
    ],
    cars: [
      { id: "car", auditFindingId: "mirror", ownerId: "owner", workflowState: "closed", dueDate: "2026-11-03",
        rootCause: "Cause", correctiveAction: "Corrected record", effectivenessNotes: JSON.stringify({
          carNumber: "CAR-1", closedAt: "2026-11-04T10:00:00Z", reviewOutcome: "accept" }) },
      { id: "car2", auditFindingId: "legacy", ownerId: "owner", workflowState: "submitted",
        dueDate: "2026-11-05", effectivenessNotes: JSON.stringify({ carNumber: "CAR-2", carApproval: {
          status: "Pending approval", index: 0, steps: [{ approvers: [{ id: "lead", name: "Old name" }] }] } }) },
    ],
    users: [{ id: "lead", fullName: "Audit Lead" }, { id: "owner", fullName: "Action Owner" }],
    projects: [{ id: "project", name: "Actual project" }], labels: [],
    evidence: [{ id: "proof", recordId: "audit", recordType: "audit", status: "stored" }],
    events: [{ entityId: "plan", action: "send_for_audit", createdAt: "2026-10-30T08:00:00Z" }],
    escalations: [{ recordId: "car2", currentLevel: "Level 2", startedAt: "2026-11-03", resolvedAt: null }],
  };
}
const table = (key: ReportKey, data = fixture(), extra = {}) => buildAuditReportTable(key, data, { page: 1, limit: 25, ...extra });
const object = (key: ReportKey, index = 0, data = fixture()) => {
  const result = table(key, data);
  return Object.fromEntries(result.columns.map((column, i) => [column.label, result.rows[index].values[i]]));
};

describe("Audit workbook report projections", () => {
  it("derives available years from this report's authorized rows, not filters or pagination", () => {
    const data = fixture();
    data.schedules.push({ id: "older-schedule", year: 2010, title: "Older planned audit",
      status: JSON.stringify({ parentId: "programme" }) });
    expect(table("schedule", data, { page: 2, limit: 1, year: 2025, search: "no match" }).availableYears).toEqual([2026, 2010]);
    expect(table("open-vs-closed", data).availableYears).toEqual([2026]);
    expect(table("findings-log", data).availableYears).toEqual([2026]);
    expect(table("car-status", data).availableYears).toEqual([2026]);
    data.scheduleIds = new Set(["older-schedule"]);
    expect(table("schedule", data).availableYears).toEqual([2010]);
    data.audits = [];
    for (const key of ["open-vs-closed", "findings-log", "car-status"] as const)
      expect(table(key, data).availableYears).toEqual([]);
  });
  it("preserves each workbook's column count and exact title", () => {
    for (const [key, count, title] of [
      ["open-vs-closed", 18, "Open vs Closed Audits"], ["findings-log", 18, "Findings Log"],
      ["car-status", 19, "CAR Status & Closure"], ["schedule", 15, "Annual Audit Schedule"],
    ] as const) {
      const result = table(key);
      expect(result.title).toBe(title);
      expect(result.columns).toHaveLength(count);
      expect(result.rows.every(row => row.values.length === count)).toBe(true);
    }
  });
  it("counts live checklist and legacy findings once without mirrors or Not applicable", () => {
    const row = object("open-vs-closed");
    expect(row).toMatchObject({ "Audit Schedule": "Annual programme", "Audit Reference Number": "QA-1",
      "Number of Major NCs": "1", "Number of Minor NCs": "1", "Number of Moderate NCs": "0",
      "Open CAR Count": "1", "Closed CAR Count": "1", "Closure Delay (Days)": "2",
      "Project/Department": "Actual project", "Audit Lead": "Audit Lead" });
  });
  it("joins findings, evidence, actual closures, owners and recorded escalation levels", () => {
    expect(table("findings-log").total).toBe(2);
    expect(object("findings-log")).toMatchObject({ "Findings Reference Number": "F-1", "Audit Number": "AUD-1",
      "Finding Date": "2026-11-01", "Evidence Attachment Available": "Yes", "Responsible Owner": "Action Owner",
      "CAR Number": "CAR-1", "Actual Closure Date": "2026-11-04", "Open Days": "3" });
    expect(object("findings-log", 1)).toMatchObject({ "Escalation Level": "Level 2", "Open Days": "2" });
  });
  it("uses effective approved extensions, real closure dates and current pending reviewers", () => {
    expect(object("car-status")).toMatchObject({ "CAR Number": "CAR-1", "Closed within ACD": "No",
      "Closure Delay (Days)": "1", "Current Owner": null });
    expect(object("car-status", 1)).toMatchObject({ "Current Owner": "Audit Lead", "Closure Date": null });
    const data = fixture();
    Object.assign(data.cars[0], { extensionStatus: "approved", extensionDueDate: "2026-11-06" });
    expect(object("car-status", 0, data)).toMatchObject({ "Due Date": "2026-11-06", "Closed within ACD": "Yes", "Closure Delay (Days)": "0" });
  });
  it("does not invent missing dates, identifiers, escalation levels or memo release dates", () => {
    const data = fixture();
    data.audits[0].checklistState[0].findingDate = null;
    data.findings[0].evidence = { sourceChecklistItemId: "item" };
    data.cars[0].effectivenessNotes = "{}";
    expect(object("findings-log", 0, data)).toMatchObject({ "Finding Date": null, "Open Days": null, "Actual Closure Date": null, "CAR Number": null, "Escalation Level": null });
    expect(object("schedule", 0, data)).toMatchObject({ "Memo Released Date": null, "Audit Plan Sent Date": "2026-10-30" });
  });
  it("lists individual scheduled audits, including those without executions, not parent programmes", () => {
    const data = fixture();
    data.schedules.push({ ...data.schedules[1], id: "future", title: "Future audit" });
    expect(table("schedule", data).total).toBe(2);
    data.scheduleIds = new Set(["future"]);
    expect(table("schedule", data).rows.map(row => row.id)).toEqual(["future"]);
  });
  it("resolves department master identities for projectless Process audits", () => {
    const data = fixture(), schedule = data.schedules[1];
    schedule.projectId = null;
    schedule.status = JSON.stringify({ ...JSON.parse(schedule.status), departmentProject: "dept", auditTypes: ["Quality Internal Process Audit"] });
    data.audits[0].projectId = null;
    data.labels.push({ group: "departments", id: "dept", value: "CIV", label: "Civil Department" });
    expect(object("open-vs-closed", 0, data)["Project/Department"]).toBe("Civil Department");
  });
  it("keeps an own-only action taker limited to their assigned findings", () => {
    const data = fixture();
    data.fullAuditIds.clear();
    data.viewerId = "other";
    expect(table("findings-log", data).total).toBe(0);
    data.viewerId = "owner";
    expect(table("findings-log", data).total).toBe(2);
  });
  it("filters the entire result before paging, and exports every matching row", () => {
    expect(table("findings-log", fixture(), { limit: 1, page: 2 }).rows[0].values[0]).toBe("F-2");
    expect(table("findings-log", fixture(), { limit: 1, all: true }).rows).toHaveLength(2);
    expect(table("findings-log", fixture(), { search: "legacy" }).rows[0].values[0]).toBe("F-2");
    expect(table("findings-log", fixture(), { year: 2027 }).total).toBe(0);
  });
  it("returns workbook headers even when there is no data and never mutates source records", () => {
    const data = fixture(), before = JSON.stringify(data);
    for (const key of reportKeys) table(key, data);
    expect(JSON.stringify(data)).toBe(before);
    data.audits = []; data.schedules = [];
    for (const key of reportKeys) expect(table(key, data).rows).toEqual([]);
  });
  it("requires actual dates for elapsed-day and delay metrics", () => {
    expect(reportDays(null, "2026-11-04")).toBeNull();
    expect(reportDays("2026-11-03", null)).toBeNull();
    expect(reportDays("2026-11-05", "2026-11-04")).toBe(0);
  });
  it("measures completed-audit delay at the completion transition, not later edits", () => {
    const data = fixture();
    data.audits[0].workflowState = "completed";
    data.events.push(
      { entityId: "audit", action: "complete", createdAt: "2026-11-03", before: { workflowState: "in progress" }, after: { workflowState: "completed" } },
      { entityId: "audit", action: "update", createdAt: "2026-11-05", before: { workflowState: "completed" }, after: { workflowState: "completed" } },
    );
    expect(object("open-vs-closed", 0, data)["Closure Delay (Days)"]).toBe("1");
  });
});
