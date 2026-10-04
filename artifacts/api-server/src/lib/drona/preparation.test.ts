import { describe, expect, it, vi } from "vitest";
import { dronaId } from "./ids";
import { prepareDronaLinks, type DronaLink, type InternalLinkTarget } from "./links";
import { DRONA_USER_SNAPSHOT_SQL, readDronaUserSnapshot, type DronaReadClient } from "./source";

const organizationId = "10000000-0000-0000-0000-000000000001";
const userId = "20000000-0000-0000-0000-000000000001";
const otherId = "20000000-0000-0000-0000-000000000002";
const bigId = "9007199254740993";
const link: DronaLink = {
  environment: "dev", organizationId, kind: "user", internalId: userId,
  externalId: bigId, reviewReference: "synthetic-review",
};
const target: InternalLinkTarget = { kind: "user", id: userId, organizationId, deleted: false };
function plan(overrides: Partial<Parameters<typeof prepareDronaLinks>[0]> = {}) {
  return prepareDronaLinks({
    environment: "dev", internalTargets: [target], sourceTargets: [{ kind: "user", id: bigId }],
    existingLinks: [], reviewedLinks: [link], ...overrides,
  });
}
function client(rows: Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { query, source: { query } as DronaReadClient };
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    user_id: bigId, user_active: true, assignment_id: "11", project_map_id: "12",
    project_id: "13", role_id: "14", role_name: "Digital Admin",
    assignment_active: true, project_active: true, quality_enabled: true,
    coordinator: false, sbg_id: "1", bu_id: "2", division_id: "3",
    department_id: null, assignment_module: null, assignment_modules: [],
    mapping_modules: [], project_module: null, project_modules: ["quality"],
    ...overrides,
  };
}

describe("Drona bigint identifiers", () => {
  it("preserves identifiers beyond Number.MAX_SAFE_INTEGER", () => {
    expect(dronaId(bigId)).toBe(bigId);
    expect(dronaId("9223372036854775807")).toBe("9223372036854775807");
  });
  it.each([9007199254740993, 1, null, "", "01", " 1", "0", "-1", "1e3", "1; SELECT 1", "9223372036854775808"])(
    "rejects unsafe or noncanonical input %s", (value) => expect(() => dronaId(value)).toThrow(),
  );
});

describe("read-only Drona preparation reader", () => {
  it("uses the authoritative assignment join and a bound bigint, not an email identity", async () => {
    const c = client([row()]);
    const snapshot = await readDronaUserSnapshot(c.source, bigId);
    expect(c.query).toHaveBeenCalledWith(DRONA_USER_SNAPSHOT_SQL, [bigId]);
    expect(snapshot?.assignments[0]).toMatchObject({ roleName: "Digital Admin", projectId: "13" });
    expect(snapshot?.authorizationReady).toBe(false);
    expect(DRONA_USER_SNAPSHOT_SQL).not.toMatch(/\b(insert|update|delete|create|alter|user_email|user_sign|password|phone_number)\b/i);
  });
  it("retains inactive flags and unknown module semantics without granting access", async () => {
    const c = client([row({ user_active: false, assignment_active: null, project_active: false })]);
    expect(await readDronaUserSnapshot(c.source, bigId)).toMatchObject({
      userActive: false, authorizationReady: false,
      assignments: [{ assignmentActive: null, projectActive: false, projectMappingModules: [] }],
    });
  });
  it("returns no snapshot for an unknown user", async () => {
    expect(await readDronaUserSnapshot(client([]).source, bigId)).toBeNull();
  });
  it("retains a user with no assignments as an empty list, not unrestricted access", async () => {
    const c = client([row({ assignment_id: null })]);
    expect((await readDronaUserSnapshot(c.source, bigId))?.assignments).toEqual([]);
  });
  it("preserves multiple project slots instead of flattening away role boundaries", async () => {
    const c = client([row(), row({ assignment_id: "15", project_map_id: "16" })]);
    expect((await readDronaUserSnapshot(c.source, bigId))?.assignments).toHaveLength(2);
  });
  it("retains hierarchy sentinel values without interpreting tenant or department policy", async () => {
    const c = client([row({ sbg_id: "0", department_id: "-1" })]);
    expect((await readDronaUserSnapshot(c.source, bigId))?.assignments[0])
      .toMatchObject({ sbgId: "0", departmentId: "-1" });
  });
  it("rejects orphaned role/project references", async () => {
    await expect(readDronaUserSnapshot(client([row({ role_id: null })]).source, bigId)).rejects.toThrow("unresolved");
  });
  it("rejects duplicate assignments and a mismatched source user", async () => {
    await expect(readDronaUserSnapshot(client([row(), row()]).source, bigId)).rejects.toThrow("duplicate");
    await expect(readDronaUserSnapshot(client([row({ user_id: "2" })]).source, bigId)).rejects.toThrow("inconsistent");
  });
});

describe("reviewed environment-specific identity links", () => {
  it("preserves UUIDs and exact bigint IDs without modifying the input", () => {
    expect(plan()).toEqual({ additions: [link], unresolved: [] });
    expect(link.internalId).toBe(userId);
  });
  it("repeats the same mapping idempotently", () => {
    expect(plan({ existingLinks: [link] }).additions).toEqual([]);
  });
  it("reports unmapped existing records", () => {
    expect(plan({ reviewedLinks: [] }).unresolved).toEqual([target]);
  });
  it.each([
    { environment: "aws" }, { organizationId: "10000000-0000-0000-0000-000000000002" },
    { internalId: otherId }, { reviewReference: "" }, { externalId: "21" },
  ])("rejects an unreviewed, unavailable or cross-boundary link", (override) => {
    expect(() => plan({ reviewedLinks: [{ ...link, ...override }] })).toThrow();
  });
  it("rejects relinking either side of an existing pair", () => {
    expect(() => plan({
      sourceTargets: [{ kind: "user", id: bigId }, { kind: "user", id: "21" }],
      existingLinks: [link], reviewedLinks: [{ ...link, externalId: "21" }],
    })).toThrow("Conflicting");
    expect(() => plan({
      internalTargets: [target, { ...target, id: otherId }],
      existingLinks: [link], reviewedLinks: [{ ...link, internalId: otherId }],
    })).toThrow("Conflicting");
  });
  it("rejects deleted targets and duplicate stored links", () => {
    expect(() => plan({ internalTargets: [{ ...target, deleted: true }] })).toThrow("unavailable");
    expect(() => plan({ existingLinks: [link, link] })).toThrow("Duplicate");
  });
});