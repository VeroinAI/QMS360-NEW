import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { db } from "@workspace/db";
import { assertFieldControls } from "../src/lib/field-controls";

afterEach(() => vi.restoreAllMocks());
function context(body: Record<string, unknown>) {
  return {
    currentUser: { organizationId: "fixture", platformRole: "Employee", workspaceRoles: [] }, body,
  } as unknown as Request;
}
function settings(access: "editable" | "read_only") {
  vi.spyOn(db, "select").mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => [{
      branding: { fieldControls: { audit: { schedule: {
        activityRoleAssignments: { access, requirement: "mandatory" },
      } } } },
    }] }) }),
  } as any);
}
describe("Removed Schedule assignment field settings", () => {
  it("does not require an omitted hidden field on create or update", async () => {
    settings("editable");
    await expect(assertFieldControls(context({ title: "New" }), "audit", "schedule", { mode: "create" })).resolves.toBeUndefined();
    await expect(assertFieldControls(context({ title: "Edited" }), "audit", "schedule", {
      mode: "update", current: { activityRoleAssignments: [] },
    })).resolves.toBeUndefined();
  });
  it("still enforces mandatory settings for explicitly supplied assignments", async () => {
    settings("editable");
    await expect(assertFieldControls(context({ activityRoleAssignments: [] }), "audit", "schedule", {
      mode: "create",
    })).rejects.toThrow(/activityRoleAssignments/);
  });
  it("still enforces read-only settings for explicit assignment changes", async () => {
    settings("read_only");
    await expect(assertFieldControls(context({ activityRoleAssignments: [] }),
      "audit", "schedule", { mode: "update", current: { activityRoleAssignments: [{ roleId: "role", userIds: ["old"] }] } },
    )).rejects.toThrow(/Read-only.*activityRoleAssignments/);
  });
});
