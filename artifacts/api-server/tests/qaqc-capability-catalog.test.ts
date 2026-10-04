import { describe, expect, it } from "vitest";
import { qaqcActivityGroups, qaqcPermissionMatches } from "@workspace/field-controls";
describe("QA/QC activity permissions", () => {
  it("recognizes the legacy editor and seeded create and own-view keys", () => {
    for (const key of ["data_entry", "create_edit"]) expect(qaqcPermissionMatches(key, "metrics", "create_edit")).toBe(true);
    for (const key of ["view_own", "view_own_scope"]) expect(qaqcPermissionMatches(key, "monthly_reports", "view_own_scope")).toBe(true);
  });
  it("keeps new activity grants specific, while preserving old reporting grants", () => {
    expect(qaqcPermissionMatches("qaqc.metrics.create_edit", "monthly_reports", "create_edit")).toBe(false);
    expect(qaqcPermissionMatches("metrics.create_edit", "monthly_reports", "create_edit")).toBe(true);
    expect(qaqcPermissionMatches("qaqc.monthly_reports.view_all", "daily_reports", "view_all")).toBe(false);
  });
  it("does not infer approve, delete or export from create/edit", () => {
    for (const action of ["approve_reject", "delete", "export"] as const)
      expect(qaqcPermissionMatches("data_entry", "metrics", action)).toBe(false);
  });
  it("recognizes every task offered in the activity editor", () => {
    for (const group of qaqcActivityGroups) for (const action of group.actions)
      expect(qaqcPermissionMatches(`qaqc.${group.module}.${action}`, group.module, action)).toBe(true);
  });
});