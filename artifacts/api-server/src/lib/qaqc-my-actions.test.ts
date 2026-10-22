import { describe, expect, it } from "vitest";
import { personalReportAction } from "./qaqc-my-actions";

const base = { reportType: "daily", state: "draft", createdById: "creator", approverId: "reviewer", submittedById: "creator" };
describe("personal QA/QC report actions", () => {
  it("includes only the creator's editable drafts and corrections", () => {
    for (const state of ["draft", "sent_back"]) {
      expect(personalReportAction({ ...base, state }, "creator", { edit: true, review: false })).toBe(true);
      expect(personalReportAction({ ...base, state }, "other", { edit: true, review: true })).toBe(false);
      expect(personalReportAction({ ...base, state }, "creator", { edit: false, review: true })).toBe(false);
    }
  });
  it.each(["monthly", "daily"])("includes assigned %s reviews only with review authorization", reportType => {
    const row = { ...base, reportType, state: "submitted" };
    expect(personalReportAction(row, "reviewer", { edit: false, review: true })).toBe(true);
    expect(personalReportAction(row, "other", { edit: true, review: true })).toBe(false);
    expect(personalReportAction(row, "reviewer", { edit: true, review: false })).toBe(false);
    expect(personalReportAction({ ...row, submittedById: "reviewer" }, "reviewer", { edit: true, review: true })).toBe(false);
  });
  it("does not send final CSAT submissions into approval queues, including legacy assignments", () => {
    expect(personalReportAction({ ...base, reportType: "csat", state: "submitted" }, "reviewer", { edit: true, review: true })).toBe(false);
    expect(personalReportAction({ ...base, reportType: "csat" }, "creator", { edit: true, review: true })).toBe(true);
  });
  it.each(["approved", "deleted"])("excludes completed and deleted reports (%s)", state => {
    expect(personalReportAction({ ...base, state }, "creator", { edit: true, review: true })).toBe(false);
    expect(personalReportAction({ ...base, state }, "reviewer", { edit: true, review: true })).toBe(false);
  });
});
