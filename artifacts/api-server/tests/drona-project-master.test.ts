import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import express from "express";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: undefined as undefined | ((sql: SQL) => Promise<unknown>),
  organizationId: "", allowed: undefined as string[] | undefined,
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  return { ...actual, db: { execute: (sql: SQL) => state.execute!(sql) } };
});
vi.mock("../src/middlewares/auth", async original => {
  const actual = await original<typeof import("../src/middlewares/auth")>();
  return { ...actual, requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers["x-test-role"];
    if (!role) { res.status(401).json({ error: "Authentication required" }); return; }
    req.currentUser = {
      id: "20000000-0000-0000-0000-000000000001", organizationId: state.organizationId,
      platformRole: String(role), username: "synthetic", fullName: "Synthetic administrator",
      email: "synthetic@example.test", organizationName: "Synthetic", workspaceRoles: [],
    };
    req.dronaProjectIds = state.allowed;
    next();
  } };
});
import { pool } from "@workspace/db";
import router from "../src/routes/project-master";

const schema = `project_master_${randomUUID().replaceAll("-", "")}`;
const org = randomUUID(), otherOrg = randomUUID();
const drona = randomUUID(), legacy = randomUUID(), ordinary = randomUUID();
let client: PoolClient;
let server: Server;
let base: string;
const statements: string[] = [];
const rewrite = (text: string) => text.replace(/\bshared\./g, `"${schema}".`);
const query = (text: string, params: unknown[] = []) => client.query(rewrite(text), params);
const dialect = new PgDialect();
async function get(search = "", role = "Org Admin") {
  const response = await fetch(`${base}/api/integrations/project-master${search}`, {
    headers: role ? { "x-test-role": role } : {},
  });
  return { status: response.status, body: await response.json() as {
    items: Array<{ id: string; name: string; code: string; costCentre: string | null; externalId: string | null; dronaLinks: Array<{ externalProjectId: string; environment: string }>; createdAt: string }>;
    total: number; page: number; limit: number; linkMetadataAvailable: boolean;
  } };
}
beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ["projects", "business_units"]) {
    await client.query(`CREATE TABLE "${schema}".${table} (LIKE shared.${table} INCLUDING ALL)`);
  }
  await query(`CREATE TABLE shared.drona_project_links (
    environment_key text, organization_id uuid, external_project_id bigint, project_id uuid,
    reviewed_at timestamptz NOT NULL DEFAULT now())`);
  state.execute = async input => {
    const sql = dialect.sqlToQuery(input);
    statements.push(sql.sql);
    return query(sql.sql, sql.params);
  };
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  server = await new Promise<Server>(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await client.query("SAVEPOINT scenario");
  state.organizationId = org;
  state.allowed = undefined;
  vi.stubEnv("AUTH_STRATEGY", "local");
  await query(`INSERT INTO shared.projects(id,organization_id,code,name,source,external_id) VALUES
    ($1,$4,'D-001','Drona transferred project','drona','9007199254740993'),
    ($2,$4,'L-002','Existing linked project','local',NULL),
    ($3,$4,'LOCAL','Ordinary local project','local',NULL)`, [drona, legacy, ordinary, org]);
  await query(`INSERT INTO shared.projects(organization_id,code,name,source,external_id)
    VALUES ($1,'FOREIGN','Other organization project','drona','99')`, [otherOrg]);
  await query(`INSERT INTO shared.drona_project_links(environment_key,organization_id,external_project_id,project_id)
    VALUES ('aws',$1,9007199254740993,$2),('aws',$1,72,$3),('qa',$1,73,$3)`, [org, drona, legacy]);
  statements.length = 0;
});
afterEach(async () => {
  await client.query("ROLLBACK TO SAVEPOINT scenario; RELEASE SAVEPOINT scenario");
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (client) { await client.query("ROLLBACK"); client.release(); }
});

describe("read-only Project Master using existing QMS records", () => {
  it("includes new Drona records and legacy linked records, but not unrelated or foreign projects", async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.items.map(row => row.id)).toEqual([drona, legacy]);
    expect(result.body.total).toBe(2);
    expect(result.body.linkMetadataAvailable).toBe(true);
    expect(result.body.items[0]!.dronaLinks[0]!.externalProjectId).toBe("9007199254740993");
    expect(result.body.items[1]!.dronaLinks).toHaveLength(2);
    expect(new Date(result.body.items[0]!.createdAt).toISOString()).toBe(result.body.items[0]!.createdAt);
    expect(statements.every(sql => /^\s*SELECT\b/.test(sql))).toBe(true);
  });
  it("keeps administrator reads within active Drona project boundaries and environment", async () => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    vi.stubEnv("DRONA_ENVIRONMENT", "aws");
    state.allowed = [legacy];
    const result = await get();
    expect(result.body.items.map(row => row.id)).toEqual([legacy]);
    expect(result.body.items[0]!.dronaLinks.map(link => link.environment)).toEqual(["aws"]);
    state.allowed = [];
    expect((await get()).body.total).toBe(0);
  });
  it.each([["?search=EXISTING", legacy], ["?search=9007199254740993", drona], ["?search=72", legacy]])(
    "searches recorded names and exact bigint IDs safely (%s)", async (search, expected) => {
      expect((await get(search)).body.items.map(row => row.id)).toEqual([expected]);
    },
  );
  it("paginates deterministically and returns an empty result for unmatched/injection-like searches", async () => {
    const result = await get("?page=2&limit=1");
    expect(result.body.items.map(row => row.id)).toEqual([legacy]);
    expect(result.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect((await get("?search=" + encodeURIComponent("' OR 1=1 --"))).body.total).toBe(0);
  });
  it("shows recorded data with an explicit metadata-unavailable flag without creating a missing table", async () => {
    await query("DROP TABLE shared.drona_project_links");
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.items.map(row => row.id)).toEqual([drona]);
    expect(result.body.linkMetadataAvailable).toBe(false);
    expect(result.body.items[0]!.dronaLinks).toEqual([]);
    expect((await query("SELECT to_regclass('shared.drona_project_links') AS table_name")).rows[0].table_name).toBeNull();
  });
  it("does not expose deleted records", async () => {
    await query("UPDATE shared.projects SET deleted_at=now() WHERE id=$1", [drona]);
    expect((await get()).body.items.map(row => row.id)).toEqual([legacy]);
  });
  it("rejects non-administrators and anonymous requests before reading any records", async () => {
    expect((await get("", "Employee")).status).toBe(403);
    expect((await get("", "")).status).toBe(401);
    expect(statements).toEqual([]);
  });
  it("rejects oversized search input and exposes no project-creation endpoint", async () => {
    expect((await get("?search=" + "x".repeat(121))).status).toBe(400);
    const response = await fetch(`${base}/api/integrations/project-master`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(statements).toEqual([]);
  });
});

async function patch(projectId: string, body: unknown, role = "Org Admin") {
  const response = await fetch(`${base}/api/integrations/project-master/${projectId}/cost-centre`, {
    method: "PATCH", headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as { id: string; costCentre: string | null; updatedAt: string } };
}

describe("administrator-only QMS project cost centers", () => {
  it.each(["Org Admin", "Super Admin"])("allows %s to set/edit a cost center and retains every unrelated project/link value", async role => {
    await query(`UPDATE shared.projects SET custom_fields=$2 WHERE id=$1`, [drona, { unrelated: "retain", another: { nested: true }, cost_centre: "old" }]);
    const before = (await query("SELECT * FROM shared.projects WHERE id=$1", [drona])).rows[0];
    const result = await patch(drona, { costCentre: "  00042-CC  " }, role);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: drona, costCentre: "00042-CC" });
    expect(new Date(result.body.updatedAt).toISOString()).toBe(result.body.updatedAt);
    const after = (await query("SELECT * FROM shared.projects WHERE id=$1", [drona])).rows[0];
    expect(after.custom_fields).toEqual({ unrelated: "retain", another: { nested: true }, costCentre: "00042-CC" });
    const { custom_fields: _beforeFields, updated_at: _beforeTime, ...beforeMaster } = before;
    const { custom_fields: _afterFields, updated_at: _afterTime, ...afterMaster } = after;
    expect(afterMaster).toEqual(beforeMaster);
    expect((await get()).body.items.find(item => item.id === drona)?.costCentre).toBe("00042-CC");
    expect((await patch(drona, { costCentre: "NEW-CC" }, role)).body.costCentre).toBe("NEW-CC");
    expect((await query("SELECT count(*)::int AS count FROM shared.drona_project_links")).rows[0].count).toBe(3);
    expect(statements.filter(text => /^\s*UPDATE\b/.test(text)).every(text => /UPDATE shared\.projects/.test(text))).toBe(true);
  });
  it("reads legacy cost_centre and clears it without dropping unrelated extra fields", async () => {
    await query(`UPDATE shared.projects SET custom_fields=$2 WHERE id=$1`, [legacy, { cost_centre: "OLD", retained: 7 }]);
    expect((await get()).body.items.find(item => item.id === legacy)?.costCentre).toBe("OLD");
    expect((await patch(legacy, { costCentre: null })).body.costCentre).toBeNull();
    expect((await get()).body.items.find(item => item.id === legacy)?.costCentre).toBeNull();
    expect((await query("SELECT custom_fields FROM shared.projects WHERE id=$1", [legacy])).rows[0].custom_fields).toEqual({ retained: 7, costCentre: null });
    expect((await patch(legacy, { costCentre: "   " })).body.costCentre).toBeNull();
  });
  it("supports existing Drona records without installing link metadata", async () => {
    await query("DROP TABLE shared.drona_project_links");
    expect((await patch(drona, { costCentre: "CC-1" })).status).toBe(200);
    expect((await patch(legacy, { costCentre: "CC-2" })).status).toBe(404);
    expect((await query("SELECT to_regclass('shared.drona_project_links') AS table_name")).rows[0].table_name).toBeNull();
  });
  it("denies employees and anonymous callers before issuing any SQL", async () => {
    expect((await patch(drona, { costCentre: "CC" }, "Employee")).status).toBe(403);
    expect((await patch(drona, { costCentre: "CC" }, "")).status).toBe(401);
    expect(statements).toEqual([]);
  });
  it("denies foreign, deleted, unrelated local and missing projects", async () => {
    const foreign = (await query("SELECT id FROM shared.projects WHERE organization_id=$1", [otherOrg])).rows[0].id;
    for (const id of [foreign, ordinary, randomUUID()]) {
      expect((await patch(id, { costCentre: "FORBIDDEN" })).status).toBe(404);
    }
    await query("UPDATE shared.projects SET deleted_at=now() WHERE id=$1", [drona]);
    expect((await patch(drona, { costCentre: "FORBIDDEN" })).status).toBe(404);
    expect((await query("SELECT count(*)::int AS count FROM shared.projects WHERE custom_fields ? 'costCentre'")).rows[0].count).toBe(0);
  });
  it("keeps administrator writes inside active Drona project boundaries", async () => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    vi.stubEnv("DRONA_ENVIRONMENT", "aws");
    state.allowed = [legacy];
    expect((await patch(drona, { costCentre: "FORBIDDEN" })).status).toBe(404);
    expect((await patch(legacy, { costCentre: "CC" })).status).toBe(200);
    state.allowed = [];
    expect((await patch(legacy, { costCentre: "FORBIDDEN" })).status).toBe(404);
    expect((await query("SELECT custom_fields->>'costCentre' AS cc FROM shared.projects WHERE id=$1", [legacy])).rows[0].cc).toBe("CC");
  });
  it.each([{}, { costCentre: 42 }, { costCentre: "x".repeat(101) }, { costCentre: "CC\n42" }, { costCentre: "CC", name: "Do not edit" }])(
    "rejects invalid or extra input before issuing SQL (%j)", async body => {
      expect((await patch(drona, body)).status).toBe(400);
      expect(statements).toEqual([]);
    });
  it("rejects invalid identifiers and binds injection-like cost center text as data", async () => {
    expect((await patch("invalid-uuid", { costCentre: "CC" })).status).toBe(400);
    expect(statements).toEqual([]);
    const injection = "CC'); DELETE FROM shared.projects; --";
    expect((await patch(drona, { costCentre: injection })).body.costCentre).toBe(injection);
    expect((await get()).body.total).toBe(2);
  });
});

const additionalValues = {
  client: "Client A", contractor: "Contractor B", contractProjectNumber: "CT-001",
  contractSigned: "2026-10-13", contractPeriod: "24 months", tcc: "TCC-1", pac: "PAC-1", fac: "FAC-1",
};
async function patchAdditional(projectId: string, body: unknown, role = "Org Admin") {
  const response = await fetch(`${base}/api/integrations/project-master/${projectId}/additional-data`, {
    method: "PATCH", headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
describe("QMS project additional data", () => {
  it.each(["Org Admin", "Super Admin"])("persists all fields for %s without modifying source-owned master values", async role => {
    await query("UPDATE shared.projects SET custom_fields=$2 WHERE id=$1", [drona, {
      unrelated: { retained: true }, cost_centre: "OLD",
      qmsAdditionalData: { futureField: "retain" },
    }]);
    const before = (await query("SELECT * FROM shared.projects WHERE id=$1", [drona])).rows[0];
    const result = await patchAdditional(drona, {
      costCentre: " CC-001 ", additionalData: { ...additionalValues, client: " Client A " },
    }, role);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: drona, costCentre: "CC-001", additionalData: additionalValues });
    const after = (await query("SELECT * FROM shared.projects WHERE id=$1", [drona])).rows[0];
    expect(after.custom_fields).toEqual({
      unrelated: { retained: true }, costCentre: "CC-001",
      qmsAdditionalData: { futureField: "retain", ...additionalValues },
    });
    const { custom_fields: _b, updated_at: _bt, ...beforeMaster } = before;
    const { custom_fields: _a, updated_at: _at, ...afterMaster } = after;
    expect(afterMaster).toEqual(beforeMaster);
    expect((await get()).body.items.find(item => item.id === drona)).toMatchObject(result.body);
  });
  it("supports local projects and clears optional values without deleting unrelated fields", async () => {
    expect((await patchAdditional(ordinary, { costCentre: "LOCAL-CC", additionalData: additionalValues })).status).toBe(200);
    const empty = Object.fromEntries(Object.keys(additionalValues).map(key => [key, null]));
    expect((await patchAdditional(ordinary, { costCentre: null, additionalData: empty })).body).toMatchObject({ costCentre: null, additionalData: empty });
    expect((await get()).body.items.find(item => item.id === ordinary)).toMatchObject({ costCentre: null, additionalData: empty });
  });
  it("defaults unsaved fields to null and preserves an existing legacy cost center", async () => {
    await query("UPDATE shared.projects SET custom_fields=$2 WHERE id=$1", [legacy, { cost_centre: "LEGACY-CC" }]);
    const record = (await get()).body.items.find(item => item.id === legacy) as any;
    expect(record.costCentre).toBe("LEGACY-CC");
    expect(Object.values(record.additionalData)).toEqual(Array(8).fill(null));
    expect((await patchAdditional(legacy, { costCentre: record.costCentre, additionalData: additionalValues })).body.costCentre).toBe("LEGACY-CC");
  });
  it("does not require Drona link metadata", async () => {
    await query("DROP TABLE shared.drona_project_links");
    expect((await patchAdditional(ordinary, { costCentre: null, additionalData: additionalValues })).status).toBe(200);
    expect((await get()).body.items.find(item => item.id === ordinary)).toMatchObject({ additionalData: additionalValues });
  });
  it("handles an explicitly null additional-data container", async () => {
    await query("UPDATE shared.projects SET custom_fields=$2 WHERE id=$1", [ordinary, { qmsAdditionalData: null, retained: true }]);
    expect((await patchAdditional(ordinary, { costCentre: null, additionalData: additionalValues })).body.additionalData).toEqual(additionalValues);
    expect((await query("SELECT custom_fields FROM shared.projects WHERE id=$1", [ordinary])).rows[0].custom_fields).toEqual({
      retained: true, costCentre: null, qmsAdditionalData: additionalValues,
    });
  });
  it("denies unauthorized roles before issuing SQL", async () => {
    expect((await patchAdditional(drona, { costCentre: null, additionalData: additionalValues }, "Employee")).status).toBe(403);
    expect((await patchAdditional(drona, { costCentre: null, additionalData: additionalValues }, "")).status).toBe(401);
    expect(statements).toEqual([]);
  });
  it("denies foreign, deleted, missing and out-of-scope projects", async () => {
    const foreign = (await query("SELECT id FROM shared.projects WHERE organization_id=$1", [otherOrg])).rows[0].id;
    for (const id of [foreign, randomUUID()]) expect((await patchAdditional(id, { costCentre: null, additionalData: additionalValues })).status).toBe(404);
    await query("UPDATE shared.projects SET deleted_at=now() WHERE id=$1", [drona]);
    expect((await patchAdditional(drona, { costCentre: null, additionalData: additionalValues })).status).toBe(404);
    state.allowed = [legacy];
    expect((await patchAdditional(ordinary, { costCentre: null, additionalData: additionalValues })).status).toBe(404);
    expect((await patchAdditional(legacy, { costCentre: null, additionalData: additionalValues })).status).toBe(200);
    state.allowed = [];
    expect((await patchAdditional(legacy, { costCentre: null, additionalData: additionalValues })).status).toBe(404);
  });
  it.each([
    {}, { costCentre: null, additionalData: {} },
    { costCentre: "x".repeat(101), additionalData: additionalValues },
    { costCentre: null, additionalData: { ...additionalValues, client: "x".repeat(501) } },
    { costCentre: null, additionalData: { ...additionalValues, contractor: "bad\nvalue" } },
    { costCentre: null, additionalData: { ...additionalValues, contractSigned: "2026-02-30" } },
    { costCentre: null, additionalData: { ...additionalValues, contractSigned: "13-10-2026" } },
    { costCentre: null, additionalData: { ...additionalValues, unknownField: "extra" } },
    { costCentre: null, additionalData: additionalValues, name: "Do not change" },
  ])("rejects invalid/extra additional data before SQL (%j)", async body => {
    expect((await patchAdditional(drona, body)).status).toBe(400);
    expect(statements).toEqual([]);
  });
  it("accepts leap days and binds injection-like text as data", async () => {
    const values = { ...additionalValues, contractSigned: "2024-02-29", contractor: "'); DELETE FROM shared.projects; --" };
    expect((await patchAdditional(drona, { costCentre: null, additionalData: values })).body.additionalData).toEqual(values);
    expect((await query("SELECT count(*)::int AS total FROM shared.projects")).rows[0].total).toBe(4);
  });
});
