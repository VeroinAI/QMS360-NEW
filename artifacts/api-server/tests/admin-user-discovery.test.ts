import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { PoolClient } from "pg";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: undefined as undefined | ((query: SQL) => Promise<unknown>),
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  return { ...actual, db: { execute: (query: SQL) => state.execute!(query) } };
});
import { pool } from "@workspace/db";
import { visibleAdminUsers } from "../src/lib/admin-user-discovery";
import { canManageAssignmentScope } from "../src/middlewares/rbac";

const schema = `discovery_${randomUUID().replaceAll("-", "")}`;
const org = randomUUID(), foreignOrg = randomUUID();
const admin = randomUUID(), target = randomUUID(), project = randomUUID(), outside = randomUUID();
const dialect = new PgDialect();
let client: PoolClient;
let statements: string[];
let req: Request;
const rows = [{ id: admin }, { id: target }, { id: randomUUID() }];
const query = (text: string, values: unknown[] = []) => client.query(
  text.replace(/\b(?:shared|public)\./g, `"${schema}".`), values,
);

beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await query(`
    CREATE TABLE shared.users (
      id uuid, organization_id uuid, email text, status text, access_status text, deleted_at timestamptz);
    CREATE TABLE shared.drona_user_links (
      user_id uuid, organization_id uuid, external_user_id bigint, environment_key text);
    CREATE TABLE public.user_master (user_id bigint, user_email text, is_active boolean);
    CREATE TABLE public.user_role_mapping (user_id bigint, project_map_id bigint, is_active boolean);
    CREATE TABLE public.project_mapping (project_map_id bigint, project_id bigint);
    CREATE TABLE public.project_master (project_id bigint, is_active boolean);
    CREATE TABLE shared.drona_project_links (
      external_project_id bigint, project_id uuid, organization_id uuid, environment_key text);
    CREATE TABLE shared.projects (id uuid, organization_id uuid, status text, deleted_at timestamptz);
  `);
  state.execute = async input => {
    const compiled = dialect.sqlToQuery(input);
    statements.push(compiled.sql);
    return query(compiled.sql, compiled.params);
  };
});
beforeEach(async () => {
  await client.query("SAVEPOINT scenario");
  vi.stubEnv("DRONA_ENVIRONMENT", "aws");
  statements = [];
  req = {
    currentUser: { id: admin, organizationId: org },
    dronaProjectIds: [project],
    permissionAdminBypass: false,
    permissionProjectScope: { unrestricted: true, projectIds: [] },
  } as unknown as Request;
  await query(`INSERT INTO shared.users VALUES ($1,$2,'person@example.test','active','active',NULL)`, [target, org]);
  await query(`INSERT INTO shared.drona_user_links VALUES ($1,$2,101,'aws')`, [target, org]);
  await query(`INSERT INTO public.user_master VALUES (101,' PERSON@example.test ',true)`);
  await query(`INSERT INTO public.user_role_mapping VALUES (101,201,true)`);
  await query(`INSERT INTO public.project_mapping VALUES (201,301)`);
  await query(`INSERT INTO public.project_master VALUES (301,true)`);
  await query(`INSERT INTO shared.projects VALUES ($1,$2,'active',NULL)`, [project, org]);
  await query(`INSERT INTO shared.drona_project_links VALUES (301,$1,$2,'aws')`, [project, org]);
});
afterEach(async () => {
  await client.query("ROLLBACK TO SAVEPOINT scenario; RELEASE SAVEPOINT scenario");
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (client) { await client.query("ROLLBACK"); client.release(); }
});

describe("scope-safe first-role user discovery shared by all three applications", () => {
  it("shows a provisioned, unassigned Employee without creating roles or approvals", async () => {
    expect(await visibleAdminUsers(req, rows, [])).toEqual(rows.slice(0, 2));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^\s*SELECT/);
  });
  it("does not expand Drona visibility even if a bypass flag is accidentally set", async () => {
    req.permissionAdminBypass = true;
    expect(await visibleAdminUsers(req, rows, [])).toEqual(rows.slice(0, 2));
  });
  it("preserves unrestricted non-Drona administrator behavior without source-table queries", async () => {
    req.dronaProjectIds = undefined;
    req.permissionAdminBypass = true;
    expect(await visibleAdminUsers(req, rows, [])).toEqual(rows);
    expect(statements).toHaveLength(0);
  });
  it("keeps empty Drona scope deny-all except the administrator's own row", async () => {
    req.dronaProjectIds = [];
    expect(await visibleAdminUsers(req, rows, [])).toEqual([rows[0]]);
    expect(statements).toHaveLength(0);
  });
  it("intersects administrator capability scope with Drona membership", async () => {
    req.permissionProjectScope = { unrestricted: false, projectIds: [outside] };
    expect(await visibleAdminUsers(req, rows, [])).toEqual([rows[0]]);
    expect(statements).toHaveLength(0);
  });
  it.each([
    "UPDATE shared.users SET organization_id = $1",
    "UPDATE shared.drona_user_links SET organization_id = $1",
    "UPDATE shared.drona_project_links SET organization_id = $1",
    "UPDATE shared.projects SET organization_id = $1",
  ])("rejects foreign organization through %s", async statement => {
    await query(statement, [foreignOrg]);
    expect(await visibleAdminUsers(req, rows, [])).toEqual([rows[0]]);
  });
  it.each([
    "UPDATE shared.drona_user_links SET environment_key = 'qa'",
    "UPDATE shared.drona_project_links SET environment_key = 'qa'",
    "DELETE FROM shared.drona_user_links",
    "DELETE FROM shared.drona_project_links",
    "UPDATE public.user_master SET is_active = false",
    "UPDATE public.user_master SET user_email = 'changed@example.test'",
    "UPDATE public.user_role_mapping SET is_active = false",
    "UPDATE public.project_master SET is_active = false",
    "UPDATE shared.projects SET status = 'inactive'",
    "UPDATE shared.projects SET deleted_at = now()",
    "UPDATE shared.users SET status = 'inactive'",
    "UPDATE shared.users SET access_status = 'deactivated'",
    "UPDATE shared.users SET deleted_at = now()",
  ])("honors live revocation: %s", async statement => {
    await query(statement);
    expect(await visibleAdminUsers(req, rows, [])).toEqual([rows[0]]);
  });
  it("does not discover users whose source membership is outside permitted projects", async () => {
    req.dronaProjectIds = [outside];
    expect(await visibleAdminUsers(req, rows, [])).toEqual([rows[0]]);
  });
  it("retains existing manageable role holders but does not expose outside-scope assignments", async () => {
    expect(await visibleAdminUsers(req, rows, [
      { userId: target, projectIds: [outside] },
      { userId: rows[2]!.id, projectIds: [project] },
    ])).toEqual([rows[0], rows[2]]);
  });
  it("does not turn discoverability into organization-wide or out-of-project assignment rights", () => {
    expect(canManageAssignmentScope(req, [])).toBe(false);
    expect(canManageAssignmentScope(req, [outside])).toBe(false);
    expect(canManageAssignmentScope(req, [project, outside])).toBe(false);
    expect(canManageAssignmentScope(req, [project])).toBe(true);
  });
  it("propagates source failures instead of silently hiding eligible users", async () => {
    await query("DROP TABLE shared.drona_user_links");
    await expect(visibleAdminUsers(req, rows, [])).rejects.toThrow();
  });
});
