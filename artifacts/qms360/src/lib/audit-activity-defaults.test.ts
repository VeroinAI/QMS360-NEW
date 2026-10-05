import { describe, expect, it } from "vitest";
import { activityRoleDefaults, activityAuditeeDefaults, activityAuditeeIds, withActivityAuditees } from "./audit-activity-defaults";
const row = { id: "row", section: "Design", remarks: "Keep", auditeeId: "old",
  plannedStartDateTime: "2026-01-01T09:00", plannedEndDateTime: "2026-01-01T10:00" };
describe("Activity roles and schedule auditee defaults", () => {
  it("copies single/multiple Audit role references from the corresponding master only", () => {
    expect(activityRoleDefaults({ assignedRoles: [
      { application: "audit", roleId: "design" }, { application: "audit", roleId: "review" },
      { application: "qaqc", roleId: "other" }, { application: "audit", roleId: "design" },
    ] })).toEqual(["design", "review"]);
    expect(activityRoleDefaults(undefined)).toEqual([]);
  });
  it("combines matching role users once and uses modified schedule mappings", () => {
    const assignments = [
      { roleId: "design", userIds: ["a", "b"] }, { roleId: "review", userIds: ["b", "c"] },
      { roleId: "unrelated", userIds: ["other"] },
    ];
    expect(activityAuditeeDefaults(["design", "review"], assignments)).toEqual(["a", "b", "c"]);
    expect(activityAuditeeDefaults(["design"], [{ roleId: "design", userIds: ["replacement"] }])).toEqual(["replacement"]);
    expect(activityAuditeeDefaults(["not-mapped"], assignments)).toEqual([]);
  });
  it("supports manual overrides, clear selection and legacy scalar auditees without altering dates", () => {
    const changed = withActivityAuditees(row, ["manual", "second"]);
    expect(activityAuditeeIds(changed)).toEqual(["manual", "second"]);
    expect(changed.auditeeId).toBe("manual");
    expect(changed.plannedStartDateTime).toBe(row.plannedStartDateTime);
    expect(changed.plannedEndDateTime).toBe(row.plannedEndDateTime);
    expect(activityAuditeeIds(row)).toEqual(["old"]);
    expect(activityAuditeeIds(withActivityAuditees(row, []))).toEqual([]);
    expect(row.auditeeId).toBe("old");
  });
});