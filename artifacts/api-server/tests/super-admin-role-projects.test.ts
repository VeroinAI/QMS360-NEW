import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../src/middlewares/auth", async original => {
  const actual = await original<typeof import("../src/middlewares/auth")>();
  return { ...actual, requireAuth: async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    await actual.requireAuth(req, res, () => {
      // Synthetic live Drona membership, independent of platform privilege.
      req.dronaProjectIds = req.headers["x-scope-project"] ? [String(req.headers["x-scope-project"])] : [];
      next();
    });
  } };
});
import {
  db, organizations, platformRoles, users, projects, applicationAccess, outboundEmails,
  workspaceRoles, userWorkspaceRoles, auditLogEntries,
  lessonsWorkspaceRoles, lessonsUserWorkspaceRoles, lessonsAuditLogEntries,
  auditWorkspaceRoles, auditUserWorkspaceRoles, auditAuditLogEntries,
} from "@workspace/db";
import { issueToken } from "../src/lib/auth";
import { canManageAssignmentScope, isSuperAdminRoleAdministration } from "../src/middlewares/rbac";
import platformRouter from "../src/routes/platform";
import qaqcRouter from "../src/routes/qaqc";
import lessonsRouter from "../src/routes/lessons";
import auditRouter from "../src/routes/audit";

const org = randomUUID(), foreignOrg = randomUUID();
let server: Server, base: string;
let superToken: string, orgToken: string, employeeToken: string;
let targetId: string, foreignUser: string, firstProject: string, secondProject: string, foreignProject: string;
const roleIds: Record<string, string> = {};
const apps = [
  { name: "qaqc", roles: workspaceRoles, assignments: userWorkspaceRoles, logs: auditLogEntries },
  { name: "lessons", roles: lessonsWorkspaceRoles, assignments: lessonsUserWorkspaceRoles, logs: lessonsAuditLogEntries },
  { name: "audit", roles: auditWorkspaceRoles, assignments: auditUserWorkspaceRoles, logs: auditAuditLogEntries },
] as const;
async function request(method: string, path: string, token = superToken, body?: unknown, project?: string) {
  const response = await fetch(`${base}${path}`, {
    method, headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(project ? { "x-scope-project": project } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
beforeAll(async () => {
  vi.stubEnv("AUTH_STRATEGY", "local");
  await db.insert(organizations).values([
    { id: org, name: "Synthetic role administration", code: org },
    { id: foreignOrg, name: "Synthetic foreign organization", code: foreignOrg },
  ]);
  const roles = await db.insert(platformRoles).values([
    { organizationId: org, name: "Super Admin" },
    { organizationId: org, name: "Org Admin" },
    { organizationId: org, name: "Employee" },
  ]).returning();
  const people = await db.insert(users).values([
    { organizationId: org, username: `super-${org}`, email: `super-${org}@example.test`, fullName: "Synthetic Super", platformRoleId: roles[0]!.id },
    { organizationId: org, username: `org-${org}`, email: `org-${org}@example.test`, fullName: "Synthetic Org", platformRoleId: roles[1]!.id },
    { organizationId: org, username: `target-${org}`, email: `target-${org}@example.test`, fullName: "Synthetic Employee" },
    { organizationId: foreignOrg, username: `foreign-${org}`, email: `foreign-${org}@example.test`, fullName: "Foreign Employee" },
  ]).returning();
  superToken = issueToken(people[0]!); orgToken = issueToken(people[1]!);
  employeeToken = issueToken(people[2]!); targetId = people[2]!.id; foreignUser = people[3]!.id;
  const records = await db.insert(projects).values([
    { organizationId: org, name: "First active", code: `A-${org}` },
    { organizationId: org, name: "Second active", code: `B-${org}` },
    { organizationId: org, name: "Inactive", code: `I-${org}`, status: "inactive" },
    { organizationId: org, name: "Deleted", code: `D-${org}`, deletedAt: new Date() },
    { organizationId: foreignOrg, name: "Foreign active", code: `F-${org}` },
  ]).returning();
  firstProject = records[0]!.id; secondProject = records[1]!.id; foreignProject = records[4]!.id;
  for (const app of apps) {
    const [role] = await db.insert(app.roles).values({ organizationId: org, name: "Synthetic Employee Role" }).returning();
    roleIds[app.name] = role!.id;
  }
  const app = express();
  app.use(express.json());
  app.use("/api", platformRouter);
  app.use("/api/qaqc", qaqcRouter); app.use("/api/lessons", lessonsRouter); app.use("/api/audit", auditRouter);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  server = await new Promise<Server>(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const app of apps) {
    await db.delete(app.logs).where(eq(app.logs.organizationId, org));
    await db.delete(app.assignments).where(eq(app.assignments.organizationId, org));
    await db.delete(app.roles).where(eq(app.roles.organizationId, org));
  }
  await db.delete(outboundEmails).where(eq(outboundEmails.organizationId, org));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, org));
  await db.delete(users).where(inArray(users.organizationId, [org, foreignOrg]));
  await db.delete(projects).where(inArray(projects.organizationId, [org, foreignOrg]));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, org));
  await db.delete(organizations).where(inArray(organizations.id, [org, foreignOrg]));
  vi.unstubAllEnvs();
});

describe("Super Admin role-administration-only project exception", () => {
  it.each(apps)("lists all active organization projects for $name without personal membership", async app => {
    const result = await request("GET", `/platform/role-assignment-projects?application=${app.name}`);
    expect(result.status).toBe(200);
    expect(result.data.map((p: { id: string }) => p.id)).toEqual([firstProject, secondProject]);
  });
  it("leaves operational context and project list empty with empty Drona membership", async () => {
    expect((await request("GET", "/platform/context")).data.projects).toEqual([]);
    expect((await request("GET", "/platform/projects")).data.items).toEqual([]);
  });
  it("keeps Org Admin restricted to their Drona membership", async () => {
    expect((await request("GET", "/platform/role-assignment-projects?application=lessons", orgToken)).data).toEqual([]);
    const scoped = await request("GET", "/platform/role-assignment-projects?application=lessons", orgToken, undefined, firstProject);
    expect(scoped.data.map((p: { id: string }) => p.id)).toEqual([firstProject]);
  });
  it("denies an ordinary Employee and rejects unknown applications", async () => {
    expect((await request("GET", "/platform/role-assignment-projects?application=lessons", employeeToken)).status).toBe(403);
    expect((await request("GET", "/platform/role-assignment-projects?application=unknown")).status).toBe(422);
  });
  it.each(apps)("shows same-organization users and supports create/edit/remove role scopes in $name", async app => {
    const list = await request("GET", `/${app.name}/admin/users?limit=100`);
    expect(list.status).toBe(200);
    expect(list.data.items.some((u: { id: string }) => u.id === targetId)).toBe(true);
    expect(list.data.items.some((u: { id: string }) => u.id === foreignUser)).toBe(false);
    const path = `/${app.name}/admin/users/${targetId}/roles`;
    expect((await request("POST", path, superToken, { roleId: roleIds[app.name], scopeType: "project", scopeIds: [secondProject] })).status).toBe(200);
    expect((await request("GET", "/platform/application-access", employeeToken)).data).toEqual({ qaqc: false, lessons: false, audit: false });
    expect((await request("GET", "/platform/projects", employeeToken)).data.items).toEqual([]);
    expect((await request("POST", path, superToken, { roleId: roleIds[app.name], scopeType: "project", scopeIds: [firstProject, secondProject] })).status).toBe(200);
    const [assignment] = await db.select().from(app.assignments).where(eq(app.assignments.userId, targetId));
    expect(assignment!.projectIds).toEqual([firstProject, secondProject]);
    const removed = await request("DELETE", `${path}/${roleIds[app.name]}`);
    expect(removed.data).toBeNull();
    expect(removed.status).toBe(204);
  });
  it.each(apps)("rejects foreign project/user assignment in $name", async app => {
    const body = { roleId: roleIds[app.name], scopeType: "project", scopeIds: [foreignProject] };
    expect((await request("POST", `/${app.name}/admin/users/${targetId}/roles`, superToken, body)).status).toBe(422);
    expect((await request("POST", `/${app.name}/admin/users/${foreignUser}/roles`, superToken, { ...body, scopeIds: [firstProject] })).status).toBe(404);
  });
  it.each(apps)("does not grant Org Admin the Super Admin assignment exception in $name", async app => {
    const result = await request("POST", `/${app.name}/admin/users/${targetId}/roles`, orgToken,
      { roleId: roleIds[app.name], scopeType: "project", scopeIds: [secondProject] }, firstProject);
    expect(result.status).toBe(403);
  });
  it("does not automatically approve applications or create Drona membership", async () => {
    const access = await request("GET", "/platform/application-access", employeeToken);
    expect(access.data).toEqual({ qaqc: false, lessons: false, audit: false });
    expect((await request("GET", "/platform/projects", employeeToken)).data.items).toEqual([]);
  });
  it.each(["/admin/access-queue", "/admin/delegations", "/forms", "/admin/users/person/profile"])(
    "does not enable role-administration bypass on %s", path => {
      const req = { currentUser: { platformRole: "Super Admin" }, baseUrl: "/api/lessons", path, dronaProjectIds: [], permissionProjectScope: { unrestricted: false, projectIds: [] } } as unknown as Request;
      expect(isSuperAdminRoleAdministration(req)).toBe(false);
      expect(canManageAssignmentScope(req, [secondProject])).toBe(false);
    },
  );
});
