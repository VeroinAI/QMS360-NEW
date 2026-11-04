import { describe, expect, it } from "vitest";
import { auditScheduleApprovalPermission } from "@workspace/field-controls";
import { submitCarApproval, reviewCarApproval, canReviewCar } from "../src/lib/car-approval";
import type { ReportReviewer } from "../src/lib/audit-report-approval";
const person = (level: number | null, userId = `u${level}`, roleId = `r${level}`): ReportReviewer =>
  ({ level, userId, roleId, userName: userId, roleName: roleId, projectIds: [], businessUnitIds: [] });
describe("CAR approval routes", () => {
  it("isolates explicit CAR grants from legacy Schedule fallback", () => {
    expect(auditScheduleApprovalPermission(["approve_reject"])).toBe(true);
    expect(auditScheduleApprovalPermission(["approve_reject", "audit.cars.approve_reject"])).toBe(false);
    expect(auditScheduleApprovalPermission(["audit.cars.approve_reject"])).toBe(false);
    expect(auditScheduleApprovalPermission(["approve_reject", "audit.cars.approve_reject", "audit.schedules.approve_reject"])).toBe(true);
  });
  it("requires eligible reviewers and valid levels", () => {
    expect(() => submitCarApproval([], "owner")).toThrow(/No CAR approvers/);
    for (const level of [null, 0, -1, 1.5]) expect(() => submitCarApproval([person(level)], "owner")).toThrow(/Approval Level/);
  });
  it("sorts levels, permits alternatives, and only completes at the last level", () => {
    const live = [person(5), person(2), person(2, "alternative", "alternative-role")];
    const state = submitCarApproval(live, "owner");
    expect(state.steps.map(step => step.level)).toEqual([2,5]);
    expect(state.steps[0]!.approvers).toHaveLength(2);
    expect(canReviewCar(state, live, "u5")).toBe(false);
    const next = reviewCarApproval(state, live, "alternative", "Alternative", "accept");
    expect(next.status).toBe("Pending approval");
    expect(next.index).toBe(1);
    expect(canReviewCar(next, live, "u2")).toBe(false);
    const closed = reviewCarApproval(next, live, "u5", "Final", "accept");
    expect(closed.status).toBe("Approved");
    expect(closed.history).toHaveLength(2);
    expect(() => reviewCarApproval(closed, live, "u5", "Final", "accept")).toThrow(/no longer pending/);
    expect(state.history).toEqual([]);
  });
  it("preserves saved levels, but checks live assignments and original user-role pairs", () => {
    const live = [person(1), person(2)];
    const state = submitCarApproval(live, "owner");
    expect(canReviewCar(state, [], "u1")).toBe(false);
    expect(canReviewCar(state, [person(9, "new-user", "r1")], "new-user")).toBe(false);
    const changed = [person(9, "u1", "r1"), person(10, "u2", "r2")];
    expect(reviewCarApproval(state, changed, "u1", "First", "accept").steps[1]!.level).toBe(2);
    expect(() => reviewCarApproval(state, [person(1)], "u1", "First", "accept")).toThrow(/Level 2 has no eligible/);
    const alternatives = submitCarApproval([person(1, "a", "one"), person(1, "b", "two")], "owner");
    expect(canReviewCar(alternatives, [person(1, "a", "two")], "a")).toBe(false);
  });
  it("requires remarks and restarts configured levels after query and rework without dropping history", () => {
    const live = [person(1),person(2)];
    for (const decision of ["query","rework","reject"]) {
      const state = submitCarApproval(live, "owner");
      expect(() => reviewCarApproval(state, live, "u1", "First", decision, " ")).toThrow(/remarks/);
      const returned = reviewCarApproval(state, live, "u1", "First", decision, "Please clarify");
      expect(returned.status).toBe("Sent back");
      const restarted = submitCarApproval([person(3)], "owner", returned);
      expect(restarted.index).toBe(0);
      expect(restarted.steps[0]!.level).toBe(3);
      expect(restarted.history[0]!.remarks).toBe("Please clarify");
      expect(restarted.cycle).toBe(2);
    }
  });
});
