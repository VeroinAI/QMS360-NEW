import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditAuditLogEntries,
  auditLogEntries,
  db,
  lessonsAuditLogEntries,
  organizations,
  platformRoles,
  users,
} from "@workspace/db";
import platformRouter from "../src/routes/platform";
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
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("platform role management", () => {
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