import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  applicationAccess, auditAuditLogEntries, auditEscalationInstances, auditEscalationRules, auditEvidenceFiles, auditFindings,
  auditPermissions, auditSchedules, auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  audits, correctiveActionReports, db, escalationInstances, escalationRules, lessonsPermissions,
  lessonsUserWorkspaceRoles, lessonEscalationInstances, lessonEscalationRules, lessonLearnedForms,
  lessonsAuditLogEntries, lessonsWorkspaceRolePermissions, lessonsWorkspaceRoles, organizations, permissions,
  auditLogEntries, evidenceFiles, platformRoles, projects, qaqcMetricEntries, qualityAssessmentBriefs,
  userWorkspaceRoles, users, workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { getEffectiveProjectScope, getPlatformEffectiveProjectScope } from "../src/middlewares/rbac";

let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let foreignOrgId: string;
let projectA: string;
let projectB: string;
let foreignProject: string;
let admin: { id: string; token: string };
let scoped: { id: string; token: string };
let lessonRole: string;
let auditRole: string;
let qaqcRole: string;
const createdOrgIds: string[] = [];

async function api(method: string, path: string, token: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* error responses are sometimes empty */ }
  return { status: response.status, json };
}

async function insertUser(name: string, organizationId: string, platformRoleId?: string) {
  const [row] = await db.insert(users).values({
    organizationId, email: `${name}.${suffix}@example.test`, username: `${name}.${suffix}`,
    fullName: name, platformRoleId: platformRoleId ?? null,
  }).returning();
  return { id: row!.id, token: issueToken(row!), username: row!.username };
}

async function insertAppRole(appName: "qaqc" | "lessons" | "audit", name: string, userId: string, projectIds: string[], permissionKey = "view_own_scope") {
  if (appName === "qaqc") {
    const [role] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: `${name} ${suffix}` }).returning();
    const [existingPermission] = await db.select().from(permissions).where(and(eq(permissions.organizationId, orgId), eq(permissions.key, permissionKey)));
    const [createdPermission] = existingPermission ? [] : await db.insert(permissions).values({ organizationId: orgId, key: permissionKey, label: permissionKey, category: "qaqc" }).returning();
    const permission = existingPermission ?? createdPermission;
    await db.insert(workspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
    await db.insert(userWorkspaceRoles).values({ organizationId: orgId, userId, workspaceRoleId: role!.id, projectIds });
    return role!.id;
  }
  const roles = appName === "lessons" ? lessonsWorkspaceRoles : auditWorkspaceRoles;
  const perms = appName === "lessons" ? lessonsPermissions : auditPermissions;
  const assignments = appName === "lessons" ? lessonsUserWorkspaceRoles : auditUserWorkspaceRoles;
  const rolePermissions = appName === "lessons" ? lessonsWorkspaceRolePermissions : auditWorkspaceRolePermissions;
  const [role] = await db.insert(roles).values({ organizationId: orgId, name: `${name} ${suffix}` }).returning();
  const [existingPermission] = await db.select().from(perms).where(and(eq(perms.organizationId, orgId), eq(perms.key, permissionKey)));
  const [createdPermission] = existingPermission ? [] : await db.insert(perms).values({ organizationId: orgId, key: permissionKey, label: permissionKey, category: appName }).returning();
  const permission = existingPermission ?? createdPermission;
  await db.insert(rolePermissions).values({ organizationId: orgId, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full" });
  await db.insert(assignments).values({ organizationId: orgId, userId, workspaceRoleId: role!.id, projectIds });
  return role!.id;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
  const [org, foreign] = await db.insert(organizations).values([
    { name: `Task 13 Scope ${suffix}`, code: `T13${suffix}` },
    { name: `Task 13 Foreign ${suffix}`, code: `F13${suffix}` },
  ]).returning();
  orgId = org!.id; foreignOrgId = foreign!.id; createdOrgIds.push(orgId, foreignOrgId);
  const [adminRole] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  admin = await insertUser("task13.admin", orgId, adminRole!.id);
  scoped = await insertUser("task13.scoped", orgId);
  const [a, b] = await db.insert(projects).values([
    { organizationId: orgId, code: `A-${suffix}`, name: "Project A" },
    { organizationId: orgId, code: `B-${suffix}`, name: "Project B" },
  ]).returning();
  projectA = a!.id; projectB = b!.id;
  const [fp] = await db.insert(projects).values({ organizationId: foreignOrgId, code: `F-${suffix}`, name: "Foreign project" }).returning();
  foreignProject = fp!.id;
  await db.insert(applicationAccess).values({
    organizationId: orgId, username: scoped.username, canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true,
  });
  lessonRole = await insertAppRole("lessons", "Task 13 lessons", scoped.id, [projectA]);
  auditRole = await insertAppRole("audit", "Task 13 audit", scoped.id, [projectB]);
  qaqcRole = await insertAppRole("qaqc", "Task 13 qaqc", scoped.id, [projectA]);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(applicationAccess).where(inArray(applicationAccess.organizationId, createdOrgIds));
  await db.delete(auditAuditLogEntries).where(inArray(auditAuditLogEntries.organizationId, createdOrgIds));
  await db.delete(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.organizationId, createdOrgIds));
  await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, createdOrgIds));
  await db.delete(auditEscalationInstances).where(inArray(auditEscalationInstances.organizationId, createdOrgIds));
  await db.delete(auditEscalationRules).where(inArray(auditEscalationRules.organizationId, createdOrgIds));
  await db.delete(lessonEscalationInstances).where(inArray(lessonEscalationInstances.organizationId, createdOrgIds));
  await db.delete(lessonEscalationRules).where(inArray(lessonEscalationRules.organizationId, createdOrgIds));
  await db.delete(escalationInstances).where(inArray(escalationInstances.organizationId, createdOrgIds));
  await db.delete(escalationRules).where(inArray(escalationRules.organizationId, createdOrgIds));
  await db.delete(evidenceFiles).where(inArray(evidenceFiles.organizationId, createdOrgIds));
  await db.delete(auditEvidenceFiles).where(inArray(auditEvidenceFiles.organizationId, createdOrgIds));
  await db.delete(correctiveActionReports).where(inArray(correctiveActionReports.organizationId, createdOrgIds));
  await db.delete(auditFindings).where(inArray(auditFindings.organizationId, createdOrgIds));
  await db.delete(audits).where(inArray(audits.organizationId, createdOrgIds));
  await db.delete(lessonLearnedForms).where(inArray(lessonLearnedForms.organizationId, createdOrgIds));
  await db.delete(qualityAssessmentBriefs).where(inArray(qualityAssessmentBriefs.organizationId, createdOrgIds));
  await db.delete(qaqcMetricEntries).where(inArray(qaqcMetricEntries.organizationId, createdOrgIds));
  await db.delete(auditSchedules).where(inArray(auditSchedules.organizationId, createdOrgIds));
  await db.delete(userWorkspaceRoles).where(inArray(userWorkspaceRoles.organizationId, createdOrgIds));
  await db.delete(workspaceRolePermissions).where(inArray(workspaceRolePermissions.organizationId, createdOrgIds));
  await db.delete(permissions).where(inArray(permissions.organizationId, createdOrgIds));
  await db.delete(workspaceRoles).where(inArray(workspaceRoles.organizationId, createdOrgIds));
  await db.delete(lessonsUserWorkspaceRoles).where(inArray(lessonsUserWorkspaceRoles.organizationId, createdOrgIds));
  await db.delete(lessonsWorkspaceRolePermissions).where(inArray(lessonsWorkspaceRolePermissions.organizationId, createdOrgIds));
  await db.delete(lessonsPermissions).where(inArray(lessonsPermissions.organizationId, createdOrgIds));
  await db.delete(lessonsWorkspaceRoles).where(inArray(lessonsWorkspaceRoles.organizationId, createdOrgIds));
  await db.delete(auditUserWorkspaceRoles).where(inArray(auditUserWorkspaceRoles.organizationId, createdOrgIds));
  await db.delete(auditWorkspaceRolePermissions).where(inArray(auditWorkspaceRolePermissions.organizationId, createdOrgIds));
  await db.delete(auditPermissions).where(inArray(auditPermissions.organizationId, createdOrgIds));
  await db.delete(auditWorkspaceRoles).where(inArray(auditWorkspaceRoles.organizationId, createdOrgIds));
  await db.delete(projects).where(inArray(projects.organizationId, createdOrgIds));
  await db.delete(users).where(inArray(users.organizationId, createdOrgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, createdOrgIds));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
});

describe("Task 13 project-scoped assignments", () => {
  it("rejects empty, deleted/inactive, and cross-organization project selections in every app", async () => {
    const cases = [
      ["/qaqc", qaqcRole], ["/lessons", lessonRole], ["/audit", auditRole],
    ] as const;
    const [inactive] = await db.insert(projects).values({ organizationId: orgId, code: `I-${suffix}`, name: "Inactive" }).returning();
    await db.update(projects).set({ status: "inactive" }).where(eq(projects.id, inactive!.id));
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, projectB));
    for (const [prefix, roleId] of cases) {
      for (const scopeIds of [[], [inactive!.id], [foreignProject], [projectB]]) {
        const result = await api("POST", `${prefix}/admin/users/${scoped.id}/roles`, admin.token, { roleId, scopeType: "project", scopeIds });
        expect(result.status, `${prefix} ${scopeIds}: ${JSON.stringify(result.json)}`).toBe(422);
      }
    }
    await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, projectB));
    await db.delete(projects).where(eq(projects.id, inactive!.id));
  });

  it("serializes organization/project scope and unions multiple application roles", async () => {
    const rows = await Promise.all(["/qaqc", "/lessons", "/audit"].map((prefix) =>
      api("GET", `${prefix}/admin/users?limit=100`, admin.token)));
    for (const row of rows) {
      const user = row.json.items.find((x: any) => x.id === scoped.id);
      expect(user.workspaceRoles).toEqual(expect.arrayContaining([
        expect.objectContaining({ scopeType: "project", scopeIds: expect.any(Array) }),
      ]));
    }
    const scope = await getPlatformEffectiveProjectScope(scoped.id, orgId);
    expect(scope.unrestricted).toBe(false);
    expect(scope.projectIds.sort()).toEqual([projectA, projectB].sort());
    const organizationAssignment = await api("POST", `/lessons/admin/users/${scoped.id}/roles`, admin.token, {
      roleId: lessonRole, scopeType: "organization", scopeIds: [],
    });
    expect(organizationAssignment.status).toBe(200);
    expect((await getPlatformEffectiveProjectScope(scoped.id, orgId)).unrestricted).toBe(true);
    const restored = await api("POST", `/lessons/admin/users/${scoped.id}/roles`, admin.token, {
      roleId: lessonRole, scopeType: "project", scopeIds: [projectA],
    });
    expect(restored.status).toBe(200);
  });

  it("filters project choices and denies out-of-scope writes while platform admins bypass", async () => {
    const reference = await api("GET", "/lessons/reference-data", scoped.token);
    expect(reference.status).toBe(200);
    expect(reference.json.projects.map((p: any) => p.id)).toEqual([projectA]);
    expect((await api("POST", "/lessons/forms", scoped.token, { projectId: "00000000-0000-0000-0000-000000000000" })).status).toBe(403);
    expect((await api("POST", "/qaqc/metrics", scoped.token, { projectId: "00000000-0000-0000-0000-000000000000" })).status).toBe(403);
    expect((await api("POST", "/audit/schedules", scoped.token, { projectId: "00000000-0000-0000-0000-000000000000" })).status).toBe(403);
    expect((await api("GET", "/lessons/reference-data", admin.token)).status).toBe(200);
  });

  it("rejects out-of-scope report filters and keeps scoped list/report routes available", async () => {
    for (const path of [
      `/qaqc/pqi?projectId=${projectB}`,
      `/qaqc/reports/monthly?projectId=${projectB}`,
      `/qaqc/reports/document-governance?projectId=${projectB}`,
      `/audit/dashboard?projectId=${projectA}`,
      `/audit/reports/open-vs-closed?projectId=${projectA}`,
      `/audit/reports/findings-log?projectId=${projectA}`,
      `/audit/reports/ageing?projectId=${projectA}`,
      `/audit/reports/car-status?projectId=${projectA}`,
    ]) {
      const result = await api("GET", path, scoped.token);
      expect(result.status, `${path}: ${JSON.stringify(result.json)}`).toBe(403);
    }
    for (const path of ["/audit/reports/schedule"]) {
      const result = await api("GET", path, scoped.token);
      expect(result.status, `${path}: ${JSON.stringify(result.json)}`).toBe(200);
    }
    expect((await api("GET", "/audit/reports/findings-log", scoped.token)).status).toBe(403);
  });

  it("does not combine a privileged role's permissions with another role's broader project scope", async () => {
    await insertAppRole("qaqc", "Task 13 editor A", scoped.id, [projectA], "create_edit");
    await insertAppRole("qaqc", "Task 13 reader org", scoped.id, [], "view_own");

    const denied = await api("POST", "/qaqc/metrics", scoped.token, { projectId: projectB });
    expect(denied.status).toBe(403);
  });

  it("keeps application administrator roles bounded by their assigned projects", async () => {
    const appAdmin = await insertUser("task13.scoped-app-admin", orgId);
    const outsideUser = await insertUser("task13.outside-admin-target", orgId);
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: appAdmin.username, canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true,
    });
    for (const appName of ["qaqc", "lessons", "audit"] as const) {
      const adminRole = await insertAppRole(appName, `Task 13 ${appName} Administrator`, appAdmin.id, [projectA]);
      await insertAppRole(appName, `Task 13 ${appName} outside reader`, outsideUser.id, [projectB]);
      const scope = await getEffectiveProjectScope(appAdmin.id, orgId, appName);
      expect(scope).toEqual({ unrestricted: false, projectIds: [projectA] });
      const prefix = appName === "lessons" ? "/lessons" : appName === "audit" ? "/audit" : "/qaqc";
      const usersPage = await api("GET", `${prefix}/admin/users?limit=100`, appAdmin.token);
      expect(usersPage.status).toBe(200);
      expect(usersPage.json.items.map((item: { id: string }) => item.id)).not.toContain(outsideUser.id);
      expect((await api("POST", `${prefix}/admin/users/${outsideUser.id}/roles`, appAdmin.token, {
        roleId: adminRole, scopeType: "organization", scopeIds: [],
      })).status).toBe(403);
      expect((await api("POST", `${prefix}/admin/users/${outsideUser.id}/roles`, appAdmin.token, {
        roleId: adminRole, scopeType: "project", scopeIds: [projectB],
      })).status).toBe(403);
    }
    expect((await api("POST", "/qaqc/metrics", appAdmin.token, { projectId: projectB })).status).toBe(403);
    expect((await api("POST", "/lessons/forms", appAdmin.token, { projectId: projectB })).status).toBe(403);
    expect((await api("POST", "/audit/schedules", appAdmin.token, { projectId: projectB })).status).toBe(403);

    const qaqcOnlyAdmin = await insertUser("task13.qaqc-only-admin", orgId);
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: qaqcOnlyAdmin.username, canOpenQaqc: true, canOpenAudit: true,
    });
    await insertAppRole("qaqc", "Task 13 isolated QAQC Administrator", qaqcOnlyAdmin.id, [projectA]);
    expect((await api("GET", "/audit/admin/users", qaqcOnlyAdmin.token)).status).toBe(403);
    expect((await api("PUT", `/platform/users/${admin.id}/temporary-password`, appAdmin.token, {
      password: "Temporary-Password-123!",
    })).status).toBe(403);
  });

  it("keeps full and own Lessons visibility separate per project", async () => {
    const reader = await insertUser("task13.mixed-lesson-reader", orgId);
    const author = await insertUser("task13.mixed-lesson-author", orgId);
    await db.insert(applicationAccess).values({ organizationId: orgId, username: reader.username, canOpenLessons: true });
    await insertAppRole("lessons", "Task 13 full reader A", reader.id, [projectA], "lessons.view_all");
    await insertAppRole("lessons", "Task 13 own reader B", reader.id, [projectB], "lessons.view_own");
    const [otherA, otherB, ownB] = await db.insert(lessonLearnedForms).values([
      { organizationId: orgId, projectId: projectA, referenceNumber: `MIX-A-${suffix}`, title: "Other A", issueCategory: "Minor", impact: "Positive", creatorId: author.id },
      { organizationId: orgId, projectId: projectB, referenceNumber: `MIX-B-${suffix}`, title: "Other B", issueCategory: "Minor", impact: "Positive", creatorId: author.id },
      { organizationId: orgId, projectId: projectB, referenceNumber: `MIX-OWN-${suffix}`, title: "Own B", issueCategory: "Minor", impact: "Positive", creatorId: reader.id },
    ]).returning();

    const response = await api("GET", "/lessons/forms?limit=100", reader.token);
    expect(response.status).toBe(200);
    const ids = response.json.items.map((item: any) => item.id);
    expect(ids).toEqual(expect.arrayContaining([otherA!.id, ownB!.id]));
    expect(ids).not.toContain(otherB!.id);
  });

  it("validates replacement Audit schedule projects against both role scope and organization tenancy", async () => {
    await insertAppRole("audit", "Task 13 schedule editor A", scoped.id, [projectA], "create_edit");
    await insertAppRole("audit", "Task 13 schedule reader org", scoped.id, [], "view_own");
    const [schedule] = await db.insert(auditSchedules).values({
      organizationId: orgId,
      projectId: projectA,
      year: 2026,
      title: "Scoped schedule",
      ownerId: scoped.id,
      status: JSON.stringify({ projectIds: [projectA], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-31" }),
    }).returning();
    const updateBody = {
      id: schedule!.id, year: 2026, title: "Scoped schedule", projectIds: [projectB],
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-31", workflowState: "Draft",
    };

    const denied = await api("PUT", `/audit/schedules/${schedule!.id}`, scoped.token, updateBody);
    expect(denied.status).toBe(403);
    expect(denied.json?.error).toMatch(/every selected project/i);

    const emptyUpdate = await api("PUT", `/audit/schedules/${schedule!.id}`, scoped.token, { ...updateBody, projectIds: [] });
    expect(emptyUpdate.status).toBe(422);
    expect(emptyUpdate.json?.error).toMatch(/at least one project/i);
    const emptyCreate = await api("POST", "/audit/schedules", scoped.token, { ...updateBody, id: crypto.randomUUID(), projectIds: [] });
    expect(emptyCreate.status).toBe(422);
    expect(emptyCreate.json?.error).toMatch(/at least one project/i);

    const foreign = await api("PUT", `/audit/schedules/${schedule!.id}`, admin.token, { ...updateBody, projectIds: [foreignProject] });
    expect(foreign.status).toBe(422);
    expect(foreign.json?.error).toMatch(/active and belong to this organization/i);
  });

  it("protects QA/QC evidence list, confirmation, and deletion through the parent project", async () => {
    const evidenceUser = await insertUser("task13.evidence", orgId);
    await db.insert(applicationAccess).values({ organizationId: orgId, username: evidenceUser.username, canOpenQaqc: true });
    await insertAppRole("qaqc", "Task 13 evidence reader A", evidenceUser.id, [projectA], "metrics.view_own");
    await insertAppRole("qaqc", "Task 13 evidence editor A", evidenceUser.id, [projectA], "metrics.create_edit");
    const [metricA, metricB] = await db.insert(qaqcMetricEntries).values([
      { organizationId: orgId, projectId: projectA, reportingPeriod: "2026-09-01", category: "Evidence A" },
      { organizationId: orgId, projectId: projectB, reportingPeriod: "2026-09-01", category: "Evidence B" },
    ]).returning();
    await db.insert(auditLogEntries).values([metricA!, metricB!].map(metric => ({
      organizationId: orgId, actorId: evidenceUser.id, action: "create", entityType: "metric", entityId: metric.id,
    })));
    const evidenceValues = (recordId: string, label: string) => ({
      organizationId: orgId, recordType: "metric", recordId, category: "photo",
      fileName: `${label}.jpg`, mimeType: "image/jpeg", sizeBytes: 100,
      storageKey: `${suffix}/${label}.jpg`, uploadedById: evidenceUser.id,
    });
    const [allowed, deniedConfirm, deniedDelete] = await db.insert(evidenceFiles).values([
      evidenceValues(metricA!.id, "allowed"),
      evidenceValues(metricB!.id, "denied-confirm"),
      evidenceValues(metricB!.id, "denied-delete"),
    ]).returning();

    expect((await api("GET", `/qaqc/evidence?recordType=metric&recordId=${metricB!.id}`, evidenceUser.token)).status).toBe(404);
    expect((await api("PUT", `/qaqc/evidence/${deniedConfirm!.id}/confirm`, evidenceUser.token)).status).toBe(404);
    expect((await api("DELETE", `/qaqc/evidence/${deniedDelete!.id}`, evidenceUser.token)).status).toBe(404);

    expect((await api("GET", `/qaqc/evidence?recordType=metric&recordId=${metricA!.id}`, evidenceUser.token)).status).toBe(200);
    expect((await api("PUT", `/qaqc/evidence/${allowed!.id}/confirm`, evidenceUser.token)).status).toBe(200);
    expect((await api("DELETE", `/qaqc/evidence/${allowed!.id}`, evidenceUser.token)).status).toBe(204);

    expect((await api("GET", `/qaqc/evidence?recordType=metric&recordId=${metricB!.id}`, admin.token)).status).toBe(200);
    expect((await api("PUT", `/qaqc/evidence/${deniedConfirm!.id}/confirm`, admin.token)).status).toBe(200);
    expect((await api("DELETE", `/qaqc/evidence/${deniedDelete!.id}`, admin.token)).status).toBe(204);
  });

  it("requires evidence permissions from the authoritative parent module", async () => {
    const user = await insertUser("task13.evidence-capability", orgId);
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: user.username, canOpenQaqc: true, canOpenAudit: true,
    });
    await insertAppRole("qaqc", "Task 13 metric evidence only", user.id, [projectA], "metrics.view_all");
    await insertAppRole("audit", "Task 13 audit evidence only", user.id, [projectA], "audits.view_all");

    const [metric] = await db.insert(qaqcMetricEntries).values({
      organizationId: orgId, projectId: projectA, reportingPeriod: "2027-01-01", category: "Evidence capability",
    }).returning();
    const [brief] = await db.insert(qualityAssessmentBriefs).values({
      organizationId: orgId, projectId: projectA, reportingPeriod: "2027-01-01",
    }).returning();
    expect((await api("GET", `/qaqc/evidence?recordType=metric&recordId=${metric!.id}`, user.token)).status).toBe(200);
    expect((await api("GET", `/qaqc/evidence?recordType=quality_brief&recordId=${brief!.id}`, user.token)).status).toBe(403);

    const [audit] = await db.insert(audits).values({
      organizationId: orgId, projectId: projectA, referenceNumber: `EVID-${suffix}`,
    }).returning();
    const [finding] = await db.insert(auditFindings).values({
      organizationId: orgId, auditId: audit!.id, classification: "Observation",
    }).returning();
    expect((await api("GET", `/audit/evidence?recordType=audit&recordId=${audit!.id}`, user.token)).status).toBe(200);
    expect((await api("GET", `/audit/evidence?recordType=finding&recordId=${finding!.id}`, user.token)).status).toBe(403);
  });

  it("supports schedule attachments while preserving schedule permission and project scope", async () => {
    const editor = await insertUser("task13.schedule-evidence", orgId);
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: editor.username, canOpenAudit: true,
    });
    await insertAppRole("audit", "Task 13 schedule evidence editor", editor.id, [projectA], "create_edit");
    await insertAppRole("audit", "Task 13 schedule evidence viewer", editor.id, [projectA], "view_all");
    const [allowedSchedule, deniedSchedule] = await db.insert(auditSchedules).values([
      {
        organizationId: orgId, projectId: projectA, year: 2027, title: "Allowed schedule evidence",
        status: JSON.stringify({ projectIds: [projectA] }),
      },
      {
        organizationId: orgId, projectId: projectB, year: 2027, title: "Denied schedule evidence",
        status: JSON.stringify({ projectIds: [projectB] }),
      },
    ]).returning();
    const intentBody = (recordId: string, clientReference: string) => ({
      recordType: "audit_schedule", recordId, category: "l1-review",
      fileName: "review.pdf", mimeType: "application/pdf", sizeBytes: 1024, clientReference,
    });

    const allowed = await api("POST", "/audit/evidence", editor.token, intentBody(allowedSchedule!.id, `allowed-${suffix}`));
    expect(allowed.status).toBe(201);
    const upload = await fetch(`${baseUrl}/files/${allowed.json.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${editor.token}`, "content-type": "application/pdf" },
      body: Buffer.alloc(1024),
    });
    expect(upload.status).toBe(200);
    expect((await api("PUT", `/audit/evidence/${allowed.json.id}/confirm`, editor.token)).status).toBe(200);
    const listed = await api("GET", `/audit/evidence?recordType=audit_schedule&recordId=${allowedSchedule!.id}`, editor.token);
    expect(listed.status).toBe(200);
    expect(listed.json.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: allowed.json.id, recordType: "audit_schedule", recordId: allowedSchedule!.id }),
    ]));

    expect((await api("POST", "/audit/evidence", editor.token, intentBody(deniedSchedule!.id, `denied-${suffix}`))).status).toBe(403);
    expect((await api("GET", `/audit/evidence?recordType=audit_schedule&recordId=${deniedSchedule!.id}`, editor.token)).status).toBe(403);
  });

  it("rejects out-of-scope rows in QA/QC metric imports", async () => {
    const importUser = await insertUser("task13.import", orgId);
    await db.insert(applicationAccess).values({ organizationId: orgId, username: importUser.username, canOpenQaqc: true });
    await insertAppRole("qaqc", "Task 13 importer A", importUser.id, [projectA], "metrics.create_edit");
    await insertAppRole("qaqc", "Explicit QA/QC import", importUser.id, [projectA], "qaqc.metrics.import");
    const row = (projectId: string, category: "External NCR" | "Internal NCR") => ({
      id: crypto.randomUUID(), projectId, period: "2026-10", category,
      issuedCount: 1, closedCount: 0, ageing0To15: 1, ageing15To45: 0, ageingOver45: 0,
      workflowState: "Draft",
    });

    const result = await api("POST", "/qaqc/metrics/import", importUser.token, [
      row(projectA, "External NCR"),
      row(projectB, "Internal NCR"),
    ]);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ created: 1, rejected: 1 });
    expect(result.json.errors[0].error).toMatch(/access to this project/i);
    const projectBRows = await db.select().from(qaqcMetricEntries).where(and(
      eq(qaqcMetricEntries.organizationId, orgId),
      eq(qaqcMetricEntries.projectId, projectB),
      eq(qaqcMetricEntries.reportingPeriod, "2026-10-01"),
      eq(qaqcMetricEntries.category, "Internal NCR"),
    ));
    expect(projectBRows).toHaveLength(0);
  });

  it("filters QA/QC approval queues to assigned projects", async () => {
    const approvalUser = await insertUser("task13.approvals", orgId);
    await db.insert(applicationAccess).values({ organizationId: orgId, username: approvalUser.username, canOpenQaqc: true });
    await insertAppRole("qaqc", "Task 13 approvals A", approvalUser.id, [projectA], "metrics.view_all");
    await insertAppRole("qaqc", "Task 13 brief approvals A", approvalUser.id, [projectA], "quality_briefs.view_all");
    await insertAppRole("qaqc", "Explicit QA/QC review", approvalUser.id, [projectA], "approve_reject");
    const [metricA, metricB] = await db.insert(qaqcMetricEntries).values([
      { organizationId: orgId, projectId: projectA, reportingPeriod: "2026-11-01", category: "Approval A", status: "submitted" },
      { organizationId: orgId, projectId: projectB, reportingPeriod: "2026-11-01", category: "Approval B", status: "submitted" },
    ]).returning();
    const [briefA, briefB] = await db.insert(qualityAssessmentBriefs).values([
      { organizationId: orgId, projectId: projectA, reportingPeriod: "2026-11-01", workflowState: "submitted" },
      { organizationId: orgId, projectId: projectB, reportingPeriod: "2026-11-01", workflowState: "submitted" },
    ]).returning();

    const scopedQueue = await api("GET", "/qaqc/approvals?limit=100", approvalUser.token);
    expect(scopedQueue.status).toBe(200);
    const scopedIds = scopedQueue.json.items.map((item: any) => item.recordId);
    expect(scopedIds).toEqual(expect.arrayContaining([metricA!.id, briefA!.id]));
    expect(scopedIds).not.toEqual(expect.arrayContaining([metricB!.id, briefB!.id]));

    const adminQueue = await api("GET", "/qaqc/approvals?limit=100", admin.token);
    expect(adminQueue.status).toBe(200);
    expect(adminQueue.json.items.map((item: any) => item.recordId)).toEqual(
      expect.arrayContaining([metricA!.id, metricB!.id, briefA!.id, briefB!.id]),
    );
  });

  it("filters Lessons exports and all escalation queues by parent project", async () => {
    const reader = await insertUser("task13.scoped-exports", orgId);
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: reader.username, canOpenQaqc: true, canOpenLessons: true, canOpenAudit: true,
    });
    await insertAppRole("qaqc", "Task 13 escalation reader A", reader.id, [projectA], "quality_briefs.view_all");
    await insertAppRole("lessons", "Task 13 export reader A", reader.id, [projectA], "lessons.view_all");
    await insertAppRole("audit", "Task 13 audit escalation reader A", reader.id, [projectA], "findings.view_all");
    await insertAppRole("audit", "Task 13 audit CAR escalation reader A", reader.id, [projectA], "cars.view_all");

    const [lessonA, lessonB] = await db.insert(lessonLearnedForms).values([
      { organizationId: orgId, projectId: projectA, referenceNumber: `LL-A-${suffix}`, title: "Visible lesson", issueCategory: "Minor", impact: "Positive", creatorId: reader.id },
      { organizationId: orgId, projectId: projectB, referenceNumber: `LL-B-${suffix}`, title: "Hidden lesson", issueCategory: "Minor", impact: "Positive", creatorId: reader.id },
    ]).returning();
    const exported = await api("GET", "/lessons/reports/log?format=json", reader.token);
    expect(exported.status).toBe(200);
    const exportedLessons = JSON.parse(decodeURIComponent(exported.json.downloadUrl.split(",")[1]));
    expect(exportedLessons.map((item: any) => item.id)).toContain(lessonA!.id);
    expect(exportedLessons.map((item: any) => item.id)).not.toContain(lessonB!.id);

    const [briefA, briefB] = await db.insert(qualityAssessmentBriefs).values([
      { organizationId: orgId, projectId: projectA, reportingPeriod: "2026-12-01", workflowState: "submitted" },
      { organizationId: orgId, projectId: projectB, reportingPeriod: "2026-12-01", workflowState: "submitted" },
    ]).returning();
    const [qaqcRule] = await db.insert(escalationRules).values({
      organizationId: orgId, triggerKey: "approval_delay", priority: "P2", slaWorkingDays: 2, recipientRole: "Quality Manager",
    }).returning();
    const [qaqcEscA, qaqcEscB] = await db.insert(escalationInstances).values([
      { organizationId: orgId, recordType: "quality_brief", recordId: briefA!.id, ruleId: qaqcRule!.id },
      { organizationId: orgId, recordType: "quality_brief", recordId: briefB!.id, ruleId: qaqcRule!.id },
    ]).returning();

    const [lessonRule] = await db.insert(lessonEscalationRules).values({
      organizationId: orgId, triggerKey: "lesson_sla", priority: "P1", slaWorkingDays: 2, recipientRole: "Lessons Manager",
    }).returning();
    const [lessonEscA, lessonEscB] = await db.insert(lessonEscalationInstances).values([
      { organizationId: orgId, recordType: "lesson", recordId: lessonA!.id, ruleId: lessonRule!.id },
      { organizationId: orgId, recordType: "lesson", recordId: lessonB!.id, ruleId: lessonRule!.id },
    ]).returning();

    const [auditA, auditB] = await db.insert(audits).values([
      { organizationId: orgId, projectId: projectA, referenceNumber: `AUD-A-${suffix}` },
      { organizationId: orgId, projectId: projectB, referenceNumber: `AUD-B-${suffix}` },
    ]).returning();
    const [findingA, findingB] = await db.insert(auditFindings).values([
      { organizationId: orgId, auditId: auditA!.id, classification: "Observation" },
      { organizationId: orgId, auditId: auditB!.id, classification: "Observation" },
    ]).returning();
    const [carA, carB] = await db.insert(correctiveActionReports).values([
      { organizationId: orgId, auditFindingId: findingA!.id, responsibleDepartment: "Quality" },
      { organizationId: orgId, auditFindingId: findingB!.id, responsibleDepartment: "Quality" },
    ]).returning();
    const [auditRule] = await db.insert(auditEscalationRules).values({
      organizationId: orgId, triggerKey: "approval_delay", priority: "P2", slaWorkingDays: 2, recipientRole: "Audit Manager",
    }).returning();
    const [findingEscA, findingEscB, carEscA, carEscB] = await db.insert(auditEscalationInstances).values([
      { organizationId: orgId, recordType: "audit_finding", recordId: findingA!.id, ruleId: auditRule!.id },
      { organizationId: orgId, recordType: "audit_finding", recordId: findingB!.id, ruleId: auditRule!.id },
      { organizationId: orgId, recordType: "corrective_action", recordId: carA!.id, ruleId: auditRule!.id },
      { organizationId: orgId, recordType: "corrective_action", recordId: carB!.id, ruleId: auditRule!.id },
    ]).returning();

    const assertScopedQueue = async (path: string, visible: string[], hidden: string[]) => {
      const response = await api("GET", path, reader.token);
      expect(response.status).toBe(200);
      const ids = response.json.items.map((item: any) => item.id);
      expect(ids).toEqual(expect.arrayContaining(visible));
      expect(ids).not.toEqual(expect.arrayContaining(hidden));
      expect(response.json.total).toBe(visible.length);
    };
    await assertScopedQueue("/qaqc/escalations?limit=100", [qaqcEscA!.id], [qaqcEscB!.id]);
    await assertScopedQueue("/lessons/escalations?limit=100", [lessonEscA!.id], [lessonEscB!.id]);
    await assertScopedQueue("/audit/escalations?limit=100", [findingEscA!.id, carEscA!.id], [findingEscB!.id, carEscB!.id]);

    for (const [path, hiddenIds] of [
      ["/qaqc/escalations?limit=100", [qaqcEscB!.id]],
      ["/lessons/escalations?limit=100", [lessonEscB!.id]],
      ["/audit/escalations?limit=100", [findingEscB!.id, carEscB!.id]],
    ] as const) {
      const response = await api("GET", path, admin.token);
      expect(response.json.items.map((item: any) => item.id)).toEqual(expect.arrayContaining(hiddenIds));
    }
  });
});