import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute } }));
import { dronaSessionProjects, resolveDronaEmail, restrictDronaProjects } from "./session";
const identity = {
  id: "20000000-0000-0000-0000-000000000001",
  organizationId: "10000000-0000-0000-0000-000000000001",
  externalUserId: "9007199254740993",
};
describe("Drona identity and live membership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DRONA_ENVIRONMENT", "aws");
    vi.stubEnv("DRONA_ORGANIZATION_ID", identity.organizationId);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("matches normalized email, retaining the source bigint and stable reviewed UUID", async () => {
    execute.mockResolvedValueOnce({ rows: [{ external_id: identity.externalUserId, active: true }] });
    execute.mockResolvedValueOnce({ rows: [{ id: identity.id, organizationId: identity.organizationId }] });
    expect(await resolveDronaEmail(" Synthetic@Example.test ")).toEqual(identity);
    const queries = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query));
    expect(queries[0]!.params).toContain("synthetic@example.test");
    expect(queries[1]!.params).toContain(identity.externalUserId);
    expect(queries[1]!.params).toContain("aws");
    expect(queries[1]!.sql).toContain('u.access_status = \'active\'');
  });
  it.each([
    { rows: [] }, { rows: [{ external_id: "1", active: false }] },
    { rows: [{ external_id: "1", active: true }, { external_id: "2", active: true }] },
  ])("rejects missing, inactive or ambiguous source identities", async ({ rows }) => {
    execute.mockResolvedValueOnce({ rows });
    await expect(resolveDronaEmail("synthetic@example.test")).rejects.toMatchObject({ status: 401 });
    expect(execute).toHaveBeenCalledOnce();
  });
  it("rejects missing reviewed internal mappings", async () => {
    execute.mockResolvedValueOnce({ rows: [{ external_id: "1", active: true }] });
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(resolveDronaEmail("synthetic@example.test")).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks source activity and returns only mapped active projects without interpreting Drona roles or enable_quality", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: identity.id }] });
    execute.mockResolvedValueOnce({ rows: [{ id: "mapped-project" }] });
    expect(await dronaSessionProjects(identity)).toEqual(["mapped-project"]);
    const queries = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query).sql);
    expect(queries[0]).toContain("s.is_active = true");
    expect(queries[1]).toContain("a.is_active = true");
    expect(queries[1]).toContain("p.is_active = true");
    expect(queries[1]).toContain("shared.drona_project_links");
    expect(queries[1]).not.toContain("enable_quality");
    expect(queries[1]).not.toContain("user_role_master");
  });
  it("revokes a session when its identity link or source account no longer exists", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(dronaSessionProjects(identity)).rejects.toMatchObject({ status: 401 });
    expect(execute).toHaveBeenCalledOnce();
  });
  it("caps global/admin QMS scope at Drona membership while preserving capability-specific scope", () => {
    expect(restrictDronaProjects(["a"], { unrestricted: true, projectIds: [] }))
      .toEqual({ unrestricted: false, projectIds: ["a"] });
    expect(restrictDronaProjects(["a", "b"], { unrestricted: false, projectIds: ["b", "c"] }))
      .toEqual({ unrestricted: false, projectIds: ["b"] });
    expect(restrictDronaProjects([], { unrestricted: true, projectIds: [] }))
      .toEqual({ unrestricted: false, projectIds: [] });
    expect(restrictDronaProjects(undefined, { unrestricted: true, projectIds: [] }))
      .toEqual({ unrestricted: true, projectIds: [] });
  });
  it("preserves explicitly authorized department-only Process Audits without granting any project", () => {
    expect(restrictDronaProjects([], { unrestricted: true, projectIds: [] }, true))
      .toEqual({ unrestricted: false, projectIds: [], processAuditsAllowed: true });
    expect(restrictDronaProjects([], { unrestricted: false, projectIds: [] }, true))
      .toEqual({ unrestricted: false, projectIds: [], processAuditsAllowed: false });
    expect(restrictDronaProjects([], { unrestricted: false, projectIds: [], processAuditsAllowed: true }, true))
      .toEqual({ unrestricted: false, projectIds: [], processAuditsAllowed: true });
  });
});
