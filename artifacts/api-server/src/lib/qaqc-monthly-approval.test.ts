import { describe, expect, it } from "vitest";
import { advanceMonthlyApproval, monthlyApprovalStages, readMonthlyApproval, startMonthlyApproval, MONTHLY_APPROVAL_KEY, hasMonthlyReviewHistory, type ApprovalGrant } from "./qaqc-monthly-approval";
import { calculateReport, validateReportData } from "./qaqc-reporting-model";
import { ReviewQaqcSowReportBody } from "@workspace/api-zod";

const grant = (overrides: Partial<ApprovalGrant> = {}): ApprovalGrant => ({
  userId: "reviewer", name: "Reviewer", roleId: "role", roleName: "Review role", level: 1,
  key: "qaqc.monthly_reports.approve_reject", projectIds: ["project"], businessUnitIds: [],
  ...overrides,
});

describe("monthly approval capability-coupled scope", () => {
  it("combines project and organization-wide approvals in numeric level order", () => {
    const result = monthlyApprovalStages([grant({ level: 10, userId: "org", projectIds: [] }), grant({ level: 2 })], "project", "creator");
    expect(result.errors).toEqual([]);
    expect(result.stages.map(stage => stage.level)).toEqual([2, 10]);
    expect(result.stages[1].candidates[0].id).toBe("org");
  });
  it("does not borrow organization-wide read scope for a different project's review role", () => {
    const result = monthlyApprovalStages([
      grant({ projectIds: ["other-project"] }),
      grant({ projectIds: [], key: "qaqc.monthly_reports.view_all" }),
    ], "project", "creator");
    expect(result.stages).toEqual([]);
    expect(result.errors[0]).toContain("No monthly approval levels");
  });
  it("does not treat a business-unit-only assignment as organization-wide", () => {
    expect(monthlyApprovalStages([grant({ projectIds: [], businessUnitIds: ["bu"] })], "project", "creator").stages).toEqual([]);
  });
  it("does not include a read-only approval grant", () => {
    expect(monthlyApprovalStages([grant({ grant: "select" })], "project", "creator").stages).toEqual([]);
  });
  it.each(["qaqc.csat_reports.approve_reject", "qaqc.daily_reports.approve_reject", "qaqc.monthly_reports.submit", "audit.schedules.approve_reject"])("excludes unrelated permission %s", key => {
    expect(monthlyApprovalStages([grant({ key })], "project", "creator").stages).toEqual([]);
  });
  it.each(["approve_reject", "qaqc.approve_reject", "metrics.approve_reject", "monthly_reports.approve_reject"])("supports compatible monthly approval grant %s", key => {
    expect(monthlyApprovalStages([grant({ key })], "project", "creator").stages).toHaveLength(1);
  });
  it("deduplicates multiple assignments at a level, preserving multiple choices", () => {
    const result = monthlyApprovalStages([grant(), grant({ roleId: "second" }), grant({ userId: "reviewer2", name: "Another reviewer" })], "project", "creator");
    expect(result.stages[0].candidates.map(candidate => candidate.id)).toEqual(["reviewer2", "reviewer"]);
  });
  it("excludes submitter without silently skipping their required level", () => {
    const result = monthlyApprovalStages([grant({ userId: "creator" }), grant({ level: 2 })], "project", "creator");
    expect(result.stages.map(stage => stage.level)).toEqual([1, 2]);
    expect(result.stages[0].candidates).toEqual([]);
    expect(result.errors.join(" ")).toContain("Level 1");
  });
  it("does not silently skip a configured level when its only reviewer is inactive or externally unauthorized", () => {
    const result = monthlyApprovalStages([grant(), grant({ level: 2, userId: "inactive", available: false })], "project", "creator");
    expect(result.stages.map(stage => stage.level)).toEqual([1, 2]);
    expect(result.stages[1].candidates).toEqual([]);
    expect(result.errors.join(" ")).toContain("Level 2");
  });
  it.each([null, 0, -1, 1.5])("requires explicit positive integer level, not role name (%s)", level => {
    const result = monthlyApprovalStages([grant({ roleName: "Level 2 Manager", level })], "project", "creator");
    expect(result.errors.join(" ")).toContain('Set an Approval Level on role "Level 2 Manager"');
  });
  it("ignores unconfigured roles outside the project rather than blocking", () => {
    expect(monthlyApprovalStages([grant(), grant({ projectIds: ["other"], level: null })], "project", "creator").errors).toEqual([]);
  });
});

describe("snapshotted sequential monthly approval", () => {
  const stages = monthlyApprovalStages([grant(), grant({ level: 3, userId: "senior", name: "Senior" })], "project", "creator").stages;
  const begin = () => startMonthlyApproval(stages, "reviewer", "creator", "2026-10-22T01:00:00Z");
  it("rejects selecting a higher-level approver for first submission", () => {
    expect(() => startMonthlyApproval(stages, "senior", "creator", "now")).toThrow("Level 1");
  });
  it("rejects an empty or unstaffed chain", () => {
    expect(() => startMonthlyApproval([], "reviewer", "creator", "now")).toThrow("Every approval level");
    expect(() => startMonthlyApproval([{ level: 1, candidates: [] }], "reviewer", "creator", "now")).toThrow("Every approval level");
  });
  it("advances exactly one configured level, without mutating saved snapshot", () => {
    const first = begin();
    const { next, ...advanced } = advanceMonthlyApproval(first, "approve", "reviewer", "2026-10-22T02:00:00Z", "Checked");
    expect(next?.level).toBe(3);
    expect(advanced.currentIndex).toBe(1);
    expect(first.currentIndex).toBe(0);
    expect(advanced.history.at(-1)).toMatchObject({ level: 1, decision: "approve", userId: "reviewer", comments: "Checked" });
    const finished = advanceMonthlyApproval(advanced, "approve", "senior", "2026-10-22T03:00:00Z", "");
    expect(finished.next).toBeUndefined();
    expect(finished.currentIndex).toBe(stages.length);
  });
  it("rejects a future-level reviewer acting early", () => {
    expect(() => advanceMonthlyApproval(begin(), "approve", "senior", "now", "")).toThrow("current approval level");
  });
  it("sends back without forwarding and restarts every level on resubmission while retaining history", () => {
    const { next, ...returned } = advanceMonthlyApproval(begin(), "send_back", "reviewer", "now", "Correct totals");
    expect(next).toBeUndefined();
    const resubmitted = startMonthlyApproval(stages, "reviewer", "creator", "later", returned);
    expect(resubmitted.currentIndex).toBe(0);
    expect(resubmitted.cycle).toBe(2);
    expect(resubmitted.history.map(event => event.decision)).toEqual(["submitted", "send_back", "submitted"]);
    expect(resubmitted.history[1].comments).toBe("Correct totals");
  });
  it("keeps legacy submitted reports on their existing workflow", () => {
    expect(readMonthlyApproval({})).toBeUndefined();
    const workflow = begin();
    expect(readMonthlyApproval({ [MONTHLY_APPROVAL_KEY]: workflow })).toBe(workflow);
  });
  it("does not change report calculations or validation when storing workflow snapshots", () => {
    const data = { metrics: { external_ncr: { issued: 5, closed: 3 } }, training: { trainingCount: 2, attendance: 8, durationMinutes: 60 } };
    const baseline = { metrics: { external_ncr: { accumulatedIssued: 10, accumulatedClosed: 7 } } };
    const snapshot = { ...baseline, [MONTHLY_APPROVAL_KEY]: begin() };
    expect(calculateReport("monthly", data, snapshot)).toEqual(calculateReport("monthly", data, baseline));
    expect(validateReportData("monthly", data, snapshot, true)).toEqual(validateReportData("monthly", data, baseline, true));
  });
  it("accepts next-level reviewer selection in the generated request contract", () => {
    expect(ReviewQaqcSowReportBody.parse({ decision: "approve", nextApproverId: "senior" })).toEqual({ decision: "approve", nextApproverId: "senior" });
  });
  it("retains previous reviewer participation after forwarding, but never for future candidates or other report types", () => {
    const { next, ...forwarded } = advanceMonthlyApproval(begin(), "approve", "reviewer", "now", "");
    const row = { reportType: "monthly", baseline: { [MONTHLY_APPROVAL_KEY]: forwarded } };
    expect(hasMonthlyReviewHistory(row, "reviewer")).toBe(true);
    expect(hasMonthlyReviewHistory(row, "senior")).toBe(false);
    expect(hasMonthlyReviewHistory(row, "outsider")).toBe(false);
    expect(hasMonthlyReviewHistory(row, "creator")).toBe(false);
    expect(hasMonthlyReviewHistory({ ...row, reportType: "daily" }, "reviewer")).toBe(false);
    expect(hasMonthlyReviewHistory({ ...row, baseline: {} }, "reviewer")).toBe(false);
    expect(next?.level).toBe(3);
  });
});
