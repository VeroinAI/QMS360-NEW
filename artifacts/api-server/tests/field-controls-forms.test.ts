import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  applicationAccess, auditAuditLogEntries, auditFindings, auditPermissions, auditPlans,
  auditSchedules, audits, auditUserWorkspaceRoles, auditWorkspaceRolePermissions, auditWorkspaceRoles,
  correctiveActionReports, db, lessonLearnedForms, lessonsAuditLogEntries, lessonsDisciplines,
  lessonsPermissions, lessonsUserWorkspaceRoles, lessonsWorkspaceRolePermissions, lessonsWorkspaceRoles,
  masterDataGroups, masterDataValues, organizations, organizationSettings, platformRoles, projects, users,
} from "@workspace/db";
import lessonsRouter from "../src/routes/lessons";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";
import { writeFieldControls } from "../src/lib/field-controls";

// Route-level regression tests for server-side Form Fields enforcement
// (organization_settings.branding.fieldControls) on the Lessons and Audit
// apps, complementing the QA/QC coverage in field-controls.test.ts. Each
// create/update handler must call assertFieldControls: a non-admin writing a
// read-only field or omitting a mandatory one gets a 422 naming the field,
// while Org Admins bypass the matrix (matching the UI). Runs against the real
// development database with a throwaway organization, including the LOV
// master-data values the lessons/audit handlers validate against.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let projectId: string;
let auditId: string;
let admin: { id: string; token: string };
let member: { id: string; token: string };

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: response.status, json };
}

async function expectUnprocessable(res: { status: number; json: any }, field: string) {
  expect(res.status).toBe(422);
  expect(res.json?.error).toContain(field);
}

// Matrix under test: each form gets one read-only field and one mandatory
// field whose defaults are blank, so enforcement is observable with ordinary
// form payloads.
const lessonBody = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  projectId,
  title: "Locked-valve lesson",
  disciplineId: "Civil",
  categorisationId: "Process",
  issueCategory: "Minor",
  impact: "Positive",
  description: "What happened and why it matters",
  rootCause: "Root cause analysis",
  correction: "Immediate fix",
  correctiveAction: "Prevention plan",
  capturedAt: "2026-04-15T09:30:00.000Z",
  version: 1,
  conflictFlag: false,
  workflowState: "Draft",
  ...overrides,
});

const scheduleBody = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  year: 2026,
  title: `Annual audit schedule ${suffix}`,
  projectIds: [] as string[],
  auditCategory: "Internal",
  departmentProject: "QA Department",
  plannedStartDate: "2026-03-01",
  plannedEndDate: "2026-09-30",
  workflowState: "Draft",
  ...overrides,
});

const planBody = (scheduleId: string, overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  scheduleId,
  scope: "Document control and site processes",
  criteria: ["ISO 9001:2015"],
  auditDate: "2026-05-10",
  location: "",
  objectives: "Verify clause 8.5 controls",
  teamMemberIds: [] as string[],
  status: "Draft",
  ...overrides,
});

const findingBody = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  auditId,
  title: "Finding from audit",
  description: "Finding description",
  classification: "Observation",
  priority: "P6",
  riskLevel: "Low",
  responsibleDepartments: ["QA Department"],
  status: "Open",
  ...overrides,
});

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/lessons", lessonsRouter);
  app.use("/api/audit", auditRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Field Controls Forms Org ${suffix}`, code: `FF${suffix}` }).returning();
  orgId = org!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();

  const insertUser = (name: string, platformRoleId?: string) => db.insert(users).values({
    organizationId: orgId,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}@example.test`,
    username: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}`,
    fullName: name,
    platformRoleId: platformRoleId ?? null,
  }).returning();
  const [adminRow] = await insertUser("Admin One", role!.id);
  const [memberRow] = await insertUser("Member One");
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  member = { id: memberRow!.id, token: issueToken(memberRow!) };

  await db.insert(applicationAccess).values({
    organizationId: orgId, username: memberRow!.username, canOpenLessons: true, canOpenAudit: true,
  });

  // Lessons grants: the forms module accepts the "own" grant for writes.
  const [lessonRole] = await db.insert(lessonsWorkspaceRoles).values({ organizationId: orgId, name: `Lesson Contributor ${suffix}` }).returning();
  const [lessonPerm] = await db.insert(lessonsPermissions).values({ organizationId: orgId, key: "lessons", label: "Lessons", category: "lessons" }).returning();
  await db.insert(lessonsWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: lessonRole!.id, permissionId: lessonPerm!.id, grant: "own" });
  await db.insert(lessonsUserWorkspaceRoles).values({ organizationId: orgId, userId: member.id, workspaceRoleId: lessonRole!.id });

  // Audit grants: schedule/plan/finding/CAR writes require the "full" grant.
  const [auditRole] = await db.insert(auditWorkspaceRoles).values({ organizationId: orgId, name: `Audit Contributor ${suffix}` }).returning();
  for (const key of ["schedules", "plans", "findings", "cars"]) {
    const [perm] = await db.insert(auditPermissions).values({ organizationId: orgId, key, label: key, category: "audit" }).returning();
    await db.insert(auditWorkspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: auditRole!.id, permissionId: perm!.id, grant: "full" });
  }
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: member.id, workspaceRoleId: auditRole!.id });

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Field Controls Forms Project" }).returning();
  projectId = project!.id;

  // LOV master-data values the lessons and audit handlers validate against.
  for (const [code, values] of [
    ["disciplines", ["Civil"]],
    ["lesson_categorisations", ["Process"]],
    ["lesson_issue_categories", ["Minor"]],
    ["lesson_impacts", ["Positive"]],
    ["audit_categories", ["Internal"]],
    ["nc_classifications", ["Observation"]],
    ["finding_priorities", ["P6"]],
    ["risk_levels", ["Low"]],
  ] as Array<[string, string[]]>) {
    const [group] = await db.insert(masterDataGroups).values({ organizationId: orgId, code, name: code }).returning();
    for (const value of values) {
      await db.insert(masterDataValues).values({ organizationId: orgId, groupId: group!.id, value, label: value });
    }
  }

  // An audit record to hang findings on (the findings route requires it).
  const [auditRow] = await db.insert(audits).values({
    organizationId: orgId, projectId, referenceNumber: `AUD-${suffix}`, workflowState: "planned",
  }).returning();
  auditId = auditRow!.id;

  await writeFieldControls(orgId, "lessons", {
    "lesson-form": {
      reference: { access: "read_only", requirement: "optional" },
      rootCause: { access: "editable", requirement: "mandatory" },
    },
  });
  await writeFieldControls(orgId, "audit", {
    schedule: {
      remarks: { access: "read_only", requirement: "optional" },
      departmentProject: { access: "editable", requirement: "mandatory" },
    },
    plan: {
      location: { access: "read_only", requirement: "optional" },
      objectives: { access: "editable", requirement: "mandatory" },
    },
    finding: {
      clause: { access: "read_only", requirement: "optional" },
      description: { access: "editable", requirement: "mandatory" },
    },
    car: {
      rootCause: { access: "read_only", requirement: "optional" },
      correctiveAction: { access: "editable", requirement: "mandatory" },
    },
  });
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => server.close(resolve));
  await db.delete(lessonsAuditLogEntries).where(eq(lessonsAuditLogEntries.organizationId, orgId));
  await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId));
  await db.delete(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, orgId));
  await db.delete(lessonsDisciplines).where(eq(lessonsDisciplines.organizationId, orgId));
  await db.delete(correctiveActionReports).where(eq(correctiveActionReports.organizationId, orgId));
  await db.delete(auditFindings).where(eq(auditFindings.organizationId, orgId));
  await db.delete(audits).where(eq(audits.organizationId, orgId));
  await db.delete(auditPlans).where(eq(auditPlans.organizationId, orgId));
  await db.delete(auditSchedules).where(eq(auditSchedules.organizationId, orgId));
  await db.delete(masterDataValues).where(eq(masterDataValues.organizationId, orgId));
  await db.delete(masterDataGroups).where(eq(masterDataGroups.organizationId, orgId));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, orgId));
  await db.delete(lessonsUserWorkspaceRoles).where(eq(lessonsUserWorkspaceRoles.organizationId, orgId));
  await db.delete(lessonsWorkspaceRolePermissions).where(eq(lessonsWorkspaceRolePermissions.organizationId, orgId));
  await db.delete(lessonsPermissions).where(eq(lessonsPermissions.organizationId, orgId));
  await db.delete(lessonsWorkspaceRoles).where(eq(lessonsWorkspaceRoles.organizationId, orgId));
  await db.delete(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.organizationId, orgId));
  await db.delete(auditWorkspaceRolePermissions).where(eq(auditWorkspaceRolePermissions.organizationId, orgId));
  await db.delete(auditPermissions).where(eq(auditPermissions.organizationId, orgId));
  await db.delete(auditWorkspaceRoles).where(eq(auditWorkspaceRoles.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("Lessons application access", () => {
  it("enables the application when an administrator assigns a Lessons role", async () => {
    const [target] = await db.insert(users).values({
      organizationId: orgId,
      email: `new.creator.${suffix}@example.test`,
      username: `new.creator.${suffix}`,
      fullName: "New Lesson Creator",
    }).returning();
    const [role] = await db.select().from(lessonsWorkspaceRoles).where(eq(lessonsWorkspaceRoles.organizationId, orgId)).limit(1);

    const assigned = await api("POST", `/lessons/admin/users/${target!.id}/roles`, {
      token: admin.token,
      body: { roleId: role!.id, scopeType: "organization", scopeIds: [] },
    });
    expect(assigned.status).toBe(200);

    const [access] = await db.select().from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, orgId),
      eq(applicationAccess.username, target!.username),
    )).limit(1);
    expect(access).toMatchObject({ canOpenLessons: true, status: "active" });
  });
});

describe("field-controls enforcement over HTTP (lessons form)", () => {
  let lessonId: string;

  it("rejects a non-admin create that writes the read-only reference field", async () => {
    const res = await api("POST", "/lessons/forms", { token: member.token, body: lessonBody({ reference: "REF-LOCKED" }) });
    await expectUnprocessable(res, "reference");
  });

  it("rejects a non-admin create that blanks the mandatory root cause", async () => {
    const res = await api("POST", "/lessons/forms", { token: member.token, body: lessonBody({ rootCause: "" }) });
    await expectUnprocessable(res, "rootCause");
  });

  it("accepts a non-admin create that respects both rules", async () => {
    const res = await api("POST", "/lessons/forms", { token: member.token, body: lessonBody() });
    expect(res.status).toBe(201);
    lessonId = res.json.id;
  });

  it("rejects a non-admin update that writes the read-only reference field", async () => {
    const res = await api("PUT", `/lessons/forms/${lessonId}`, { token: member.token, body: lessonBody({ id: lessonId, reference: "REF-EDITED" }) });
    await expectUnprocessable(res, "reference");
  });

  it("rejects a non-admin update that blanks the mandatory root cause", async () => {
    const res = await api("PUT", `/lessons/forms/${lessonId}`, { token: member.token, body: lessonBody({ id: lessonId, rootCause: "" }) });
    await expectUnprocessable(res, "rootCause");
  });

  it("accepts a non-admin update that respects both rules and persists capturedAt", async () => {
    const capturedAt = "2026-05-16T14:45:00.000Z";
    const res = await api("PUT", `/lessons/forms/${lessonId}`, { token: member.token, body: lessonBody({ id: lessonId, title: "Locked-valve lesson (revised)", capturedAt }) });
    expect(res.status).toBe(200);
    expect(new Date(res.json.capturedAt).toISOString()).toBe(capturedAt);
  });

  it("lets an admin create despite both rules (bypass)", async () => {
    const res = await api("POST", "/lessons/forms", { token: admin.token, body: lessonBody({ reference: "REF-ADMIN", rootCause: "" }) });
    expect(res.status).toBe(201);
  });
});

describe("field-controls enforcement over HTTP (audit schedule)", () => {
  let scheduleId: string;

  it("rejects a non-admin create that writes the read-only remarks field", async () => {
    const res = await api("POST", "/audit/schedules", { token: member.token, body: scheduleBody({ remarks: "Edited remarks" }) });
    await expectUnprocessable(res, "remarks");
  });

  it("rejects a non-admin create that omits the mandatory department/project", async () => {
    const body = scheduleBody();
    delete (body as any).departmentProject;
    const res = await api("POST", "/audit/schedules", { token: member.token, body });
    await expectUnprocessable(res, "departmentProject");
  });

  it("accepts a non-admin create that respects both rules", async () => {
    const body = scheduleBody();
    const res = await api("POST", "/audit/schedules", { token: member.token, body });
    expect(res.status).toBe(201);
    scheduleId = res.json.id;
    const retry = await api("POST", "/audit/schedules", { token: member.token, body });
    expect(retry.status).toBe(201);
    expect(retry.json.id).toBe(scheduleId);
  });

  it("persists GPS coordinates for a schedule location", async () => {
    const gpsLat = 12.345678;
    const gpsLng = 77.123456;
    const res = await api("POST", "/audit/schedules", {
      token: admin.token,
      body: scheduleBody({ location: `${gpsLat}, ${gpsLng}`, gpsLat, gpsLng }),
    });
    expect(res.status).toBe(201);
    expect(res.json.location).toBe(`${gpsLat}, ${gpsLng}`);
    expect(res.json.gpsLat).toBe(gpsLat);
    expect(res.json.gpsLng).toBe(gpsLng);
  });

  it("rejects a non-admin update that writes the read-only remarks field", async () => {
    const res = await api("PUT", `/audit/schedules/${scheduleId}`, { token: member.token, body: scheduleBody({ id: scheduleId, remarks: "Edited remarks" }) });
    await expectUnprocessable(res, "remarks");
  });

  it("rejects a non-admin update that blanks the mandatory department/project", async () => {
    const res = await api("PUT", `/audit/schedules/${scheduleId}`, { token: member.token, body: scheduleBody({ id: scheduleId, departmentProject: "" }) });
    await expectUnprocessable(res, "departmentProject");
  });

  it("accepts a non-admin update that resubmits both fields unchanged", async () => {
    const res = await api("PUT", `/audit/schedules/${scheduleId}`, { token: member.token, body: scheduleBody({ id: scheduleId, title: `Annual audit schedule ${suffix} v2` }) });
    expect(res.status).toBe(200);
  });

  it("lets an admin create despite both rules (bypass)", async () => {
    const body = scheduleBody({ remarks: "Admin remarks" });
    delete (body as any).departmentProject;
    const res = await api("POST", "/audit/schedules", { token: admin.token, body });
    expect(res.status).toBe(201);
  });
});

describe("field-controls enforcement over HTTP (audit plan)", () => {
  let scheduleId: string;
  let planId: string;

  beforeAll(async () => {
    const res = await api("POST", "/audit/schedules", { token: admin.token, body: scheduleBody() });
    expect(res.status).toBe(201);
    scheduleId = res.json.id;
  });

  it("rejects a non-admin create that writes the read-only location field", async () => {
    const res = await api("POST", "/audit/plans", { token: member.token, body: planBody(scheduleId, { location: "Site B" }) });
    await expectUnprocessable(res, "location");
  });

  it("rejects a non-admin create that omits the mandatory objectives", async () => {
    const body = planBody(scheduleId);
    delete (body as any).objectives;
    const res = await api("POST", "/audit/plans", { token: member.token, body });
    await expectUnprocessable(res, "objectives");
  });

  it("accepts a non-admin create that respects both rules", async () => {
    const res = await api("POST", "/audit/plans", { token: member.token, body: planBody(scheduleId) });
    expect(res.status).toBe(201);
    planId = res.json.id;
  });

  it("rejects a non-admin update that writes the read-only location field", async () => {
    const res = await api("PUT", `/audit/plans/${planId}`, { token: member.token, body: planBody(scheduleId, { id: planId, location: "Site C" }) });
    await expectUnprocessable(res, "location");
  });

  it("rejects a non-admin update that blanks the mandatory objectives", async () => {
    const res = await api("PUT", `/audit/plans/${planId}`, { token: member.token, body: planBody(scheduleId, { id: planId, objectives: "" }) });
    await expectUnprocessable(res, "objectives");
  });

  it("accepts a non-admin update that resubmits both fields unchanged", async () => {
    const res = await api("PUT", `/audit/plans/${planId}`, { token: member.token, body: planBody(scheduleId, { id: planId, scope: "Revised scope" }) });
    expect(res.status).toBe(200);
  });
});

describe("field-controls enforcement over HTTP (audit finding)", () => {
  let findingId: string;

  it("rejects a non-admin create that writes the read-only clause field", async () => {
    const res = await api("POST", "/audit/findings", { token: member.token, body: findingBody({ clause: "4.1" }) });
    await expectUnprocessable(res, "clause");
  });

  it("rejects a non-admin create that blanks the mandatory description", async () => {
    const res = await api("POST", "/audit/findings", { token: member.token, body: findingBody({ description: "" }) });
    await expectUnprocessable(res, "description");
  });

  it("accepts a non-admin create that respects both rules", async () => {
    const res = await api("POST", "/audit/findings", { token: member.token, body: findingBody() });
    expect(res.status).toBe(201);
    findingId = res.json.id;
  });

  it("rejects a non-admin update that writes the read-only clause field", async () => {
    const res = await api("PUT", `/audit/findings/${findingId}`, { token: member.token, body: findingBody({ id: findingId, clause: "9.9" }) });
    await expectUnprocessable(res, "clause");
  });

  it("rejects a non-admin update that blanks the mandatory description", async () => {
    const res = await api("PUT", `/audit/findings/${findingId}`, { token: member.token, body: findingBody({ id: findingId, description: "" }) });
    await expectUnprocessable(res, "description");
  });

  it("accepts a non-admin update that resubmits both fields unchanged", async () => {
    const res = await api("PUT", `/audit/findings/${findingId}`, { token: member.token, body: findingBody({ id: findingId, title: "Finding from audit (revised)" }) });
    expect(res.status).toBe(200);
  });
});

describe("field-controls enforcement over HTTP (audit CAR)", () => {
  let carId: string;
  let findingId: string;

  const carBody = (overrides: Record<string, unknown> = {}) => ({
    id: carId,
    findingId,
    responsibleDepartment: "QA Department",
    ownerId: member.id,
    rootCause: null,
    correction: "Immediate correction",
    correctiveAction: "Long-term corrective action",
    status: "Open",
    dueDate: "2026-12-31",
    ...overrides,
  });

  beforeAll(async () => {
    const findingRes = await api("POST", "/audit/findings", { token: member.token, body: findingBody() });
    expect(findingRes.status).toBe(201);
    findingId = findingRes.json.id;
    const [car] = await db.insert(correctiveActionReports).values({
      organizationId: orgId, auditFindingId: findingId, responsibleDepartment: "QA Department",
      ownerId: member.id, workflowState: "open", dueDate: "2026-12-31",
    }).returning();
    carId = car!.id;
  });

  it("rejects a non-admin update that writes the read-only root cause", async () => {
    const res = await api("PUT", `/audit/cars/${carId}`, { token: member.token, body: carBody({ rootCause: "Pre-diagnosed cause" }) });
    await expectUnprocessable(res, "rootCause");
  });

  it("rejects a non-admin update that blanks the mandatory corrective action", async () => {
    const res = await api("PUT", `/audit/cars/${carId}`, { token: member.token, body: carBody({ correctiveAction: "" }) });
    await expectUnprocessable(res, "correctiveAction");
  });

  it("accepts a non-admin update that resubmits both fields unchanged", async () => {
    const res = await api("PUT", `/audit/cars/${carId}`, { token: member.token, body: carBody({ correction: "Revised correction" }) });
    expect(res.status).toBe(200);
  });
});
