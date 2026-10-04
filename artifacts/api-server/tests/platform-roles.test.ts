import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditAuditLogEntries,
  auditLogEntries,
  applicationAccess,
  db,
  lessonsAuditLogEntries,
  outboundEmails,
  organizations,
  platformRoles,
  projects,
  qaqcMetricEntries,
  permissions,
  workspaceRolePermissions,
  userWorkspaceRoles,
  users,
  workspaceRoles,
} from "@workspace/db";
import platformRouter from "../src/routes/platform";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";

let app: Express;
let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 9);
const orgIds: string[] = [];
let orgId: string;
let foreignOrgId: string;
let admin: { id: string; token: string };
let member: { id: string; token: string };
let targetId: string;
let employeeRoleId: string;
let qualityRoleId: string;
let superRoleId: string;
let foreignRoleId: string;

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null,
  };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", platformRouter);
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org, foreignOrg] = await db.insert(organizations).values([
    { name: `Role Org ${suffix}`, code: `R${suffix}` },
    { name: `Foreign Role Org ${suffix}`, code: `F${suffix}` },
  ]).returning();
  orgId = org!.id;
  foreignOrgId = foreignOrg!.id;
  orgIds.push(orgId, foreignOrgId);

  const [orgAdminRole, employeeRole, qualityRole, superRole, foreignRole] = await db.insert(platformRoles).values([
    { organizationId: orgId, name: "Org Admin", isSystem: true },
    { organizationId: orgId, name: "Employee", isSystem: true },
    { organizationId: orgId, name: "Quality Manager", isSystem: true },
    { organizationId: orgId, name: "Super Admin", isSystem: true },
    { organizationId: foreignOrgId, name: "Executive Viewer", isSystem: true },
  ]).returning();
  employeeRoleId = employeeRole!.id;
  qualityRoleId = qualityRole!.id;
  superRoleId = superRole!.id;
  foreignRoleId = foreignRole!.id;

  const [adminRow, memberRow, targetRow] = await db.insert(users).values([
    { organizationId: orgId, email: `admin.${suffix}@test.local`, username: `admin.${suffix}`, fullName: "Role Admin", platformRoleId: orgAdminRole!.id },
    { organizationId: orgId, email: `member.${suffix}@test.local`, username: `member.${suffix}`, fullName: "Role Member", platformRoleId: employeeRoleId },
    { organizationId: orgId, email: `target.${suffix}@test.local`, username: `target.${suffix}`, fullName: "Role Target", platformRoleId: employeeRoleId },
  ]).returning();
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  member = { id: memberRow!.id, token: issueToken(memberRow!) };
  targetId = targetRow!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, orgIds));
  await db.delete(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.organizationId, orgIds));
  await db.delete(auditAuditLogEntries).where(inArray(auditAuditLogEntries.organizationId, orgIds));
  await db.delete(outboundEmails).where(inArray(outboundEmails.organizationId, orgIds));
  await db.delete(applicationAccess).where(inArray(applicationAccess.organizationId, orgIds));
  await db.delete(qaqcMetricEntries).where(inArray(qaqcMetricEntries.organizationId, orgIds));
  await db.delete(userWorkspaceRoles).where(inArray(userWorkspaceRoles.organizationId, orgIds));
  await db.delete(workspaceRolePermissions).where(inArray(workspaceRolePermissions.organizationId, orgIds));
  await db.delete(workspaceRoles).where(inArray(workspaceRoles.organizationId, orgIds));
  await db.delete(permissions).where(inArray(permissions.organizationId, orgIds));
  await db.delete(projects).where(inArray(projects.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("platform role management", () => {
  it("allows default QA/QC permission edits, protects metadata and retains grants on rejected changes", async () => {
    const [role] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: "QAQC Representative",
      description: "Capture and submit QA/QC records", isSystem: true }).returning();
    const data = { id: role!.id, name: role!.name, description: role!.description, active: true,
      permissions: [{ key: "data_entry", name: "Create / edit" }, { key: "view_own_scope", name: "View own" }] };
    const saved = await api("PUT", `/qaqc/admin/roles/${role!.id}`, admin.token, data);
    expect(saved.status).toBe(200);
    expect(saved.json.permissions.map((p: { key: string }) => p.key).sort()).toEqual(["data_entry", "view_own_scope"]);
    expect(saved.json.systemDefault).toBe(true);
    expect((await api("PUT", `/qaqc/admin/roles/${role!.id}`, admin.token, { ...data, name: "Renamed" })).status).toBe(409);
    expect((await api("PUT", `/qaqc/admin/roles/${role!.id}`, admin.token,
      { ...data, permissions: [{ key: "audit_team_lead", name: "Wrong app" }] })).status).toBe(422);
    const list = await api("GET", "/qaqc/admin/roles", admin.token);
    expect(list.json.items.find((r: { id: string }) => r.id === role!.id).permissions).toHaveLength(2);
  });
  it("keeps platform administrators' application cards consistent with backend access", async () => {
    const allowed = await api("GET", "/platform/application-access", admin.token);
    expect(allowed.json).toEqual({ qaqc: true, lessons: true, audit: true });
    const restricted = await api("GET", "/platform/application-access", member.token);
    expect(restricted.json).toEqual({ qaqc: false, lessons: false, audit: false });
  });
  it("makes assigned QA/QC roles approvable without changing other application access", async () => {
    const [role] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: `QA/QC Reviewer ${suffix}` }).returning();
    const [person] = await db.select().from(users).where(eq(users.id, member.id));
    await db.insert(applicationAccess).values({ organizationId: orgId, username: person!.username,
      canOpenLessons: true, canOpenAudit: true, canOpenQaqc: false, status: "active" });
    const assigned = await api("POST", `/qaqc/admin/users/${member.id}/roles`, admin.token,
      { roleId: role!.id, scopeType: "organization", scopeIds: [] });
    expect(assigned.status).toBe(200);
    expect((await api("GET", "/platform/application-access", member.token)).json).toEqual({ qaqc: false, lessons: true, audit: true });
    const queue = await api("GET", "/qaqc/admin/access-queue", admin.token);
    const request = queue.json.items.find((r: { userId: string }) => r.userId === member.id);
    expect(request?.id).toBe(`missing:${member.id}`);
    const approved = await api("POST", `/qaqc/admin/access-queue/${request.id}/decision`, admin.token,
      { decision: "approve", comments: "Verification approval" });
    expect(approved.status).toBe(200);
    expect((await api("GET", "/platform/application-access", member.token)).json).toEqual({ qaqc: true, lessons: true, audit: true });
    const repeated = await api("POST", `/qaqc/admin/access-queue/${request.id}/decision`, admin.token, { decision: "approve" });
    expect(repeated.status).toBe(409);
    const [project] = await db.insert(projects).values({ organizationId: orgId, code: `Q${suffix}`, name: "Permission project" }).returning();
    const ownBody = { id: role!.id, name: role!.name, active: true, permissions: [
      { key: "data_entry", name: "Create / edit" }, { key: "view_own_scope", name: "View own" },
    ] };
    expect((await api("PUT", `/qaqc/admin/roles/${role!.id}`, admin.token, ownBody)).status).toBe(200);
    const [own, foreign] = await db.insert(qaqcMetricEntries).values([
      { organizationId: orgId, projectId: project!.id, reportingPeriod: "2026-10-01", category: "NCR", submittedById: member.id },
      { organizationId: orgId, projectId: project!.id, reportingPeriod: "2026-10-01", category: "RFI", submittedById: targetId },
    ]).returning();
    const records = await api("GET", "/qaqc/metrics", member.token);
    expect(records.status).toBe(200);
    expect(records.json.items.map((r: { id: string }) => r.id)).toEqual([own!.id]);
    expect((await api("DELETE", `/qaqc/metrics/${foreign!.id}`, member.token)).status).toBe(403);
    expect((await api("GET", "/qaqc/admin/roles", member.token)).status).toBe(403);
    expect((await api("GET", "/qaqc/reports/monthly", member.token)).status).toBe(403);
    const capabilities = await api("GET", "/qaqc/capabilities", member.token);
    expect(capabilities.json).toEqual({ administrator: false, keys: expect.arrayContaining(["data_entry", "view_own_scope"]) });
    expect((await api("PUT", `/qaqc/admin/roles/${role!.id}`, admin.token, { ...ownBody,
      permissions: [{ key: "qaqc.monthly_reports.view_own_scope", name: "Read monthly reports" }] })).status).toBe(200);
    expect((await api("GET", "/qaqc/metrics", member.token)).status).toBe(403);
  });
  it("lists only the administrator's organization roles", async () => {
    const result = await api("GET", "/platform/roles", admin.token);
    expect(result.status).toBe(200);
    expect(result.json.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(["Employee", "Org Admin", "Quality Manager", "Super Admin"]),
    );
    expect(result.json).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: foreignRoleId }),
    ]));
  });

  it("rejects non-admin role listing and updates", async () => {
    expect((await api("GET", "/platform/roles", member.token)).status).toBe(403);
    expect((await api("PUT", `/platform/users/${targetId}/role`, member.token, { roleId: qualityRoleId })).status).toBe(403);
  });

  it("rejects self changes, foreign roles, and Org Admin promotion to Super Admin", async () => {
    expect((await api("PUT", `/platform/users/${admin.id}/role`, admin.token, { roleId: employeeRoleId })).status).toBe(422);
    expect((await api("PUT", `/platform/users/${targetId}/role`, admin.token, { roleId: foreignRoleId })).status).toBe(404);
    expect((await api("PUT", `/platform/users/${targetId}/role`, admin.token, { roleId: superRoleId })).status).toBe(403);
  });

  it("updates a same-organization user and writes each application audit log", async () => {
    const result = await api("PUT", `/platform/users/${targetId}/role`, admin.token, { roleId: qualityRoleId });
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ userId: targetId, platformRole: "Quality Manager" });

    const [target] = await db.select({ platformRoleId: users.platformRoleId }).from(users).where(eq(users.id, targetId));
    expect(target?.platformRoleId).toBe(qualityRoleId);

    for (const table of [auditLogEntries, lessonsAuditLogEntries, auditAuditLogEntries]) {
      const [entry] = await db.select().from(table).where(and(
        eq(table.organizationId, orgId),
        eq(table.entityId, targetId),
        eq(table.action, "update_platform_role"),
      ));
      expect(entry?.actorId).toBe(admin.id);
      expect(entry?.before).toEqual({ platformRole: "Employee" });
      expect(entry?.after).toEqual(expect.objectContaining({ platformRole: "Quality Manager" }));
    }
  });
});