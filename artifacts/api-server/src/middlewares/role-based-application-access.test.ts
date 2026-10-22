import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { userWorkspaceRoles, lessonsUserWorkspaceRoles, auditUserWorkspaceRoles } from "@workspace/db";
const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>, filters: [] as unknown[], select: vi.fn(),
}));
vi.mock("@workspace/db", async original => ({
  ...await original<Record<string, unknown>>(), db: { select: state.select },
}));
import { getRoleBasedApplicationAccess, requireAppAccess, getEffectiveProjectScope } from "./rbac";

const user = { id: "test-user", organizationId: "test-org", username: "test-user", platformRole: "Employee" };
beforeEach(() => {
  state.rows = {}; state.filters = [];
  state.select.mockReset().mockImplementation(() => ({
    from: (table: any) => {
      const query = {
        innerJoin: () => query,
        where: (condition: unknown) => {
          state.filters.push(condition);
          return Promise.resolve(state.rows[`${table[Symbol.for("drizzle:Schema")] ?? "public"}.${getTableName(table)}`] ?? []);
        },
      };
      return query;
    },
  }));
});
function assign(app: string, projectIds: string[] = []) {
  // Each application stores its own assignment table in its own PostgreSQL schema.
  const table = { qaqc: userWorkspaceRoles, lessons: lessonsUserWorkspaceRoles, audit: auditUserWorkspaceRoles }[app]!;
  state.rows[`${(table as any)[Symbol.for("drizzle:Schema")] ?? "public"}.${getTableName(table)}`] = [{ projectIds, businessUnitIds: [], roleName: "Contributor", roleStatus: "active" }];
}
async function enter(app: "qaqc" | "lessons" | "audit", currentUser: any = user) {
  const next = vi.fn(), json = vi.fn(), status = vi.fn().mockReturnValue({ json });
  const req = { currentUser };
  await requireAppAccess(app)(req as any, { status } as any, next);
  return { next, status, json };
}
describe("role-based application entry", () => {
  it.each(["qaqc", "lessons", "audit"] as const)("opens %s immediately with an active role and no application-access record", async app => {
    assign(app, ["project-a"]);
    expect((await enter(app)).next).toHaveBeenCalledOnce();
    expect(state.select).toHaveBeenCalledTimes(1);
    const access = await getRoleBasedApplicationAccess(user);
    expect(access[app]).toBe(true);
    expect(Object.entries(access).filter(([key]) => key !== app).every(([, value]) => !value)).toBe(true);
  });
  it("opens all assigned applications without approval or writes to shared flags", async () => {
    assign("qaqc"); assign("lessons"); assign("audit");
    expect(await getRoleBasedApplicationAccess(user)).toEqual({ qaqc: true, lessons: true, audit: true });
  });
  it.each(["qaqc", "lessons", "audit"] as const)("locks %s again when its last active role is removed", async app => {
    assign(app);
    expect((await enter(app)).next).toHaveBeenCalledOnce();
    state.rows = {};
    const blocked = await enter(app);
    expect(blocked.status).toHaveBeenCalledWith(403);
    expect(blocked.next).not.toHaveBeenCalled();
  });
  it("preserves scoped projects and does not promote a project role to organization access", async () => {
    assign("qaqc", ["project-a"]);
    expect(await getEffectiveProjectScope(user.id, user.organizationId, "qaqc")).toEqual({ unrestricted: false, projectIds: ["project-a"] });
  });
  it("does not use role names or legacy approvals to open unassigned applications", async () => {
    expect(await getRoleBasedApplicationAccess({ ...user, platformRole: "Quality Manager" })).toEqual({ qaqc: false, lessons: false, audit: false });
    expect((await enter("audit")).status).toHaveBeenCalledWith(403);
  });
  it("requires an authenticated user", async () => {
    const blocked = await enter("lessons", null);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.status).toHaveBeenCalledWith(401);
  });
  it("preserves platform administrator access without role queries", async () => {
    expect(await getRoleBasedApplicationAccess({ ...user, platformRole: "Super Admin" })).toEqual({ qaqc: true, lessons: true, audit: true });
    expect(state.select).not.toHaveBeenCalled();
  });
  it("filters inactive/deleted assignments and roles within the same organization in SQL", async () => {
    await getEffectiveProjectScope(user.id, user.organizationId, "audit");
    const query = new PgDialect().sqlToQuery(state.filters[0] as any);
    expect(query.sql).toContain('"user_workspace_roles"."status" =');
    expect(query.sql).toContain('"workspace_roles"."status" =');
    expect(query.sql.match(/"deleted_at" is null/g)).toHaveLength(2);
    expect(query.sql.match(/"organization_id" =/g)).toHaveLength(2);
    expect(query.params.filter(value => value === "active")).toHaveLength(2);
    expect(query.sql).not.toContain("application_access");
  });
});
