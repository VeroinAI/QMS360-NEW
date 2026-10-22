import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasQaqcRoleApprovalPermission, qaqcPermissionCatalog } from "@workspace/field-controls";
import { CreateQaqcRoleBody, UpdateQaqcRoleBody, ListQaqcRolesResponse } from "@workspace/api-zod";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@workspace/db", async original => ({
  ...await original<Record<string, unknown>>(), db: { transaction: mocks.transaction },
}));
import { workspaceRoles } from "@workspace/db";
import { qaqcRoleAuthorizationLevel, saveQaqcRole } from "./qaqc-role-permissions";

const approvalPermissions = qaqcPermissionCatalog.filter(permission =>
  permission.key === "approve_reject" || permission.key.endsWith(".approve_reject"));
const input = { id: "test-role", name: "Approver", description: "Test", active: true,
  roleAuthorizationLevel: 2, permissions: [{ key: "qaqc.monthly_reports.approve_reject", name: "Review monthly reports" }] };

describe("QA/QC role approval levels", () => {
  it.each(approvalPermissions)("requires and accepts a saved level for $key", permission => {
    expect(hasQaqcRoleApprovalPermission([permission])).toBe(true);
    expect(() => qaqcRoleAuthorizationLevel({ permissions: [permission] })).toThrow("Approval Level");
    expect(qaqcRoleAuthorizationLevel({ permissions: [permission], roleAuthorizationLevel: 3 })).toBe(3);
  });
  it.each([undefined, null, 0, -1, 1.5, 2147483648, NaN, Infinity, "2"])("rejects invalid approval level %s", level => {
    expect(() => qaqcRoleAuthorizationLevel({ ...input, roleAuthorizationLevel: level as number })).toThrow("positive whole number");
  });
  it.each([1, 2, 2147483647])("round-trips level %s through create, update and list contracts", level => {
    const created = CreateQaqcRoleBody.parse({ ...input, roleAuthorizationLevel: level });
    const updated = UpdateQaqcRoleBody.parse(created);
    const loaded = ListQaqcRolesResponse.parse({ items: [updated], total: 1, page: 1, limit: 20 });
    expect(loaded.items[0]?.roleAuthorizationLevel).toBe(level);
  });
  it("does not confuse submit, edit, view, admin or another application's grants with approval", () => {
    for (const key of ["submit", "qaqc.monthly_reports.submit", "qaqc.manage_roles", "qaqc.csat_reports.view_all", "audit.schedules.approve_reject"]) {
      expect(hasQaqcRoleApprovalPermission([{ key }])).toBe(false);
    }
    expect(qaqcRoleAuthorizationLevel({ permissions: [], roleAuthorizationLevel: 2 })).toBeNull();
  });
  it("keeps pre-existing roles without a level readable, without inventing an approval level", () => {
    expect(ListQaqcRolesResponse.parse({ items: [{ ...input, roleAuthorizationLevel: null }], total: 1, page: 1, limit: 20 }).items[0]?.roleAuthorizationLevel).toBeNull();
  });
});

describe("QA/QC role persistence", () => {
  let stored: Record<string, unknown>;
  let before: Record<string, unknown> | undefined;
  beforeEach(() => {
    mocks.transaction.mockReset();
    stored = {};
    before = undefined;
    mocks.transaction.mockImplementation(async callback => callback({
      select: () => ({ from: () => ({ where: () => ({
        for: async () => before ? [before] : [],
        limit: async () => [{ id: "permission-id" }],
      }) }) }),
      insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
        if (table === workspaceRoles) stored = { id: "new-role", ...values };
        return { returning: async () => [stored] };
      } }),
      update: (table: unknown) => ({ set: (values: Record<string, unknown>) => {
        if (table === workspaceRoles) stored = { ...before, ...values };
        return { where: () => ({ returning: async () => [stored] }) };
      } }),
    }));
  });
  it("stores approval level when creating an approving role", async () => {
    const result = await saveQaqcRole("org", input);
    expect(result.role.roleAuthorizationLevel).toBe(2);
    expect(stored.organizationId).toBe("org");
  });
  it("updates the level of a default role without altering its protected identity", async () => {
    before = { id: "system-role", organizationId: "org", name: input.name, description: input.description, status: "active", isSystem: true };
    const result = await saveQaqcRole("org", { ...input, roleAuthorizationLevel: 4 }, "system-role");
    expect(result.role.roleAuthorizationLevel).toBe(4);
    expect(result.role.name).toBe(before.name);
    expect(result.role.isSystem).toBe(true);
  });
  it("clears a stale level when all approval permissions are removed", async () => {
    before = { id: "custom-role", organizationId: "org", roleAuthorizationLevel: 3, isSystem: false };
    const result = await saveQaqcRole("org", { ...input, permissions: [] }, "custom-role");
    expect(result.role.roleAuthorizationLevel).toBeNull();
  });
  it("rejects a missing level before writing role or permission data", async () => {
    await expect(saveQaqcRole("org", { ...input, roleAuthorizationLevel: null })).rejects.toThrow("Approval Level");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
