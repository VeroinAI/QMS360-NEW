import { describe, expect, it, vi } from "vitest";
import { normalizeActivityAssignments, resolveActivityAssignments } from "./audit-activity-assignments";
import { planActivityFieldValues } from "@workspace/field-controls";
describe("Schedule-local activity assignments", () => {
  const roles = new Set(["role"]);
  const users = new Set(["one", "two"]);
  it("creates without defaults or eligibility lookups when assignments are omitted", async () => {
    const validate = vi.fn();
    expect(await resolveActivityAssignments(undefined, undefined, validate)).toEqual([]);
    expect(validate).not.toHaveBeenCalled();
  });
  it("preserves historical assignments on unrelated edits without revalidating unavailable users", async () => {
    const current = [{ roleId: "inactive-role", userIds: ["historical-user"] }];
    const validate = vi.fn();
    expect(await resolveActivityAssignments(undefined, current, validate)).toBe(current);
    expect(validate).not.toHaveBeenCalled();
  });
  it("validates explicit changes and permits an explicit clear", async () => {
    const current = [{ roleId: "role", userIds: ["one"] }];
    const validate = vi.fn(async (rows) => normalizeActivityAssignments(rows, roles, users));
    expect(await resolveActivityAssignments([], current, validate)).toEqual([]);
    expect(validate).toHaveBeenCalledWith([]);
    await expect(resolveActivityAssignments([{ roleId: "role", userIds: ["foreign"] }], current, validate)).rejects.toThrow();
    expect(current).toEqual([{ roleId: "role", userIds: ["one"] }]);
  });
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