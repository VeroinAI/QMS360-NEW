import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute, transaction, provision, audit } = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), provision: vi.fn(), audit: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute, transaction } }));
vi.mock("./provisioning", async original => ({
  ...await original<typeof import("./provisioning")>(), provisionDronaIdentity: provision,
}));
vi.mock("../workspace", () => ({ writeAuditLog: audit }));
import { addDronaAdminUser, lookupDronaAdminUser } from "./admin-users";

const org = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const input = { email: " PERSON@EXAMPLE.TEST ", externalUserId: "41", organizationId: org, actorId: userId };
const source = { external_id: "41", user_name: "Example User", user_email: "person@example.test", is_active: true };
const dialect = new PgDialect();
const queries: Array<{ sql: string; params: unknown[] }> = [];
let rows: Array<unknown[]> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_STRATEGY", "drona");
  vi.stubEnv("DRONA_MAPPING_REVIEWED", "true");
  vi.stubEnv("DRONA_ENVIRONMENT", "qa");
  vi.stubEnv("DRONA_ORGANIZATION_ID", org);
  vi.stubEnv("DRONA_QMS_MODULE_VALUE", "QMS360");
  queries.length = 0;
  rows = [[source], [{ user_role_map_id: "1" }], []];
  execute.mockImplementation(async statement => {
    queries.push(dialect.sqlToQuery(statement));
    return { rows: rows.shift() ?? [] };
  });
  transaction.mockImplementation(async callback => callback({ execute }));
  provision.mockResolvedValue({ id: userId, organizationId: org, externalUserId: "41" });
  audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("administrator Drona user discovery", () => {
  it("searches exact normalized email without creating anything or granting access", async () => {
    expect(await lookupDronaAdminUser(input.email, org)).toEqual({
      email: "person@example.test", fullName: "Example User", externalUserId: "41", alreadyPresent: false,
    });
    expect(queries[0]!.params).toContain("person@example.test");
    expect(queries[0]!.sql).not.toContain("PERSON@");
    expect(queries[1]!.sql).toContain("a.is_active = true AND p.is_active = true");
    expect(queries[1]!.sql).toContain("a.modules");
    expect(queries[1]!.params).toContain("QMS360");
    expect(provision).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("identifies an existing internal user for reuse", async () => {
    rows[2] = [{ id: userId }];
    expect((await lookupDronaAdminUser(input.email, org)).alreadyPresent).toBe(true);
  });

  it.each([
    ["AUTH_STRATEGY", "local", 503],
    ["DRONA_MAPPING_REVIEWED", "false", 503],
    ["DRONA_QMS_MODULE_VALUE", "", 503],
    ["DRONA_ORGANIZATION_ID", "33333333-3333-4333-8333-333333333333", 403],
  ])("fails closed with %s=%s", async (name, value, status) => {
    vi.stubEnv(String(name), String(value));
    await expect(lookupDronaAdminUser(input.email, org)).rejects.toMatchObject({ status });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [[], 404],
    [[source, { ...source, external_id: "42" }], 409],
    [[{ ...source, is_active: false }], 403],
    [[{ ...source, user_name: "" }], 409],
  ])("rejects missing, ambiguous, inactive or incomplete source users", async (sourceRows, status) => {
    rows[0] = sourceRows as unknown[];
    await expect(lookupDronaAdminUser(input.email, org)).rejects.toMatchObject({ status });
    expect(provision).not.toHaveBeenCalled();
  });

  it("rejects an active Drona user without a QMS-specific active assignment", async () => {
    rows[1] = [];
    await expect(lookupDronaAdminUser(input.email, org)).rejects.toMatchObject({ status: 403 });
    expect(provision).not.toHaveBeenCalled();
  });

  it("rejects malformed email before source SQL", async () => {
    await expect(lookupDronaAdminUser("not-email", org)).rejects.toMatchObject({ status: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechecks eligibility, links with the administrator actor and never assigns roles/approvals", async () => {
    expect(await addDronaAdminUser(input)).toEqual({
      userId, email: "person@example.test", fullName: "Example User", alreadyPresent: false,
    });
    expect(queries[0]!.sql).toContain("FOR SHARE");
    expect(queries[1]!.sql).not.toContain("FOR SHARE");
    expect(provision).toHaveBeenCalledWith({ execute }, "person@example.test",
      expect.objectContaining({ organizationId: org, environment: "qa" }),
      { actorId: userId, reference: "admin:email-search" });
    expect(audit).toHaveBeenCalledTimes(3);
    for (const call of audit.mock.calls) expect(call[3]).toEqual({ dispatch: false });
    expect(queries.every(query => !/INSERT|UPDATE|DELETE/i.test(query.sql))).toBe(true);
  });

  it("does not import a user whose source eligibility was revoked after search", async () => {
    rows[1] = [];
    await expect(addDronaAdminUser(input)).rejects.toMatchObject({ status: 403 });
    expect(provision).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects a changed source identity", async () => {
    await expect(addDronaAdminUser({ ...input, externalUserId: "42" })).rejects.toMatchObject({ status: 409 });
    expect(provision).not.toHaveBeenCalled();
  });

  it("does not coerce bigint IDs through JavaScript numbers", async () => {
    rows[0] = [{ ...source, external_id: "9007199254740993" }];
    await addDronaAdminUser({ ...input, externalUserId: "9007199254740993" });
    expect(queries[1]!.params).toContain("9007199254740993");
    await expect(addDronaAdminUser({ ...input, externalUserId: "9223372036854775808" })).rejects.toMatchObject({ status: 422 });
  });

  it("propagates linker conflicts without audit logs or bypassing a revoked link", async () => {
    provision.mockRejectedValueOnce(Object.assign(new Error("Removed link"), { status: 403 }));
    await expect(addDronaAdminUser(input)).rejects.toMatchObject({ status: 403 });
    expect(audit).not.toHaveBeenCalled();
  });
});
