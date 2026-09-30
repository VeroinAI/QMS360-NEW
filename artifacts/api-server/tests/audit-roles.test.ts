import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  applicationAccess,
  auditAuditLogEntries,
  auditPermissions,
  auditUserWorkspaceRoles,
  auditWorkspaceRolePermissions,
  auditWorkspaceRoles,
  db,
  organizations,
  platformRoles,
  projects,
  users,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 9);
let organizationId: string;
let adminToken: string;
let scopedAdminToken: string;

async function api(method: string, path: string, body?: unknown, token = adminToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, organizationId));
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, organizationId));
  await db.delete(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.organizationId, organizationId));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, organizationId));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, organizationId));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, organizationId));
  await db.delete(users).where(eq(users.organizationId, organizationId));
  await db.delete(projects).where(eq(projects.organizationId, organizationId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("Audit role permission persistence", () => {
  it("creates, lists, updates, and removes permissions without losing role metadata", async () => {
    const roleId = crypto.randomUUID();
    const selectedPermissions = [
      { key: "data_entry", name: "Data Entry" },
      { key: "approve_reject", name: "Approve or Reject" },
      { key: "audit_team_lead", name: "Audit Team Lead" },
      { key: "audit_program_manager", name: "Audit Program Manager" },
      { key: "product_process_owner", name: "Product / Process Owner" },
    ];
    const created = await api("POST", "/audit/admin/roles", {
      id: roleId,
      name: `Audit Reviewer ${suffix}`,
      description: "Reviews scheduled audits",
      permissions: selectedPermissions,
      roleAuthorizationLevel: 1,
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

describe("Audit schedule create/edit permission", () => {
  it("uses the existing data_entry grant for schedule writes only", async () => {
    const [user] = await db.insert(users).values({
      organizationId,
      email: `audit-schedule-editor.${suffix}@example.test`,
      username: `audit-schedule-editor.${suffix}`,
      fullName: "Audit Schedule Editor",
    }).returning();
    const [role] = await db.insert(auditWorkspaceRoles).values({
      organizationId,
      name: `Schedule Editor ${suffix}`,
    }).returning();
    const [existingPermission] = await db.select().from(auditPermissions).where(and(
      eq(auditPermissions.organizationId, organizationId),
      eq(auditPermissions.key, "data_entry"),
      isNull(auditPermissions.deletedAt),
    )).limit(1);
    const permission = existingPermission ?? (await db.insert(auditPermissions).values({
      organizationId, key: "data_entry", label: "Create / edit schedules", category: "audit",
    }).returning())[0]!;
    await db.insert(auditWorkspaceRolePermissions).values({
      organizationId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full",
    });
    await db.insert(auditUserWorkspaceRoles).values({
      organizationId, userId: user!.id, workspaceRoleId: role!.id,
    });
    await db.insert(applicationAccess).values({
      organizationId, username: user!.username, canOpenAudit: true,
    });
    const token = issueToken(user!);

    // Invalid bodies reach the endpoint's validation rather than being rejected by RBAC.
    expect((await api("POST", "/audit/schedules", {}, token)).status).toBe(422);
    expect((await api("PUT", `/audit/schedules/${crypto.randomUUID()}`, {}, token)).status).toBe(422);
    for (const [method, path] of [
      ["POST", "/audit/programmes"],
      ["DELETE", `/audit/schedules/${crypto.randomUUID()}`],
      ["POST", `/audit/schedules/${crypto.randomUUID()}/feasibility`],
      ["POST", "/audit/plans"],
    ]) {
      const response = await api(method, path, {}, token);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.json.error).toBe("This action is not permitted for your role");
    }
  });

  it("allows an organization-wide Programme creator without granting other Audit writes", async () => {
    const roleId = crypto.randomUUID();
    const programmePermission = { key: "create_audit_programme", name: "Create Audit Programme" };
    const created = await api("POST", "/audit/admin/roles", {
      id: roleId, name: `Programme Creator ${suffix}`, description: "Can start programmes",
      permissions: [programmePermission], active: true, systemDefault: false,
    });
    expect(created.status).toBe(201);
    expect(created.json.permissions).toContainEqual(programmePermission);
    const listed = await api("GET", "/audit/admin/roles?limit=200");
    expect(listed.json.items.find((role: { id: string }) => role.id === roleId)?.permissions)
      .toContainEqual(programmePermission);

    const [orgUser, scopedUser] = await db.insert(users).values([
      { organizationId, email: `programme-creator.${suffix}@example.test`, username: `programme-creator.${suffix}`, fullName: "Programme Creator" },
      { organizationId, email: `scoped-programme-creator.${suffix}@example.test`, username: `scoped-programme-creator.${suffix}`, fullName: "Scoped Programme Creator" },
    ]).returning();
    const [project] = await db.insert(projects).values({
      organizationId, code: `PC${suffix}`, name: "Scoped creator project",
    }).returning();
    await db.insert(auditUserWorkspaceRoles).values([
      { organizationId, userId: orgUser!.id, workspaceRoleId: roleId },
      { organizationId, userId: scopedUser!.id, workspaceRoleId: roleId, projectIds: [project!.id] },
    ]);
    await db.insert(applicationAccess).values([
      { organizationId, username: orgUser!.username, canOpenAudit: true },
      { organizationId, username: scopedUser!.username, canOpenAudit: true },
    ]);

    const token = issueToken(orgUser!);
    // A 422 proves that the request passed permission checks and reached body validation.
    expect((await api("POST", "/audit/programmes", {}, token)).status).toBe(422);
    for (const [method, path] of [
      ["POST", "/audit/schedules"],
      ["POST", `/audit/programmes/${crypto.randomUUID()}/submit`],
      ["DELETE", `/audit/programmes/${crypto.randomUUID()}`],
      ["POST", "/audit/plans"],
    ]) {
      const response = await api(method, path, {}, token);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    // A project-limited assignment cannot create a projectless parent programme.
    const scoped = await api("POST", "/audit/programmes", {}, issueToken(scopedUser!));
    expect(scoped.status).toBe(403);
  });
});

describe("Audit access queue for role holders without access rows", () => {
  async function createRoleHolder(suffixPart: string) {
    const [user] = await db.insert(users).values({
      organizationId,
      email: `audit-queue-${suffixPart}.${suffix}@example.test`,
      username: `audit-queue-${suffixPart}.${suffix}`,
      fullName: `Audit Queue ${suffixPart}`,
    }).returning();
    const [role] = await db.insert(auditWorkspaceRoles).values({
      organizationId,
      name: `Audit Queue Role ${suffixPart} ${suffix}`,
    }).returning();
    const assignment = await api("POST", `/audit/admin/users/${user!.id}/roles`, {
      roleId: role!.id,
      scopeType: "organization",
      scopeIds: [],
    });
    expect(assignment.status).toBe(200);
    return { user: user!, role: role! };
  }

  it("lists and approves a missing access row without granting other applications", async () => {
    const { user, role } = await createRoleHolder("approve");
    const beforeApproval = await db.select().from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.username, user.username),
      isNull(applicationAccess.deletedAt),
    ));
    expect(beforeApproval).toHaveLength(0);
    const queue = await api("GET", "/audit/admin/access-queue?limit=200");

    expect(queue.status).toBe(200);
    expect(queue.json.items).toContainEqual(expect.objectContaining({
      id: `missing:${user.id}`,
      userId: user.id,
      username: user.username,
      requestedRoleId: role.id,
      status: "pending",
    }));
    expect(queue.json.total).toBeGreaterThanOrEqual(1);

    const decision = await api("POST", `/audit/admin/access-queue/missing:${user.id}/decision`, { decision: "approve" });
    expect(decision.status).toBe(200);
    expect(decision.json).toEqual(expect.objectContaining({
      username: user.username,
      canOpenAudit: true,
      canOpenQaqc: false,
      canOpenLessons: false,
    }));
    const accessRows = await db.select().from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.username, user.username),
      isNull(applicationAccess.deletedAt),
    ));
    expect(accessRows).toHaveLength(1);
  });

  it("records a rejection and does not offer that user as pending again", async () => {
    const { user } = await createRoleHolder("reject");
    const decision = await api("POST", `/audit/admin/access-queue/missing:${user.id}/decision`, { decision: "reject" });

    expect(decision.status).toBe(200);
    expect(decision.json).toEqual(expect.objectContaining({
      username: user.username,
      canOpenAudit: false,
      status: "active",
    }));
    await db.update(applicationAccess).set({ status: "rejected" }).where(and(
      eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.username, user.username),
      isNull(applicationAccess.deletedAt),
    ));
    await db.update(applicationAccess).set({ status: "active" }).where(and(
      eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.username, user.username),
      isNull(applicationAccess.deletedAt),
    ));
    const queue = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(queue.json.items).not.toContainEqual(expect.objectContaining({ userId: user.id }));
    const repeatDecision = await api("POST", `/audit/admin/access-queue/missing:${user.id}/decision`, { decision: "approve" });
    expect(repeatDecision.status).toBe(409);
  });

  it("requests Audit approval again when an unapproved user receives a role after rejection", async () => {
    const { user, role } = await createRoleHolder("reassigned");
    const firstQueue = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(firstQueue.json.items).toContainEqual(expect.objectContaining({
      id: `missing:${user.id}`, status: "pending",
    }));
    const rejected = await api("POST", `/audit/admin/access-queue/missing:${user.id}/decision`, { decision: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.json.canOpenAudit).toBe(false);
    const hidden = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(hidden.json.items).not.toContainEqual(expect.objectContaining({ username: user.username }));

    const assignment = await api("POST", `/audit/admin/users/${user.id}/roles`, {
      roleId: role.id, scopeType: "organization", scopeIds: [],
    });
    expect(assignment.status).toBe(200);
    const pending = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(pending.json.items).toContainEqual(expect.objectContaining({
      id: rejected.json.id, username: user.username, status: "pending",
    }));
    const beforeApproval = await db.select().from(applicationAccess).where(eq(applicationAccess.id, rejected.json.id));
    expect(beforeApproval[0]?.canOpenAudit).toBe(false);

    const approved = await api("POST", `/audit/admin/access-queue/${rejected.json.id}/decision`, { decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.json.canOpenAudit).toBe(true);
    const afterApproval = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(afterApproval.json.items).not.toContainEqual(expect.objectContaining({ username: user.username }));
  });

  it("keeps an unrelated application's rejected status from hiding an Audit request", async () => {
    const { user } = await createRoleHolder("other-app-reject");
    const [access] = await db.insert(applicationAccess).values({
      organizationId,
      username: user.username,
      status: "rejected",
      canOpenAudit: false,
    }).returning();

    const queue = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(queue.json.items).toContainEqual(expect.objectContaining({
      id: access!.id,
      username: user.username,
    }));
    const decision = await api("POST", `/audit/admin/access-queue/${access!.id}/decision`, { decision: "approve" });
    expect(decision.status).toBe(200);
    expect(decision.json).toEqual(expect.objectContaining({
      canOpenAudit: true,
      status: "rejected",
    }));
  });

  it("adds an existing unapproved account to the queue on role assignment without changing its access", async () => {
    const [user] = await db.insert(users).values({
      organizationId, email: `audit-existing.${suffix}@example.test`,
      username: `audit-existing.${suffix}`, fullName: "Existing Unapproved",
    }).returning();
    const [access] = await db.insert(applicationAccess).values({
      organizationId, username: user!.username, canOpenAudit: false, canOpenLessons: true,
    }).returning();
    const [role] = await db.insert(auditWorkspaceRoles).values({
      organizationId, name: `Audit Existing Role ${suffix}`,
    }).returning();
    expect((await api("POST", `/audit/admin/users/${user!.id}/roles`, {
      roleId: role!.id, scopeType: "organization", scopeIds: [],
    })).status).toBe(200);
    const queue = await api("GET", "/audit/admin/access-queue?limit=200");
    expect(queue.json.items).toContainEqual(expect.objectContaining({
      id: access!.id, username: user!.username, status: "pending",
    }));
    const [stillUnapproved] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, access!.id));
    expect(stillUnapproved).toMatchObject({ canOpenAudit: false, canOpenLessons: true });
  });

  it("rejects a real access-row decision outside the administrator's project scope", async () => {
    const [managedProject] = await db.insert(projects).values({
      organizationId,
      code: `SCOPE${suffix}`,
      name: `Managed scope ${suffix}`,
    }).returning();
    const [outsideProject] = await db.insert(projects).values({
      organizationId,
      code: `OUTSIDE${suffix}`,
      name: `Outside scope ${suffix}`,
    }).returning();
    const [admin] = await db.insert(users).values({
      organizationId,
      email: `audit-queue-scoped-admin.${suffix}@example.test`,
      username: `audit-queue-scoped-admin.${suffix}`,
      fullName: "Audit Queue Scoped Admin",
    }).returning();
    const [adminRole] = await db.insert(auditWorkspaceRoles).values({
      organizationId,
      name: `Audit Administrator ${suffix}`,
    }).returning();
    await db.insert(auditUserWorkspaceRoles).values({
      organizationId,
      userId: admin!.id,
      workspaceRoleId: adminRole!.id,
      projectIds: [managedProject!.id],
      status: "active",
    });
    await db.insert(applicationAccess).values({
      organizationId,
      username: admin!.username,
      canOpenAudit: true,
    });
    scopedAdminToken = issueToken(admin!);

    const [target] = await db.insert(users).values({
      organizationId,
      email: `audit-queue-out-of-scope.${suffix}@example.test`,
      username: `audit-queue-out-of-scope.${suffix}`,
      fullName: "Audit Queue Out of Scope",
    }).returning();
    const [role] = await db.insert(auditWorkspaceRoles).values({
      organizationId,
      name: `Audit Out-of-Scope Role ${suffix}`,
    }).returning();
    await db.insert(auditUserWorkspaceRoles).values({
      organizationId,
      userId: target!.id,
      workspaceRoleId: role!.id,
      projectIds: [outsideProject!.id],
      status: "active",
    });
    const [access] = await db.insert(applicationAccess).values({
      organizationId,
      username: target!.username,
      canOpenAudit: false,
    }).returning();

    const decision = await api(
      "POST",
      `/audit/admin/access-queue/${access!.id}/decision`,
      { decision: "approve" },
      scopedAdminToken,
    );
    expect(decision.status).toBe(403);
  });
});