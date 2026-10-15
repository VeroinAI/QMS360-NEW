import { describe, expect, it } from "vitest";
import { CreateQaqcRoleBody, UpdateQaqcRoleBody, ListQaqcRolesResponse } from "@workspace/api-zod";
import { monthlySectionPermissions, qaqcPermissionCatalog } from "@workspace/field-controls";

const role = (permissions = monthlySectionPermissions) => ({
  id: "section-contributor-role",
  name: "Monthly Report Contributor",
  description: "Maintains assigned monthly report sections",
  active: true,
  systemDefault: false,
  permissions,
});

describe("QA/QC role save contract matches the permission editor", () => {
  it.each(monthlySectionPermissions)("accepts section permission $key on create and update", permission => {
    const input = role([permission]);
    expect(CreateQaqcRoleBody.safeParse(input).success).toBe(true);
    expect(UpdateQaqcRoleBody.safeParse(input).success).toBe(true);
  });

  it("accepts every supported permission offered by the QA/QC role editor", () => {
    const input = role(qaqcPermissionCatalog);
    expect(CreateQaqcRoleBody.parse(input).permissions).toEqual(input.permissions);
    expect(UpdateQaqcRoleBody.parse(input).permissions).toEqual(input.permissions);
  });

  it("preserves section configuration and selected sections when role data is loaded again", () => {
    const saved = UpdateQaqcRoleBody.parse(role());
    const loaded = ListQaqcRolesResponse.parse({ items: [saved], total: 1, page: 1, limit: 20 });
    expect(loaded.items[0]?.permissions).toEqual(monthlySectionPermissions);
  });

  it("still rejects unknown permission names instead of accepting arbitrary strings", () => {
    const input = role([{ key: "qaqc.monthly_section_unknown.create_edit", name: "Unknown section" }]);
    expect(CreateQaqcRoleBody.safeParse(input).success).toBe(false);
    expect(UpdateQaqcRoleBody.safeParse(input).success).toBe(false);
  });
});
