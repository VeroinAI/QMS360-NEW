import { describe, expect, it } from "vitest";
import { normalizeActivityAssignments } from "./audit-activity-assignments";
import { planActivityFieldValues } from "@workspace/field-controls";
describe("Schedule-local activity assignments", () => {
  const roles = new Set(["role"]);
  const users = new Set(["one", "two"]);
  it("stores one or multiple users and deduplicates references", () => {
    expect(normalizeActivityAssignments([{ roleId: "role", userIds: ["one", "two", "one"] }], roles, users))
      .toEqual([{ roleId: "role", userIds: ["one", "two"] }]);
    expect(normalizeActivityAssignments([], roles, users)).toEqual([]);
  });
  it("rejects foreign/inactive/deleted roles or users and duplicate role mappings", () => {
    for (const value of [
      [{ roleId: "foreign", userIds: ["one"] }], [{ roleId: "role", userIds: ["foreign"] }],
      [{ roleId: "role", userIds: [] }], [{ roleId: "role", userIds: ["one"] }, { roleId: "role", userIds: ["two"] }],
    ]) expect(() => normalizeActivityAssignments(value, roles, users)).toThrow();
  });
  it("enforces field locks over every selected auditee and role, not just the legacy first user", () => {
    const rows = [{ id: "row", auditeeId: "one", auditeeIds: ["one", "two"], roleIds: ["role"] }];
    const before = planActivityFieldValues({ activities: rows });
    expect(planActivityFieldValues({ activities: [{ ...rows[0], auditeeIds: ["one"] }] }).activityAuditeeId)
      .not.toEqual(before.activityAuditeeId);
    expect(planActivityFieldValues({ activities: [{ ...rows[0], roleIds: [] }] }).activityRoleIds)
      .not.toEqual(before.activityRoleIds);
  });
});