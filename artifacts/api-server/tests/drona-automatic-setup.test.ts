import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import express from "express";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: undefined as undefined | ((query: SQL) => Promise<unknown>),
  transaction: undefined as undefined | ((callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
  context: undefined as undefined | ((id: string) => Promise<unknown>),
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  return { ...actual, db: {
    execute: (query: SQL) => state.execute!(query),
    transaction: (callback: (tx: unknown) => Promise<unknown>) => state.transaction!(callback),
  } };
});
vi.mock("../src/lib/auth", async original => ({
  ...await original<typeof import("../src/lib/auth")>(),
  getUserContext: (id: string) => state.context!(id),
}));
import { pool } from "@workspace/db";
import { verifyToken } from "../src/lib/auth";
import { requireAuth } from "../src/middlewares/auth";
import authRouter from "../src/routes/auth";
import { provisionDronaIdentity, type ProvisionExecutor } from "../src/lib/drona/provisioning";

const schema = `drona_auto_${randomUUID().replaceAll("-", "")}`;
const org = randomUUID();
const target = { environment: "auto-test", organizationId: org };
const email = "synthetic@example.test";
const sourceUser = "9007199254740993";
let client: PoolClient;
let server: Server;
let base: string;
let savepoint = 0;
const statements: string[] = [];
const dialect = new PgDialect();
const rewrite = (text: string) => text.replaceAll('"shared"', `"${schema}"`)
  .replace(/\b(?:shared|public)\./g, `"${schema}".`);
const query = (text: string, values: unknown[] = []) => client.query(rewrite(text), values);
const executor = { execute: async (input: SQL) => {
  const sql = dialect.sqlToQuery(input);
  statements.push(sql.sql);
  return query(sql.sql, sql.params);
} } as unknown as ProvisionExecutor;
async function transaction<T>(callback: (tx: ProvisionExecutor) => Promise<T>): Promise<T> {
  const name = `setup_${++savepoint}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await callback(executor);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
async function login(address = email) {
  const response = await fetch(`${base}/api/auth/drona`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address }),
  });
  return { status: response.status, body: await response.json() as { token: string; error: string; user: { id: string; platformRole: string; workspaceRoles: string[] } } };
}
async function projectIds(token: string) {
  const response = await fetch(`${base}/fixture/projects`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() as { ids: string[] } };
}
async function count(table: string) {
  return Number((await query(`SELECT count(*) AS total FROM shared.${table}`)).rows[0].total);
}
async function addProject(id = "71", code: string | null = "501", name = "Synthetic assigned project") {
  await query("INSERT INTO public.project_master(project_id, project_code, project_name) VALUES ($1,$2,$3)", [id, code, name]);
  await query("INSERT INTO public.project_mapping(project_map_id, project_id) VALUES ($1,$1)", [id]);
  await query("INSERT INTO public.user_role_mapping(user_id, project_map_id) VALUES ($1,$2)", [sourceUser, id]);
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  for (const table of ["organizations", "users", "projects", "application_access"]) {
    await client.query(`CREATE TABLE "${schema}"."${table}" (LIKE shared."${table}" INCLUDING ALL)`);
  }
  // Validate both real versioned migrations without changing the workspace's
  // shared/public tables. Everything, including the fixture schema, rolls back.
  for (const filename of ["0023_drona_identity_links.sql", "0024_drona_automatic_setup.sql"]) {
    const migration = await readFile(new URL(`../../../lib/db/drizzle/${filename}`, import.meta.url), "utf8");
    await client.query(rewrite(migration));
  }
  await query(`CREATE TABLE public.user_master (user_id bigint PRIMARY KEY, user_name text NOT NULL,
    user_email text NOT NULL, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.project_master (project_id bigint PRIMARY KEY, project_name text NOT NULL,
      project_code bigint, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.project_mapping (project_map_id bigint PRIMARY KEY, project_id bigint NOT NULL);
    CREATE TABLE public.user_role_mapping (user_id bigint NOT NULL, project_map_id bigint NOT NULL,
      is_active boolean NOT NULL DEFAULT true, user_role_id integer DEFAULT 999);`);
  state.execute = executor.execute as unknown as typeof state.execute;
  state.transaction = transaction as unknown as typeof state.transaction;
  state.context = async id => {
    const row = (await query("SELECT * FROM shared.users WHERE id=$1", [id])).rows[0];
    return row ? { id: row.id, organizationId: org, email: row.email, username: row.username,
      fullName: row.full_name, platformRole: "Employee", organizationName: "Synthetic organization", workspaceRoles: [] } : null;
  };
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.get("/fixture/projects", requireAuth, (req, res) => res.json({ ids: req.dronaProjectIds }));
  server = await new Promise<Server>(resolve => {
    const result = app.listen(0, "127.0.0.1", () => resolve(result));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 30_000);
beforeEach(async () => {
  await client.query("SAVEPOINT scenario");
  vi.stubEnv("AUTH_STRATEGY", "drona");
  vi.stubEnv("DRONA_EMAIL_EXCEPTION_ENABLED", "true");
  vi.stubEnv("DRONA_MAPPING_REVIEWED", "true");
  vi.stubEnv("DRONA_ENVIRONMENT", target.environment);
  vi.stubEnv("DRONA_ORGANIZATION_ID", org);
  await query("INSERT INTO shared.organizations(id,name,code) VALUES ($1,'Synthetic organization','SYNTHETIC')", [org]);
  await query("INSERT INTO public.user_master(user_id,user_name,user_email) VALUES ($1,'Synthetic employee',$2)", [sourceUser, email]);
  statements.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await client.query("ROLLBACK TO SAVEPOINT scenario; RELEASE SAVEPOINT scenario");
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (client) { await client.query("ROLLBACK"); client.release(); }
});

describe("Drona automatic setup with real PostgreSQL and HTTP login", () => {
  it("creates an internal identity and assigned projects, issues a real session and grants no approvals/password/roles", async () => {
    await addProject();
    const result = await login("Synthetic@Example.test");
    expect(result.status, result.body.error).toBe(200);
    expect(verifyToken(result.body.token)).toMatchObject({ sub: result.body.user.id, externalUserId: sourceUser, environment: target.environment });
    expect(result.body.user.platformRole).toBe("Employee");
    expect(result.body.user.workspaceRoles).toEqual([]);
    const user = (await query("SELECT * FROM shared.users")).rows[0];
    expect(user.password_hash).toBeNull();
    expect(user.platform_role_id).toBeNull();
    expect(user.full_name).toBe("Synthetic employee");
    expect(await count("application_access")).toBe(0);
    expect(await count("drona_user_links")).toBe(1);
    expect(await count("projects")).toBe(1);
    expect((await projectIds(result.body.token)).body.ids).toHaveLength(1);
    expect(statements.some(sql => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\./i.test(sql))).toBe(false);
  });
  it("reuses identities/projects across repeated logins without duplicate rows", async () => {
    await addProject();
    const first = await login();
    const second = await login();
    expect(second.status, second.body.error).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await count("users")).toBe(1);
    expect(await count("projects")).toBe(1);
    expect(await count("drona_provisioning_history")).toBe(2);
  });
  it("handles a later Drona signup without an operator import", async () => {
    await login();
    await query("INSERT INTO public.user_master VALUES (42,'Second employee','second@example.test',true)");
    const result = await login("second@example.test");
    expect(result.status, result.body.error).toBe(200);
    expect(await count("users")).toBe(2);
    expect(await count("drona_user_links")).toBe(2);
  });
  it("reuses an existing case-insensitive email and stable project code/name without altering history, roles or approvals", async () => {
    const id = randomUUID();
    const project = randomUUID();
    const platformRoleId = randomUUID();
    await query(`INSERT INTO shared.users(id,organization_id,email,username,full_name,password_hash,platform_role_id,custom_fields)
      VALUES ($1,$2,'Synthetic@Example.test','existing-username','Existing name','synthetic-preserved-hash',$3,'{"keep":"history"}')`,
    [id, org, platformRoleId]);
    await query(`INSERT INTO shared.projects(id,organization_id,code,name,custom_fields)
      VALUES ($1,$2,'501','Synthetic assigned project','{"keep":"history"}')`, [project, org]);
    await query("INSERT INTO shared.application_access(organization_id,username,can_open_lessons) VALUES ($1,'existing-username',true)", [org]);
    await addProject();
    const result = await login();
    expect(result.status, result.body.error).toBe(200);
    expect(result.body.user.id).toBe(id);
    const user = (await query("SELECT * FROM shared.users")).rows[0];
    expect(user.username).toBe("existing-username");
    expect(user.full_name).toBe("Existing name");
    expect(user.password_hash).toBe("synthetic-preserved-hash");
    expect(user.platform_role_id).toBe(platformRoleId);
    expect(user.custom_fields).toEqual({ keep: "history" });
    expect((await projectIds(result.body.token)).body.ids).toEqual([project]);
    expect((await query("SELECT can_open_lessons FROM shared.application_access")).rows[0].can_open_lessons).toBe(true);
  });
  it("creates newly assigned projects during an existing session and immediately honors assignment removal", async () => {
    const result = await login();
    expect((await projectIds(result.body.token)).body.ids).toEqual([]);
    await addProject();
    expect((await projectIds(result.body.token)).body.ids).toHaveLength(1);
    await query("UPDATE public.user_role_mapping SET is_active=false");
    expect((await projectIds(result.body.token)).body.ids).toEqual([]);
    expect(await count("projects")).toBe(1); // Retain historical QMS records.
  });
  it.each(["false", "true"])("does not recreate a removed project link on session refresh or login (repeat=%s)", async repeat => {
    await addProject();
    const result = await login();
    await query("DELETE FROM shared.drona_project_links");
    if (repeat === "true") expect((await login()).status).toBe(200);
    expect((await projectIds(result.body.token)).body.ids).toEqual([]);
    expect(await count("drona_project_links")).toBe(0);
  });
  it("does not resurrect a removed user link on another login and revokes the old token", async () => {
    const result = await login();
    await query("DELETE FROM shared.drona_user_links");
    expect((await login()).status).toBe(403);
    expect((await projectIds(result.body.token)).status).toBe(401);
    expect(await count("drona_user_links")).toBe(0);
  });
  it.each(["pending", "rejected"])("does not activate an existing %s QMS account", async access => {
    await query(`INSERT INTO shared.users(organization_id,email,username,full_name,access_status)
      VALUES ($1,$2,'existing','Existing employee',$3)`, [org, email, access]);
    expect((await login()).status).toBe(403);
    expect(await count("drona_user_links")).toBe(0);
    expect((await query("SELECT access_status FROM shared.users")).rows[0].access_status).toBe(access);
  });
  it("does not create a replacement for a deleted matching user", async () => {
    await query(`INSERT INTO shared.users(organization_id,email,username,full_name,deleted_at)
      VALUES ($1,$2,'deleted','Deleted employee',now())`, [org, email]);
    expect((await login()).status).toBe(403);
    expect(await count("users")).toBe(1);
  });
  it("fails closed for multiple matching internal emails", async () => {
    await query(`INSERT INTO shared.users(organization_id,email,username,full_name) VALUES
      ($1,'Synthetic@Example.test','one','One'),($1,'synthetic@example.test','two','Two')`, [org]);
    expect((await login()).status).toBe(409);
    expect(await count("drona_user_links")).toBe(0);
  });
  it.each(["missing", "inactive", "ambiguous"])("does not provision a %s source user", async kind => {
    if (kind === "missing") await query("DELETE FROM public.user_master");
    if (kind === "inactive") await query("UPDATE public.user_master SET is_active=false");
    if (kind === "ambiguous") await query("INSERT INTO public.user_master VALUES (43,'Duplicate','SYNTHETIC@EXAMPLE.TEST',true)");
    expect((await login()).status).toBe(401);
    expect(await count("users")).toBe(0);
  });
  it("rolls back the new identity and all projects when a later project has a conflicting existing name", async () => {
    await addProject("71", "501", "First project");
    await addProject("72", "502", "Second project");
    await query("INSERT INTO shared.projects(organization_id,code,name) VALUES ($1,'502','Different project')", [org]);
    expect((await login()).status).toBe(409);
    expect(await count("users")).toBe(0);
    expect(await count("projects")).toBe(1);
    expect(await count("drona_user_links")).toBe(0);
    expect(await count("drona_project_links")).toBe(0);
    expect(await count("drona_provisioning_history")).toBe(0);
  });
  it("rejects a conflicting existing username instead of assigning another person's identity", async () => {
    await query(`INSERT INTO shared.users(organization_id,email,username,full_name)
      VALUES ($1,'different@example.test',$2,'Different employee')`, [org, `drona_${target.environment}_${sourceUser}`]);
    expect((await login()).status).toBe(409);
    expect(await count("users")).toBe(1);
  });
  it("requires administrator review for a name-only legacy project match", async () => {
    await addProject("71", null);
    await query("INSERT INTO shared.projects(organization_id,code,name) VALUES ($1,'LEGACY','Synthetic assigned project')", [org]);
    expect((await login()).status).toBe(409);
    expect(await count("users")).toBe(0);
  });
  it("creates a stable technical project code when the source has no project code", async () => {
    await addProject("71", null);
    expect((await login()).status).toBe(200);
    expect((await query("SELECT code FROM shared.projects")).rows[0].code).toBe("DRONA-auto-test-71");
  });
  it("blocks inactive projects and does not provision unassigned projects", async () => {
    await addProject();
    await query("UPDATE public.project_master SET is_active=false");
    await query("INSERT INTO public.project_master(project_id,project_code,project_name) VALUES (88,588,'Unassigned active project')");
    expect((await login()).status).toBe(200);
    expect(await count("projects")).toBe(0);
  });
  it("rejects an invalid configured organization and never creates one", async () => {
    vi.stubEnv("DRONA_ORGANIZATION_ID", randomUUID());
    expect((await login()).status).toBe(503);
    expect(await count("users")).toBe(0);
    expect(await count("organizations")).toBe(1);
  });
  it("keeps environment identity links distinct for equal source IDs", async () => {
    const first = await transaction(tx => provisionDronaIdentity(tx, email, target));
    const second = await transaction(tx => provisionDronaIdentity(tx, email, { ...target, environment: "other-test" }));
    expect(second.id).toBe(first.id); // Same exact email/tenant; not numeric-ID inference.
    expect(await count("drona_user_links")).toBe(2);
    await query("DELETE FROM shared.drona_user_links WHERE environment_key='other-test'");
    expect((await login()).status).toBe(200);
  });
  it("backfills existing reviewed links and keeps later removals revoked", async () => {
    await addProject();
    await login();
    await query("DELETE FROM shared.drona_provisioning_history");
    await query("UPDATE shared.drona_user_links SET review_reference='operator-reviewed'");
    await query("UPDATE shared.drona_project_links SET review_reference='operator-reviewed'");
    const migration = await readFile(new URL("../../../lib/db/drizzle/0024_drona_automatic_setup.sql", import.meta.url), "utf8");
    await client.query(rewrite(migration.slice(migration.indexOf('INSERT INTO "shared"."drona_provisioning_history"'))));
    expect(await count("drona_provisioning_history")).toBe(2);
    await query("DELETE FROM shared.drona_user_links");
    expect((await login()).status).toBe(403);
  });
  it("does not take another organization's matching user or project", async () => {
    const other = randomUUID();
    const existing = randomUUID();
    await query("INSERT INTO shared.organizations(id,name,code) VALUES ($1,'Other organization','OTHER')", [other]);
    await query(`INSERT INTO shared.users(id,organization_id,email,username,full_name)
      VALUES ($1,$2,$3,'other-user','Other employee')`, [existing, other, email]);
    await query("INSERT INTO shared.projects(organization_id,code,name) VALUES ($1,'501','Synthetic assigned project')", [other]);
    await addProject();
    const result = await login();
    expect(result.status, result.body.error).toBe(200);
    expect(result.body.user.id).not.toBe(existing);
    expect((await query("SELECT organization_id FROM shared.drona_user_links")).rows[0].organization_id).toBe(org);
    expect(await count("projects")).toBe(2);
  });
  it("does not provision through a token from another environment", async () => {
    const result = await login();
    vi.stubEnv("DRONA_ENVIRONMENT", "other-test");
    await addProject();
    expect((await projectIds(result.body.token)).status).toBe(401);
    expect(await count("projects")).toBe(0);
  });
  it("fails closed and rolls back if the required history migration is missing", async () => {
    await query("DROP TABLE shared.drona_provisioning_history");
    expect((await login()).status).toBe(503);
    expect(await count("users")).toBe(0);
    expect(await count("drona_user_links")).toBe(0);
  });
});
