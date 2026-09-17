import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  auditAuditLogEntries,
  auditPermissions,
  auditWorkspaceRolePermissions,
  auditWorkspaceRoles,
  db,
  organizations,
  platformRoles,
  users,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 9);
let organizationId: string;
let adminToken: string;

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [organization] = await db.insert(organizations).values({
    name: `Audit Role Regression ${suffix}`,
    code: `ARR${suffix}`,
  }).returning();
  organizationId = organization!.id;

  const [adminRole] = await db.insert(platformRoles).values({
    organizationId,
    name: "Org Admin",
    isSystem: true,
  }).returning();
  const [admin] = await db.insert(users).values({
    organizationId,
    email: `audit-role-admin.${suffix}@example.test`,
    username: `audit-role-admin.${suffix}`,
    fullName: "Audit Role Admin",
    platformRoleId: adminRole!.id,
  }).returning();
  adminToken = issueToken(admin!);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, organizationId));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, organizationId));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, organizationId));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, organizationId));
  await db.delete(users).where(eq(users.organizationId, organizationId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("Audit role permission persistence", () => {
  it("creates, lists, updates, and removes permissions without losing role metadata", async () => {
    const roleId = crypto.randomUUID();
    const selectedPermissions = [
      { key: "data_entry", name: "Data Entry" },
      { key: "approve_reject", name: "Approve or Reject" },
    ];
    const created = await api("POST", "/audit/admin/roles", {
      id: roleId,
      name: `Audit Reviewer ${suffix}`,
      description: "Reviews scheduled audits",
      permissions: selectedPermissions,
      active: true,
      systemDefault: false,
    });

    expect(created.status).toBe(201);
    expect(created.json).toEqual(expect.objectContaining({
      id: roleId,
      name: `Audit Reviewer ${suffix}`,
      description: "Reviews scheduled audits",
      permissions: expect.arrayContaining(selectedPermissions),
      active: true,
      systemDefault: false,
    }));

    const joinedPermissions = await db.select({
      key: auditPermissions.key,
      name: auditPermissions.label,
    }).from(auditWorkspaceRolePermissions)
      .innerJoin(auditPermissions, eq(auditWorkspaceRolePermissions.permissionId, auditPermissions.id))
      .where(and(
        eq(auditWorkspaceRolePermissions.organizationId, organizationId),
        eq(auditWorkspaceRolePermissions.workspaceRoleId, roleId),
        isNull(auditWorkspaceRolePermissions.deletedAt),
      ));
    expect(joinedPermissions).toEqual(expect.arrayContaining(selectedPermissions));
    expect(joinedPermissions).toHaveLength(selectedPermissions.length);

    const firstList = await api("GET", "/audit/admin/roles?limit=200");
    expect(firstList.status).toBe(200);
    expect(firstList.json.items).toContainEqual(expect.objectContaining({
      id: roleId,
      permissions: expect.arrayContaining(selectedPermissions),
    }));

    const freshList = await api("GET", "/audit/admin/roles?limit=200");
    expect(freshList.status).toBe(200);
    expect(freshList.json.items).toContainEqual(expect.objectContaining({
      id: roleId,
      name: `Audit Reviewer ${suffix}`,
      description: "Reviews scheduled audits",
      permissions: expect.arrayContaining(selectedPermissions),
      active: true,
      systemDefault: false,
    }));

    const updated = await api("PUT", `/audit/admin/roles/${roleId}`, {
      id: roleId,
      name: `Senior Audit Reviewer ${suffix}`,
      description: "Owns final audit review",
      permissions: [],
      active: false,
      systemDefault: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.json).toEqual(expect.objectContaining({
      id: roleId,
      name: `Senior Audit Reviewer ${suffix}`,
      description: "Owns final audit review",
      permissions: [],
      active: false,
      systemDefault: false,
    }));

    const activeJoinRows = await db.select().from(auditWorkspaceRolePermissions).where(and(
      eq(auditWorkspaceRolePermissions.organizationId, organizationId),
      eq(auditWorkspaceRolePermissions.workspaceRoleId, roleId),
      isNull(auditWorkspaceRolePermissions.deletedAt),
    ));
    expect(activeJoinRows).toHaveLength(0);

    const finalList = await api("GET", "/audit/admin/roles?limit=200");
    expect(finalList.status).toBe(200);
    expect(finalList.json.items).toContainEqual(expect.objectContaining({
      id: roleId,
      name: `Senior Audit Reviewer ${suffix}`,
      description: "Owns final audit review",
      permissions: [],
      active: false,
      systemDefault: false,
    }));
  });
});