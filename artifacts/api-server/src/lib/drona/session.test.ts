import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute, provisionDronaEmail, ensureDronaProjects } = vi.hoisted(() => ({
  execute: vi.fn(), provisionDronaEmail: vi.fn(), ensureDronaProjects: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute } }));
vi.mock("./provisioning", () => ({ provisionDronaEmail, ensureDronaProjects }));
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
  it("delegates login to atomic automatic setup, retaining the stable identity", async () => {
    provisionDronaEmail.mockResolvedValueOnce(identity);
    expect(await resolveDronaEmail(" Synthetic@Example.test ")).toEqual(identity);
    expect(provisionDronaEmail).toHaveBeenCalledWith(" Synthetic@Example.test ");
    expect(execute).not.toHaveBeenCalled();
  });
  it("propagates automatic setup conflicts without falling back to another identity", async () => {
    provisionDronaEmail.mockRejectedValueOnce({ status: 409 });
    await expect(resolveDronaEmail("synthetic@example.test")).rejects.toMatchObject({ status: 409 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rechecks source activity and returns only mapped active projects without interpreting Drona roles or enable_quality", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: identity.id }] });
    execute.mockResolvedValueOnce({ rows: [{ id: "mapped-project" }] });
    expect(await dronaSessionProjects(identity)).toEqual(["mapped-project"]);
    expect(ensureDronaProjects).toHaveBeenCalledWith(identity);
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
    expect(ensureDronaProjects).not.toHaveBeenCalled();
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
