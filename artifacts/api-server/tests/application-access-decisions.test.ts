import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  applicationAccess, db, organizations, platformRoles, users, projects,
  userWorkspaceRoles, workspaceRoles, auditLogEntries,
  lessonsUserWorkspaceRoles, lessonsWorkspaceRoles, lessonsAuditLogEntries,
  auditUserWorkspaceRoles, auditWorkspaceRoles, auditAuditLogEntries,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import type { Application } from "../src/lib/application-access-requests";

const applications: Application[] = ["qaqc", "lessons", "audit"];
const flag = { qaqc: "canOpenQaqc", lessons: "canOpenLessons", audit: "canOpenAudit" } as const;
const roleTables = { qaqc: workspaceRoles, lessons: lessonsWorkspaceRoles, audit: auditWorkspaceRoles };
const assignmentTables = { qaqc: userWorkspaceRoles, lessons: lessonsUserWorkspaceRoles, audit: auditUserWorkspaceRoles };
const logTables = { qaqc: auditLogEntries, lessons: lessonsAuditLogEntries, audit: auditAuditLogEntries };
const suffix = crypto.randomUUID().slice(0, 8);
let server: Server, baseUrl: string, organizationId: string, adminToken: string, adminId: string;
const roleIds = {} as Record<Application, string>;
let sequence = 0;

async function api(application: Application, method: string, path: string, body?: unknown, token = adminToken) {
  const response = await fetch(`${baseUrl}/${application}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}
async function fixture(values: Partial<typeof applicationAccess.$inferInsert> = {}, projectIds: string[] = []) {
  const [user] = await db.insert(users).values({
    organizationId, username: `access-${suffix}-${++sequence}`, fullName: "Access Requester",
    email: `access-${suffix}-${sequence}@example.invalid`,
  }).returning();
  const [access] = await db.insert(applicationAccess).values({
    organizationId, username: user!.username, status: "pending", ...values,
  }).returning();
  for (const application of applications) await db.insert(assignmentTables[application]).values({
    organizationId, userId: user!.id, workspaceRoleId: roleIds[application], projectIds,
    updatedAt: new Date("2026-01-01"),
  });
  return { user: user!, access: access! };
}
async function requestId(application: Application, username: string, token = adminToken) {
  const result = await api(application, "GET", "/admin/access-queue?limit=200", undefined, token);
  expect(result.status).toBe(200);
  return result.json.items.find((row: { username: string }) => row.username === username)?.id;
}
async function decide(application: Application, username: string, decision: "approve" | "reject") {
  const id = await requestId(application, username);
  expect(id).toBeDefined();
  return api(application, "POST", `/admin/access-queue/${id}/decision`, { decision });
}

beforeAll(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
  const [org] = await db.insert(organizations).values({ name: `Independent Access ${suffix}`, code: `IA${suffix}` }).returning();
  organizationId = org!.id;
  const [platformRole] = await db.insert(platformRoles).values({ organizationId, name: "Org Admin", isSystem: true }).returning();
  const [admin] = await db.insert(users).values({
    organizationId, platformRoleId: platformRole!.id, username: `admin-${suffix}`,
    email: `admin-${suffix}@example.invalid`, fullName: "Access Administrator",
  }).returning();
  adminId = admin!.id; adminToken = issueToken(admin!);
  for (const application of applications) {
    const [role] = await db.insert(roleTables[application]).values({ organizationId, name: `Reviewer ${suffix}` }).returning();
    roleIds[application] = role!.id;
  }
});
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (!organizationId) return;
  for (const table of [applicationAccess, ...Object.values(logTables), ...Object.values(assignmentTables),
    ...Object.values(roleTables), users, projects, platformRoles]) {
    await db.delete(table).where(eq(table.organizationId, organizationId));
  }
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("Independent application access decisions", () => {
  for (const rejectedApp of applications) for (const approvedApp of applications.filter(application => application !== rejectedApp)) {
    it(`rejects ${rejectedApp} without hiding or changing ${approvedApp}`, async () => {
      const { user, access } = await fixture();
      expect((await decide(rejectedApp, user.username, "reject")).status).toBe(200);
      expect(await requestId(rejectedApp, user.username)).toBeUndefined();
      expect((await decide(approvedApp, user.username, "approve")).status).toBe(200);
      const remaining = applications.find(application => application !== rejectedApp && application !== approvedApp)!;
      expect(await requestId(remaining, user.username)).toBeDefined();
      expect(await requestId(rejectedApp, user.username)).toBeUndefined();
      const [row] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, access.id));
      expect(row).toMatchObject({
        status: "pending", [flag[rejectedApp]]: false, [flag[approvedApp]]: true, [flag[remaining]]: false,
        applicationReviews: { [rejectedApp]: { status: "rejected" }, [approvedApp]: { status: "approved" } },
      });
      expect((await db.select().from(users).where(eq(users.id, user.id)))[0]!.platformRoleId).toBe(user.platformRoleId);
      expect((await api(rejectedApp, "POST", `/admin/access-queue/${access.id}/decision`, { decision: "approve" })).status).toBe(409);
    });
  }

  for (const application of applications) {
    it(`renews only ${application} after a fresh role assignment`, async () => {
      const { user } = await fixture();
      for (const candidate of applications) expect((await decide(candidate, user.username, "reject")).status).toBe(200);
      const assigned = await api(application, "POST", `/admin/users/${user.id}/roles`, {
        roleId: roleIds[application], scopeType: "organization", scopeIds: [],
      });
      expect(assigned.status).toBe(200);
      const [row] = await db.select().from(applicationAccess).where(and(eq(applicationAccess.organizationId, organizationId), eq(applicationAccess.username, user.username)));
      expect(row![flag[application]]).toBe(false);
      expect(await requestId(application, user.username)).toBeDefined();
      for (const other of applications.filter(candidate => candidate !== application)) expect(await requestId(other, user.username)).toBeUndefined();
      expect((await decide(application, user.username, "approve")).status).toBe(200);
    });

    it(`preserves known legacy ${application} rejection using only that application's log`, async () => {
      const { user, access } = await fixture({ status: "rejected" });
      await db.insert(logTables[application]).values({
        organizationId, actorId: adminId, entityType: application === "lessons" ? "access_request" : "application_access",
        entityId: access.id, action: application === "audit" ? "reject_access" : "access_reject", createdAt: new Date(),
      });
      expect(await requestId(application, user.username)).toBeUndefined();
      for (const other of applications.filter(candidate => candidate !== application)) expect(await requestId(other, user.username)).toBeDefined();
      // An unrelated application's decision must not update the legacy rejection timestamp.
      const other = applications.find(candidate => candidate !== application)!;
      expect((await decide(other, user.username, "approve")).status).toBe(200);
      expect(await requestId(application, user.username)).toBeUndefined();
    });
  }

  it("retains all existing approvals even when shared status was rejected", async () => {
    const { user, access } = await fixture({ status: "rejected", canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true });
    for (const application of applications) expect(await requestId(application, user.username)).toBeUndefined();
    expect((await db.select().from(applicationAccess).where(eq(applicationAccess.id, access.id)))[0]).toEqual(access);
  });

  for (const approvedApp of applications) {
    it(`retains an earlier ${approvedApp} approval when another application is rejected`, async () => {
      const { user, access } = await fixture();
      expect((await decide(approvedApp, user.username, "approve")).status).toBe(200);
      const rejectedApp = applications.find(candidate => candidate !== approvedApp)!;
      expect((await decide(rejectedApp, user.username, "reject")).status).toBe(200);
      const [row] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, access.id));
      expect(row![flag[approvedApp]]).toBe(true);
      expect(row!.applicationReviews[approvedApp]!.status).toBe("approved");
      expect(await requestId(approvedApp, user.username)).toBeUndefined();
      expect(await requestId(rejectedApp, user.username)).toBeUndefined();
    });
  }

  it("creates missing requests for each application without unlocking other applications", async () => {
    for (const application of applications) {
      const { user, access } = await fixture();
      await db.delete(applicationAccess).where(eq(applicationAccess.id, access.id));
      expect(await requestId(application, user.username)).toBe(`missing:${user.id}`);
      expect((await decide(application, user.username, "approve")).status).toBe(200);
      const rows = await db.select().from(applicationAccess).where(and(
        eq(applicationAccess.organizationId, organizationId), eq(applicationAccess.username, user.username)));
      expect(rows).toHaveLength(1);
      expect(rows[0]![flag[application]]).toBe(true);
      for (const other of applications.filter(candidate => candidate !== application)) {
        expect(rows[0]![flag[other]]).toBe(false);
        expect(await requestId(other, user.username)).toBeDefined();
      }
    }
  });

  it("does not decide an access record belonging to another organization", async () => {
    const [otherOrg] = await db.insert(organizations).values({ name: "Other access tenant", code: `X${suffix}` }).returning();
    const [otherAccess] = await db.insert(applicationAccess).values({
      organizationId: otherOrg!.id, username: `foreign-${suffix}`, status: "pending",
    }).returning();
    try {
      for (const application of applications) {
        expect((await api(application, "POST", `/admin/access-queue/${otherAccess!.id}/decision`, { decision: "approve" })).status).toBe(409);
      }
      expect((await db.select().from(applicationAccess).where(eq(applicationAccess.id, otherAccess!.id)))[0]).toEqual(otherAccess);
    } finally {
      await db.delete(applicationAccess).where(eq(applicationAccess.id, otherAccess!.id));
      await db.delete(organizations).where(eq(organizations.id, otherOrg!.id));
    }
  });

  it("does not turn an ambiguous legacy shared rejection into three rejections", async () => {
    const { user } = await fixture({ status: "rejected" });
    for (const application of applications) expect(await requestId(application, user.username)).toBeDefined();
  });

  it("preserves imported pending requests awaiting QA/QC or Lessons roles", async () => {
    const [access] = await db.insert(applicationAccess).values({ organizationId, username: `imported-${suffix}`, status: "pending" }).returning();
    for (const application of ["qaqc", "lessons"] as const) {
      expect(await requestId(application, access!.username)).toBe(access!.id);
      expect((await decide(application, access!.username, "reject")).status).toBe(200);
      expect(await requestId(application, access!.username)).toBeUndefined();
    }
  });

  it("serializes concurrent decisions for different applications without losing either outcome", async () => {
    const { user, access } = await fixture();
    const responses = await Promise.all([
      api("qaqc", "POST", `/admin/access-queue/${access.id}/decision`, { decision: "reject" }),
      api("lessons", "POST", `/admin/access-queue/${access.id}/decision`, { decision: "approve" }),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const [row] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, access.id));
    expect(row!.applicationReviews).toMatchObject({ qaqc: { status: "rejected" }, lessons: { status: "approved" } });
    expect(await requestId("audit", user.username)).toBe(access.id);
  });

  it("allows only one concurrent decision on the same request", async () => {
    const { access } = await fixture();
    const responses = await Promise.all(["approve", "reject"].map(decision =>
      api("audit", "POST", `/admin/access-queue/${access.id}/decision`, { decision })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  });

  it("keeps all three queues and decisions within the administrator's projects", async () => {
    const [managed, outside] = await db.insert(projects).values([
      { organizationId, name: "Managed", code: `M${suffix}` },
      { organizationId, name: "Outside", code: `O${suffix}` },
    ]).returning();
    const { user: scopedAdmin } = await fixture({ canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true }, [managed!.id]);
    for (const application of applications) {
      const [role] = await db.insert(roleTables[application]).values({ organizationId, name: `${application === "audit" ? "Audit" : application === "lessons" ? "Lessons" : "QA/QC"} Administrator` }).returning();
      await db.insert(assignmentTables[application]).values({ organizationId, userId: scopedAdmin.id, workspaceRoleId: role!.id, projectIds: [managed!.id] });
    }
    const token = issueToken(scopedAdmin);
    const permitted = await fixture({ projectId: managed!.id }, [managed!.id]);
    const forbidden = await fixture({ projectId: outside!.id }, [outside!.id]);
    for (const application of applications) {
      expect(await requestId(application, permitted.user.username, token)).toBeDefined();
      expect(await requestId(application, forbidden.user.username, token)).toBeUndefined();
      expect((await api(application, "POST", `/admin/access-queue/${forbidden.access.id}/decision`, { decision: "approve" }, token)).status).toBe(403);
      expect((await api(application, "POST", `/admin/access-queue/${permitted.access.id}/decision`, { decision: "approve" }, token)).status).toBe(200);
    }
  });

  it("does not renew a legacy Audit rejection for a scoped admin after an outside-project assignment", async () => {
    const [managed, outside] = await db.insert(projects).values([
      { organizationId, name: "Legacy managed", code: `LM${suffix}` },
      { organizationId, name: "Legacy outside", code: `LO${suffix}` },
    ]).returning();
    const { user: scopedAdmin } = await fixture({ canOpenAudit: true }, [managed!.id]);
    const [adminRole, outsideRole] = await db.insert(auditWorkspaceRoles).values([
      { organizationId, name: "Legacy Audit Administrator" },
      { organizationId, name: "Outside Legacy Reviewer" },
    ]).returning();
    await db.insert(auditUserWorkspaceRoles).values({
      organizationId, userId: scopedAdmin.id, workspaceRoleId: adminRole!.id, projectIds: [managed!.id],
    });
    const token = issueToken(scopedAdmin);
    // The empty review object represents pre-transition production data. The
    // managed assignment predates the rejection, while the shared row has no
    // project boundary of its own.
    const { user, access } = await fixture({ status: "rejected", applicationReviews: {} }, [managed!.id]);
    await db.insert(auditAuditLogEntries).values({
      organizationId, actorId: adminId, entityType: "application_access",
      entityId: access.id, action: "reject_access", createdAt: new Date(),
    });
    expect(await requestId("audit", user.username, token)).toBeUndefined();
    expect((await api("audit", "POST", `/admin/users/${user.id}/roles`, {
      roleId: outsideRole!.id, scopeType: "project", scopeIds: [outside!.id],
    })).status).toBe(200);
    const requestEvents = await db.select().from(auditAuditLogEntries).where(and(
      eq(auditAuditLogEntries.entityId, access.id), eq(auditAuditLogEntries.action, "request_access")));
    expect(requestEvents).toHaveLength(1);
    expect(await requestId("audit", user.username, token)).toBeUndefined();
    expect((await api("audit", "POST", `/admin/access-queue/${access.id}/decision`, { decision: "approve" }, token)).status).toBe(403);
    const [unchanged] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, access.id));
    expect(unchanged).toMatchObject({ canOpenAudit: false, applicationReviews: {} });
    // The organization administrator can manage the fresh outside assignment.
    expect(await requestId("audit", user.username)).toBe(access.id);
    // A fresh managed assignment really does renew the scoped administrator's request.
    expect((await api("audit", "POST", `/admin/users/${user.id}/roles`, {
      roleId: roleIds.audit, scopeType: "project", scopeIds: [managed!.id],
    }, token)).status).toBe(200);
    expect(await requestId("audit", user.username, token)).toBe(access.id);
    expect((await api("audit", "POST", `/admin/access-queue/${access.id}/decision`, { decision: "approve" }, token)).status).toBe(200);
  });

  for (const firstApp of applications) for (const decision of ["approve", "reject"] as const) {
    it(`${firstApp} ${decision} leaves a different-project application's request visible and actionable`, async () => {
      const secondApp = applications[(applications.indexOf(firstApp) + 1) % applications.length]!;
      const n = ++sequence;
      const [projectA, projectB] = await db.insert(projects).values([
        { organizationId, name: "First application project", code: `DA${suffix}${n}` },
        { organizationId, name: "Second application project", code: `DB${suffix}${n}` },
      ]).returning();
      async function scopedAdministrator(application: Application, projectId: string) {
        const [role] = await db.insert(roleTables[application]).values({
          organizationId, name: `${application} Administrator ${n}`,
        }).returning();
        const [admin] = await db.insert(users).values({
          organizationId, username: `${application}-scoped-${suffix}-${n}`, fullName: "Scoped App Administrator",
          email: `${application}-scoped-${suffix}-${n}@example.invalid`,
        }).returning();
        await db.insert(assignmentTables[application]).values({
          organizationId, userId: admin!.id, workspaceRoleId: role!.id, projectIds: [projectId],
        });
        await db.insert(applicationAccess).values({
          organizationId, username: admin!.username, [flag[application]]: true,
        });
        return issueToken(admin!);
      }
      const firstToken = await scopedAdministrator(firstApp, projectA!.id);
      const secondToken = await scopedAdministrator(secondApp, projectB!.id);
      const { user, access } = await fixture({}, [projectA!.id]);
      await db.delete(applicationAccess).where(eq(applicationAccess.id, access.id));
      await db.update(assignmentTables[secondApp]).set({ projectIds: [projectB!.id] }).where(and(
        eq(assignmentTables[secondApp].organizationId, organizationId), eq(assignmentTables[secondApp].userId, user.id)));
      expect(await requestId(firstApp, user.username, firstToken)).toBe(`missing:${user.id}`);
      expect(await requestId(secondApp, user.username, secondToken)).toBe(`missing:${user.id}`);
      expect((await api(firstApp, "POST", `/admin/access-queue/missing:${user.id}/decision`, { decision }, firstToken)).status).toBe(200);
      const rows = await db.select().from(applicationAccess).where(and(
        eq(applicationAccess.organizationId, organizationId), eq(applicationAccess.username, user.username)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.projectId).toBeNull();
      const secondRequest = await requestId(secondApp, user.username, secondToken);
      expect(secondRequest).toBeDefined();
      expect((await api(secondApp, "POST", `/admin/access-queue/${secondRequest}/decision`, { decision: "approve" }, secondToken)).status).toBe(200);
      const [decided] = await db.select().from(applicationAccess).where(eq(applicationAccess.id, rows[0]!.id));
      expect(decided!.applicationReviews).toMatchObject({
        [firstApp]: { status: decision === "approve" ? "approved" : "rejected" },
        [secondApp]: { status: "approved" },
      });
      expect(decided![flag[firstApp]]).toBe(decision === "approve");
      expect(decided![flag[secondApp]]).toBe(true);
    });
  }
});