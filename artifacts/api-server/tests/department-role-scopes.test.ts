import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db, organizations, platformRoles, users, projects, masterDataGroups, masterDataValues,
  workspaceRoles, userWorkspaceRoles, permissions, workspaceRolePermissions, auditLogEntries,
  auditWorkspaceRoles, auditUserWorkspaceRoles, auditPermissions, auditWorkspaceRolePermissions, auditAuditLogEntries,
  lessonsWorkspaceRoles, lessonsUserWorkspaceRoles, lessonsPermissions, lessonsWorkspaceRolePermissions, lessonsAuditLogEntries,
  auditSchedules, auditPlans, audits, auditFindings, correctiveActionReports, auditEvidenceFiles, outboundEmails,
} from "@workspace/db";
import { issueToken } from "../src/lib/auth";
import { getAuthorizedProjectScope, getEffectiveProjectScope, getRoleBasedApplicationAccess, restrictScope } from "../src/middlewares/rbac";
import { auditDepartmentId, intersectAuditScopes, processDepartmentAllowed } from "../src/lib/audit-department-scope";
import { monthlyApprovalStages } from "../src/lib/qaqc-monthly-approval";
import platformRouter from "../src/routes/platform";
import auditRouter from "../src/routes/audit";
import qaqcRouter from "../src/routes/qaqc";
import lessonsRouter from "../src/routes/lessons";
import filesRouter from "../src/routes/files";

const org = randomUUID(), foreign = randomUUID();
const appTables = [
  { key: "audit", roles: auditWorkspaceRoles, assignments: auditUserWorkspaceRoles, permissions: auditPermissions, grants: auditWorkspaceRolePermissions, logs: auditAuditLogEntries },
  { key: "qaqc", roles: workspaceRoles, assignments: userWorkspaceRoles, permissions, grants: workspaceRolePermissions, logs: auditLogEntries },
  { key: "lessons", roles: lessonsWorkspaceRoles, assignments: lessonsUserWorkspaceRoles, permissions: lessonsPermissions, grants: lessonsWorkspaceRolePermissions, logs: lessonsAuditLogEntries },
] as const;
let server: Server, base: string;
let adminToken: string, userToken: string, restrictedToken: string, noLessonsToken: string;
let user: typeof users.$inferSelect, restricted: typeof users.$inferSelect;
let departmentA: string, departmentB: string, inactive: string, foreignDepartment: string, projectId: string;
const roleIds: Record<string, string> = {};
const outsideRoleIds: Record<string, string> = {};
const records: Array<{ schedule: string; plan: string; audit: string; finding: string; car: string; evidence: string }> = [];
const evidenceFile = `department-scope-${org}.txt`;
async function request(method: string, path: string, token = adminToken, data?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method, headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json",
  }, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
beforeAll(async () => {
  vi.stubEnv("AUTH_STRATEGY", "local");
  await mkdir(path.resolve("uploads"), { recursive: true });
  await writeFile(path.resolve("uploads", evidenceFile), "test");
  await db.insert(organizations).values([{ id: org, name: "Department scope regression", code: org }, { id: foreign, name: "Other tenant", code: foreign }]);
  const [platformAdmin] = await db.insert(platformRoles).values({ organizationId: org, name: "Super Admin" }).returning();
  const people = await db.insert(users).values([
    { organizationId: org, username: `dept-admin-${org}`, email: `dept-admin-${org}@example.test`, fullName: "Department Test Admin", platformRoleId: platformAdmin!.id },
    { organizationId: org, username: `dept-user-${org}`, email: `dept-user-${org}@example.test`, fullName: "Department Test User" },
    { organizationId: org, username: `dept-restricted-${org}`, email: `dept-restricted-${org}@example.test`, fullName: "Restricted Department Administrator" },
    { organizationId: org, username: `dept-no-lessons-${org}`, email: `dept-no-lessons-${org}@example.test`, fullName: "Administrator without Lessons access" },
  ]).returning();
  user = people[1]!; restricted = people[2]!;
  adminToken = issueToken(people[0]!); userToken = issueToken(user); restrictedToken = issueToken(restricted);
  noLessonsToken = issueToken(people[3]!);
  const groups = await db.insert(masterDataGroups).values([
    { organizationId: org, code: "departments", name: "Department Master" },
    { organizationId: foreign, code: "departments", name: "Department Master" },
  ]).returning();
  const departments = await db.insert(masterDataValues).values([
    { organizationId: org, groupId: groups[0]!.id, value: "ENGINEERING", label: "Engineering" },
    { organizationId: org, groupId: groups[0]!.id, value: "SAFETY", label: "Safety" },
    { organizationId: org, groupId: groups[0]!.id, value: "INACTIVE", label: "Inactive", active: false },
    { organizationId: foreign, groupId: groups[1]!.id, value: "FOREIGN", label: "Foreign" },
  ]).returning();
  [departmentA, departmentB, inactive, foreignDepartment] = departments.map(row => row.id) as [string, string, string, string];
  const [project] = await db.insert(projects).values({ organizationId: org, code: org, name: "Project separate from departments" }).returning();
  projectId = project!.id;
  for (const app of appTables) {
    const roles = await db.insert(app.roles).values([
      { organizationId: org, name: "Scoped reader" },
      { organizationId: org, name: "Department Administrator" },
      { organizationId: org, name: "Outside assignment" },
    ]).returning();
    roleIds[app.key] = roles[0]!.id; outsideRoleIds[app.key] = roles[2]!.id;
    const keys = app.key === "audit"
      ? ["audit.schedules.view_all", "audit.plans.view_all", "audit.audits.view_all", "audit.findings.view_all", "audit.cars.view_all", "audit.audits.export", "audit.cars.export"]
      : app.key === "qaqc" ? ["qaqc.metrics.view_all", "qaqc.manage_roles"] : ["view_all"];
    const perms = await db.insert(app.permissions).values(keys.map(key => ({ organizationId: org, key, label: key, category: app.key }))).returning();
    await db.insert(app.grants).values(perms.map(permission => ({ organizationId: org, workspaceRoleId: roles[0]!.id, permissionId: permission.id, grant: "full" })));
    if (app.key === "qaqc") await db.insert(app.grants).values({ organizationId: org, workspaceRoleId: roles[1]!.id, permissionId: perms[1]!.id, grant: "full" });
    await db.insert(app.assignments).values([
      { organizationId: org, userId: user.id, workspaceRoleId: roles[0]!.id, departmentIds: [departmentA] },
      { organizationId: org, userId: restricted.id, workspaceRoleId: roles[1]!.id, departmentIds: [departmentA] },
      { organizationId: org, userId: user.id, workspaceRoleId: roles[2]!.id, departmentIds: [departmentB] },
    ]);
    if (app.key !== "lessons") await db.insert(app.assignments).values({
      organizationId: org, userId: people[3]!.id, workspaceRoleId: roles[1]!.id, departmentIds: [departmentA],
    });
  }
  for (const code of ["ENGINEERING", "SAFETY", "unknown historical department"]) {
    const [schedule] = await db.insert(auditSchedules).values({ organizationId: org, year: 2026, title: code,
      status: JSON.stringify({ auditTypes: ["Quality Internal Process Audit"], departmentProject: code }) }).returning();
    const [plan] = await db.insert(auditPlans).values({ organizationId: org, auditScheduleId: schedule!.id, scope: code }).returning();
    const [audit] = await db.insert(audits).values({ organizationId: org, auditPlanId: plan!.id, referenceNumber: `D-${randomUUID()}` }).returning();
    const [finding] = await db.insert(auditFindings).values({ organizationId: org, auditId: audit!.id, classification: "Minor NC", description: code }).returning();
    const [car] = await db.insert(correctiveActionReports).values({ organizationId: org, auditFindingId: finding!.id, responsibleDepartment: code }).returning();
    const [evidence] = await db.insert(auditEvidenceFiles).values({ organizationId: org, recordType: "audit", recordId: audit!.id,
      category: "attachment", fileName: "scope.txt", mimeType: "text/plain", sizeBytes: 4, status: "stored", storageKey: `local:${evidenceFile}`, uploadedById: user.id }).returning();
    records.push({ schedule: schedule!.id, plan: plan!.id, audit: audit!.id, finding: finding!.id, car: car!.id, evidence: evidence!.id });
  }
  const app = express(); app.use(express.json());
  app.use("/api", platformRouter); app.use("/api/audit", auditRouter); app.use("/api/qaqc", qaqcRouter); app.use("/api/lessons", lessonsRouter); app.use("/api/files", filesRouter);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 30000);
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await unlink(path.resolve("uploads", evidenceFile)).catch(() => {});
  for (const table of [auditEvidenceFiles, correctiveActionReports, auditFindings, audits, auditPlans, auditSchedules]) await db.delete(table).where(eq(table.organizationId, org));
  for (const app of appTables) {
    for (const table of [app.logs, app.assignments, app.grants, app.roles, app.permissions]) await db.delete(table).where(eq(table.organizationId, org));
  }
  for (const table of [outboundEmails, users, projects, platformRoles, masterDataValues, masterDataGroups]) await db.delete(table).where(inArray(table.organizationId, [org, foreign]));
  await db.delete(organizations).where(inArray(organizations.id, [org, foreign]));
  vi.unstubAllEnvs();
}, 30000);

describe("department role lifecycle in all applications", () => {
  for (const app of appTables) {
    it(`${app.key}: saves, deduplicates, serializes and switches scopes`, async () => {
      const path = `/${app.key}/admin/users/${user.id}/roles`;
      expect((await request("POST", path, adminToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds: [departmentA, departmentA] })).status).toBe(200);
      const list = await request("GET", `/${app.key}/admin/users`);
      const saved = list.body.items.find((row: any) => row.id === user.id).workspaceRoles.find((row: any) => row.id === roleIds[app.key]);
      expect(saved).toMatchObject({ scopeType: "department", scopeIds: [departmentA] });
      const [stored] = await db.select().from(app.assignments).where(eq(app.assignments.workspaceRoleId, roleIds[app.key]!));
      expect(stored!.departmentIds).toEqual([departmentA]); expect(stored!.projectIds).toEqual([]);
      expect((await request("POST", path, adminToken, { roleId: roleIds[app.key], scopeType: "project", scopeIds: [projectId] })).status).toBe(200);
      const [projectScope] = await db.select().from(app.assignments).where(eq(app.assignments.workspaceRoleId, roleIds[app.key]!));
      expect(projectScope!.departmentIds).toEqual([]); expect(projectScope!.projectIds).toEqual([projectId]);
      expect((await request("POST", path, adminToken, { roleId: roleIds[app.key], scopeType: "organization", scopeIds: [] })).status).toBe(200);
      expect((await getEffectiveProjectScope(user.id, org, app.key)).unrestricted).toBe(true);
      await request("POST", path, adminToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds: [departmentA] });
    });
    it(`${app.key}: rejects empty, inactive, foreign and malformed department selections`, async () => {
      for (const scopeIds of [[], [inactive], [foreignDepartment], ["not-a-uuid"]]) {
        const result = await request("POST", `/${app.key}/admin/users/${user.id}/roles`, adminToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds });
        expect(result.status, JSON.stringify(result.body)).toBe(422);
      }
    });
    it(`${app.key}: restricted administrators cannot replace or remove outside assignments`, async () => {
      const path = `/${app.key}/admin/users/${user.id}/roles`;
      expect((await request("POST", path, restrictedToken, { roleId: outsideRoleIds[app.key], scopeType: "department", scopeIds: [departmentA] })).status).toBe(403);
      expect((await request("DELETE", `${path}/${outsideRoleIds[app.key]}`, restrictedToken)).status).toBe(403);
      expect((await request("POST", path, restrictedToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds: [departmentB] })).status).toBe(403);
      expect((await request("POST", path, restrictedToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds: [departmentA] })).status).toBe(200);
    });
    it(`${app.key}: options use canonical IDs and administrative scope`, async () => {
      const options = await request("GET", `/platform/role-assignment-departments?application=${app.key}`, restrictedToken);
      expect(options.status).toBe(200);
      expect(options.body).toEqual([{ id: departmentA, name: "Engineering", code: "ENGINEERING" }]);
    });
    it(`${app.key}: restricted administrators can remove and restore an assignment inside their department`, async () => {
      const path = `/${app.key}/admin/users/${user.id}/roles`;
      expect((await request("DELETE", `${path}/${roleIds[app.key]}`, restrictedToken)).status).toBe(204);
      expect((await request("POST", path, restrictedToken, { roleId: roleIds[app.key], scopeType: "department", scopeIds: [departmentA] })).status).toBe(200);
    });
  }
});
describe("department authorization", () => {
  it("Audit and QA/QC administrators need no Lessons access for Department Master options", async () => {
    expect((await request("GET", "/lessons/reference-data", noLessonsToken)).status).toBe(403);
    for (const application of ["audit", "qaqc"]) {
      const options = await request("GET", `/platform/role-assignment-departments?application=${application}`, noLessonsToken);
      expect(options.status).toBe(200); expect(options.body.map((row: any) => row.id)).toEqual([departmentA]);
    }
  });
  it("department-only roles grant entry without project or organization access", async () => {
    expect(await getRoleBasedApplicationAccess({ ...user, platformRole: "Employee" })).toEqual({ audit: true, qaqc: true, lessons: true });
    const scope = await getAuthorizedProjectScope({ currentUser: { ...user, platformRole: "Employee" } } as any, "audit", { module: "audits", action: "select" });
    expect(scope).toMatchObject({ unrestricted: false, projectIds: [], departmentIds: [departmentA] });
    expect(scope.departmentIds).not.toContain(departmentB); // unrelated role must not supply this capability
    const external = restrictScope({ dronaProjectIds: [] } as any, "audit", scope);
    expect(external.departmentIds).toEqual([departmentA]); expect(external.projectIds).toEqual([]);
  });
  it("QA/QC departments never grant project-based report scope or approval eligibility", async () => {
    const response = await request("GET", "/qaqc/metrics", userToken);
    expect(response.status).toBe(200); expect(response.body.items).toEqual([]);
    expect((await request("POST", "/qaqc/metrics", userToken, { projectId })).status).toBe(403);
    expect(monthlyApprovalStages([{ userId: user.id, name: "Department reviewer", roleId: roleIds.qaqc!, roleName: "Department",
      level: 1, key: "qaqc.monthly_reports.approve_reject", projectIds: [], businessUnitIds: [], departmentIds: [departmentA] }], projectId, restricted.id).stages).toEqual([]);
  });
  it("Audit lists include only the matching resolved Process department", async () => {
    for (const [path, id] of [["schedules", records[0]!.schedule], ["plans", records[0]!.plan], ["audits", records[0]!.audit]]) {
      const result = await request("GET", `/audit/${path}`, userToken);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.items.map((row: any) => row.id)).toEqual([id]);
    }
  });
  it("Audit denies other and unresolved departments through detail, workflow, evidence and exports", async () => {
    for (const record of records.slice(1)) {
      for (const path of [`schedules/${record.schedule}`, `plans/${record.plan}`, `audits/${record.audit}`, `findings/${record.finding}`, `cars/${record.car}`,
        `audits/${record.audit}/report/pdf`, `audits/${record.audit}/report/pptx`, `cars/${record.car}/report.docx`,
        `evidence?recordType=audit&recordId=${record.audit}`]) {
        const response = await request("GET", `/audit/${path}`, userToken);
        expect([403, 404], `${path}: ${JSON.stringify(response.body)}`).toContain(response.status);
      }
      expect((await request("PUT", `/audit/audits/${record.audit}`, userToken, {})).status).toBe(403);
      expect((await request("GET", `/files/${record.evidence}`, userToken)).status).toBe(404);
    }
  });
  it("matching Process records and evidence metadata remain readable", async () => {
    const file = await request("GET", `/files/${records[0]!.evidence}`, userToken);
    expect(file.status).toBe(200); expect(file.body).toBe("test");
    for (const path of [`schedules/${records[0]!.schedule}`, `plans/${records[0]!.plan}`, `audits/${records[0]!.audit}`,
      `evidence?recordType=audit&recordId=${records[0]!.audit}`]) {
      const response = await request("GET", `/audit/${path}`, userToken);
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
    }
  });
  it("keeps read, write, project and export scopes tied to the role granting that capability", async () => {
    const [writeRole, projectRole] = await db.insert(auditWorkspaceRoles).values([
      { organizationId: org, name: "Department writer" }, { organizationId: org, name: "Unrelated project schedule reader" },
    ]).returning();
    const [writePermission, projectPermission] = await db.insert(auditPermissions).values([
      { organizationId: org, key: "audit.audits.create_edit", label: "Write audits", category: "audit" },
      { organizationId: org, key: "audit.schedules.export", label: "Export schedules", category: "audit" },
    ]).returning();
    await db.insert(auditWorkspaceRolePermissions).values([
      { organizationId: org, workspaceRoleId: writeRole!.id, permissionId: writePermission!.id, grant: "full" },
      { organizationId: org, workspaceRoleId: projectRole!.id, permissionId: projectPermission!.id, grant: "full" },
    ]);
    await db.insert(auditUserWorkspaceRoles).values([
      { organizationId: org, userId: user.id, workspaceRoleId: writeRole!.id, departmentIds: [departmentB] },
      { organizationId: org, userId: user.id, workspaceRoleId: projectRole!.id, projectIds: [projectId] },
    ]);
    const req = { currentUser: { ...user, platformRole: "Employee" } } as any;
    const read = await getAuthorizedProjectScope(req, "audit", { module: "audits", action: "select" });
    const write = await getAuthorizedProjectScope(req, "audit", { module: "audits", action: "full" });
    expect(read).toMatchObject({ unrestricted: false, projectIds: [], departmentIds: [departmentA] });
    expect(write).toMatchObject({ unrestricted: false, projectIds: [], departmentIds: [departmentB] });
    // A write grant to Safety does not expose it through the read routes.
    expect((await request("GET", `/audit/audits/${records[1]!.audit}`, userToken)).status).toBe(403);
  });
  it("creates and edits Process audits and findings only in the capability-specific write department", async () => {
    const [writer] = await db.insert(users).values({
      organizationId: org, username: `dept-writer-${org}`, email: `dept-writer-${org}@example.test`, fullName: "Process Department Writer",
    }).returning();
    const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: org, name: "Process write scope" }).returning();
    const keys = ["audit.audits.view_all", "audit.audits.create_edit", "audit.findings.view_all", "audit.findings.create_edit"];
    const permissions = await db.select().from(auditPermissions).where(eq(auditPermissions.organizationId, org));
    for (const key of keys) {
      let permission = permissions.find(row => row.key === key);
      if (!permission) [permission] = await db.insert(auditPermissions).values({ organizationId: org, key, label: key, category: "audit" }).returning();
      await db.insert(auditWorkspaceRolePermissions).values({
        organizationId: org, workspaceRoleId: role!.id, permissionId: permission!.id, grant: "full",
      });
    }
    await db.insert(auditUserWorkspaceRoles).values({
      organizationId: org, userId: writer!.id, workspaceRoleId: role!.id, departmentIds: [departmentA],
    });
    for (const [code, value] of [["nc_classifications", "Minor NC"], ["finding_priorities", "P3"], ["risk_levels", "Low"]]) {
      const [group] = await db.insert(masterDataGroups).values({ organizationId: org, code, name: code }).returning();
      await db.insert(masterDataValues).values({ organizationId: org, groupId: group!.id, value, label: value });
    }
    const token = issueToken(writer!);
    const payload = { id: randomUUID(), planId: records[0]!.plan, projectId: null, title: "Engineering Process Write", status: "Planned", checklist: [] };
    const created = await request("POST", "/audit/audits", token, payload);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.projectId).toBeNull();
    expect((await request("GET", `/audit/audits/${payload.id}`, token)).body.canEdit).toBe(true);
    expect((await request("PUT", `/audit/audits/${payload.id}`, token, { ...payload, projectId: "", title: "Updated Process Write" })).status).toBe(200);
    // Moving an authorized audit to another department is not authorized by its old parent.
    expect((await request("PUT", `/audit/audits/${payload.id}`, token, { ...payload, planId: records[1]!.plan })).status).toBe(403);
    expect((await request("PUT", `/audit/audits/${records[1]!.audit}`, token, { ...payload, id: records[1]!.audit, planId: records[1]!.plan })).status).toBe(403);
    for (const plan of [records[1]!.plan, records[2]!.plan]) {
      expect((await request("POST", "/audit/audits", token, { ...payload, id: randomUUID(), planId: plan })).status).toBe(403);
    }
    const finding = {
      id: randomUUID(), auditId: payload.id, title: "Scoped finding", description: "Real finding text",
      classification: "Minor NC", priority: "P3", riskLevel: "Low", responsibleDepartments: ["ENGINEERING"], status: "Open",
    };
    const createdFinding = await request("POST", "/audit/findings", token, finding);
    expect(createdFinding.status, JSON.stringify(createdFinding.body)).toBe(201);
    expect((await request("PUT", `/audit/findings/${finding.id}`, token, { ...finding, description: "Updated finding text" })).status).toBe(200);
    expect((await request("POST", "/audit/findings", token, { ...finding, id: randomUUID(), auditId: records[1]!.audit })).status).toBe(403);
    expect((await request("PUT", `/audit/findings/${finding.id}`, token, { ...finding, auditId: records[1]!.audit })).status).toBe(403);
    expect((await request("PUT", `/audit/findings/${records[1]!.finding}`, token, { ...finding, id: records[1]!.finding, auditId: records[1]!.audit })).status).toBe(403);
    const [saved] = await db.select().from(audits).where(eq(audits.id, payload.id));
    expect(saved!.auditPlanId).toBe(records[0]!.plan); expect(saved!.projectId).toBeNull();
    const [savedFinding] = await db.select().from(auditFindings).where(eq(auditFindings.id, finding.id));
    expect(savedFinding!.auditId).toBe(payload.id);
  });
});
describe("historical Department Master identity", () => {
  const departments = [{ id: "one", code: "ENG", name: "Engineering" }, { id: "two", code: "SAFE", name: "Safety" }];
  it("recognizes exact IDs, values and unique labels without inventing mappings", () => {
    expect(auditDepartmentId("ENG", departments)).toBe("one");
    expect(auditDepartmentId("one", departments)).toBe("one");
    expect(auditDepartmentId("Engineering", departments)).toBe("one");
    expect(auditDepartmentId("engineering", departments)).toBeNull();
    expect(auditDepartmentId("Engineering", [...departments, { id: "three", code: "OTHER", name: "Engineering" }])).toBeNull();
  });
  it("intersects read and export departments without borrowing unrelated grants", () => {
    const read = { unrestricted: false, projectIds: [], departmentIds: ["one"] };
    const other = { unrestricted: false, projectIds: [], departmentIds: ["two"] };
    expect(processDepartmentAllowed(intersectAuditScopes(read, other), "one")).toBe(false);
    expect(processDepartmentAllowed(intersectAuditScopes(read, read), "one")).toBe(true);
    expect(processDepartmentAllowed(read, null)).toBe(false);
  });
});
