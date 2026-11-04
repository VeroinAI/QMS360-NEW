import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select: mocks.select },
}));
import { qaqcProjectTeam } from "./qaqc-project-team";

const organizationId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  const query = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: mocks.where };
  mocks.select.mockReturnValue(query);
  mocks.where.mockResolvedValue([]);
});

describe("Daily PDF project team roles", () => {
  it("resolves all three fields, deduplicates users and comma-separates sorted names", async () => {
    mocks.where.mockResolvedValue([
      { roleName: "PM Role", userId: "2", fullName: "Zoe Manager" },
      { roleName: "PM Role", userId: "1", fullName: "Amy Manager" },
      { roleName: "PM Role", userId: "1", fullName: "Amy Manager" },
      { roleName: "Engineer Role", userId: "3", fullName: "Engineer Name" },
      { roleName: "Controller Role", userId: "4", fullName: "Controller Name" },
    ]);
    expect(await qaqcProjectTeam(organizationId, {
      projectManager: " PM Role ", projectEngineer: "Engineer Role", documentController: "Controller Role",
    })).toEqual({ pmName: "Amy Manager, Zoe Manager", peName: "Engineer Name", dcName: "Controller Name" });
  });
  it("does not use text as a person name or fall back to legacy Reporting Settings", async () => {
    expect(await qaqcProjectTeam(organizationId, { projectManager: "Legacy person", projectEngineer: "Unassigned role" }))
      .toEqual({ pmName: null, peName: null, dcName: null });
    expect(await qaqcProjectTeam(organizationId, {})).toEqual({ pmName: null, peName: null, dcName: null });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
  it("reuses the same role independently in multiple fields", async () => {
    mocks.where.mockResolvedValue([{ roleName: "shared role", userId: "1", fullName: "Assigned Person" }]);
    expect(await qaqcProjectTeam(organizationId, { projectManager: "Shared Role", documentController: "Shared Role" }))
      .toEqual({ pmName: "Assigned Person", peName: null, dcName: "Assigned Person" });
  });
  it("queries active, undeleted QA/QC roles, assignments and users in this organization only", async () => {
    await qaqcProjectTeam(organizationId, { projectManager: "QAQC Manager" });
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    for (const table of ["user_workspace_roles", "workspace_roles", "users"]) {
      expect(query.sql).toContain(`"${table}"."organization_id"`);
      expect(query.sql).toContain(`"${table}"."status"`);
      expect(query.sql).toContain(`"${table}"."deleted_at" is null`);
    }
    expect(query.sql).toContain('"app1_qaqc"."workspace_roles"');
    expect(query.params.filter(value => value === organizationId)).toHaveLength(3);
    expect(query.params).toContain("qaqc manager");
  });
});
