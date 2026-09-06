import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  applicationAccess, auditLogEntries, db, organizations, organizationSettings,
  permissions, platformRoles, projects, qaqcMetricEntries, users, userWorkspaceRoles,
  workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";
import { assertFieldControls, writeFieldControls, type FieldControlsMatrix } from "../src/lib/field-controls";
import { HttpError } from "../src/lib/workspace";

// Route and unit tests for server-side enforcement of the Form Fields matrix
// (organization_settings.branding.fieldControls). A field configured read_only
// must reject non-admin create/update writes with a 422 naming the field, a
// field configured mandatory must reject blank non-admin submissions, and
// administrators keep full access — matching the UI bypass. The lessons
// special cases (GPS lat/lng pair, server-managed capturedAt, conditional
// repeat fields) are exercised by calling assertFieldControls directly.
// Runs against the real development database with a throwaway organization.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let projectId: string;
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

const metricRow = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  projectId,
  period: "2026-08",
  category: "External NCR",
  issuedCount: 0,
  closedCount: 0,
  ageing0To15: 0,
  ageing15To45: 0,
  ageingOver45: 0,
  workflowState: "Draft",
  ...overrides,
});

const memberContext = { platformRole: "Employee", workspaceRoles: [] as string[] };
const adminContext = { platformRole: "Org Admin", workspaceRoles: [] as string[] };
const reqFor = (user: typeof memberContext, body: Record<string, unknown>) =>
  ({ currentUser: { ...user, organizationId: orgId }, body }) as any;

async function expectBlocked(promise: Promise<unknown>, field: string) {
  const error = await promise.then(() => null).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(422);
  expect((error as HttpError).message).toContain(field);
}

// Base lesson-form matrix: title and the GPS pair are read-only, capturedAt is
// read-only + mandatory (but server-managed), and the repeat fields are
// mandatory (only applied once the issue is marked repeated).
const lessonMatrix: FieldControlsMatrix = {
  "lesson-form": {
    title: { access: "read_only", requirement: "optional" },
    gps: { access: "read_only", requirement: "optional" },
    capturedAt: { access: "read_only", requirement: "mandatory" },
    repeatLocation: { access: "editable", requirement: "mandatory" },
    repeatCount: { access: "editable", requirement: "mandatory" },
  },
};

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Field Controls Org ${suffix}`, code: `FC${suffix}` }).returning();
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

  await db.insert(applicationAccess).values({ organizationId: orgId, username: memberRow!.username, canOpenQaqc: true, canOpenLessons: true });
  const [qaRole] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: `QA Contributor ${suffix}` }).returning();
  const [metricsPerm] = await db.insert(permissions).values({ organizationId: orgId, key: "metrics", label: "Metrics", category: "qaqc" }).returning();
  await db.insert(workspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: qaRole!.id, permissionId: metricsPerm!.id, grant: "full" });
  await db.insert(userWorkspaceRoles).values({ organizationId: orgId, userId: member.id, workspaceRoleId: qaRole!.id });

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Field Controls Project" }).returning();
  projectId = project!.id;

  await writeFieldControls(orgId, "lessons", lessonMatrix);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => server.close(resolve));
  await db.delete(auditLogEntries).where(eq(auditLogEntries.organizationId, orgId));
  await db.delete(qaqcMetricEntries).where(eq(qaqcMetricEntries.organizationId, orgId));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, orgId));
  await db.delete(userWorkspaceRoles).where(eq(userWorkspaceRoles.organizationId, orgId));
  await db.delete(workspaceRolePermissions).where(eq(workspaceRolePermissions.organizationId, orgId));
  await db.delete(permissions).where(eq(permissions.organizationId, orgId));
  await db.delete(workspaceRoles).where(eq(workspaceRoles.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("field-controls enforcement over HTTP (qaqc metric form)", () => {
  let baseMetric: any;

  it("lets an admin save the field-control matrix and members read it", async () => {
    const put = await api("PUT", "/qaqc/admin/field-controls", {
      token: admin.token,
      body: {
        metric: {
          issuedCount: { access: "read_only", requirement: "optional" },
          approverId: { access: "editable", requirement: "mandatory" },
        },
      },
    });
    expect(put.status).toBe(200);
    const get = await api("GET", "/qaqc/field-controls", { token: member.token });
    expect(get.status).toBe(200);
    expect(get.json.metric.issuedCount.access).toBe("read_only");
    expect(get.json.metric.approverId.requirement).toBe("mandatory");
  });

  it("rejects a non-admin create that writes a read-only field", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: member.token, body: metricRow({ issuedCount: 9, approverId: member.id }) });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("issuedCount");
  });

  it("rejects a non-admin create that leaves a mandatory field empty", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: member.token, body: metricRow() });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("approverId");
  });

  it("accepts a non-admin create that respects both rules", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: member.token, body: metricRow({ approverId: member.id }) });
    expect(res.status).toBe(201);
  });

  it("lets an admin create despite both rules (bypass)", async () => {
    const res = await api("POST", "/qaqc/metrics", {
      token: admin.token,
      body: metricRow({ period: "2026-09", issuedCount: 5, closedCount: 2, approverId: member.id }),
    });
    expect(res.status).toBe(201);
    // The metric form persists approverId only at submit time, so seed it
    // directly to exercise mandatory-field updates against a stored value.
    await db.update(qaqcMetricEntries).set({ approverId: member.id }).where(eq(qaqcMetricEntries.id, res.json.id));
    baseMetric = { ...res.json, period: "2026-09", approverId: member.id };
  });

  it("accepts a non-admin update that resubmits the read-only value unchanged", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: member.token, body: baseMetric });
    expect(res.status).toBe(200);
  });

  it("rejects a non-admin update that changes the read-only field", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: member.token, body: { ...baseMetric, issuedCount: 9 } });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("issuedCount");
  });

  it("rejects a non-admin update that blanks the mandatory field", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: member.token, body: { ...baseMetric, approverId: null } });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("approverId");
  });

  it("lets an admin update the read-only field (bypass)", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: admin.token, body: { ...baseMetric, issuedCount: 8 } });
    expect(res.status).toBe(200);
  });
});

describe("assertFieldControls lesson-form semantics", () => {
  const asMember = (body: Record<string, unknown>) => reqFor(memberContext, body);
  const asAdmin = (body: Record<string, unknown>) => reqFor(adminContext, body);

  it("accepts an update that resubmits a read-only field unchanged", async () => {
    await expect(assertFieldControls(asMember({ title: "Safety win" }), "lessons", "lesson-form",
      { mode: "update", current: { title: "Safety win" } })).resolves.toBeUndefined();
  });

  it("rejects an update that changes a read-only field", async () => {
    await expectBlocked(assertFieldControls(asMember({ title: "Rewritten" }), "lessons", "lesson-form",
      { mode: "update", current: { title: "Safety win" } }), "title");
  });

  it("rejects a create that writes the read-only GPS pair", async () => {
    await expectBlocked(assertFieldControls(asMember({ gpsLat: 25.1, gpsLng: 55.2 }), "lessons", "lesson-form", { mode: "create" }), "gps");
  });

  it("ignores server-managed capturedAt even when configured read-only and mandatory", async () => {
    // capturedAt is skipped entirely: a create that only sets it passes both rules.
    await expect(assertFieldControls(asMember({ capturedAt: "2020-01-01T00:00:00.000Z", isRepeatedIssue: false }), "lessons", "lesson-form", { mode: "create" }))
      .resolves.toBeUndefined();
  });

  it("rejects a create missing a mandatory composite field, naming the logical field", async () => {
    await writeFieldControls(orgId, "lessons", {
      "lesson-form": { gps: { access: "editable", requirement: "mandatory" } },
    });
    try {
      await expectBlocked(assertFieldControls(asMember({}), "lessons", "lesson-form", { mode: "create" }), "gps");
      await expectBlocked(assertFieldControls(asMember({ gpsLat: 25.1 }), "lessons", "lesson-form", { mode: "create" }), "gps");
      await expect(assertFieldControls(asMember({ gpsLat: 25.1, gpsLng: 55.2 }), "lessons", "lesson-form", { mode: "create" }))
        .resolves.toBeUndefined();
    } finally {
      await writeFieldControls(orgId, "lessons", lessonMatrix);
    }
  });

  it("skips conditional mandatory repeat fields when the issue is not repeated", async () => {
    await expect(assertFieldControls(asMember({ isRepeatedIssue: false }), "lessons", "lesson-form", { mode: "create" }))
      .resolves.toBeUndefined();
  });

  it("requires repeat location and count once the issue is marked repeated", async () => {
    await expectBlocked(assertFieldControls(asMember({ isRepeatedIssue: true, repeatLocation: "" }), "lessons", "lesson-form", { mode: "create" }), "repeatLocation");
    await expectBlocked(assertFieldControls(asMember({ isRepeatedIssue: true, repeatLocation: "Site B", repeatCount: 0 }), "lessons", "lesson-form", { mode: "create" }), "repeatCount");
    await expect(assertFieldControls(asMember({ isRepeatedIssue: true, repeatLocation: "Site B", repeatCount: 2 }), "lessons", "lesson-form", { mode: "create" }))
      .resolves.toBeUndefined();
  });

  it("lets admins write read-only fields and skip mandatory ones (bypass)", async () => {
    await expect(assertFieldControls(asAdmin({ title: "Rewritten", gpsLat: 25.1, gpsLng: 55.2, isRepeatedIssue: true }), "lessons", "lesson-form", { mode: "create" }))
      .resolves.toBeUndefined();
    await expect(assertFieldControls(reqFor({ platformRole: "Employee", workspaceRoles: ["Team Administrator"] }, { title: "Rewritten" }), "lessons", "lesson-form", { mode: "create" }))
      .resolves.toBeUndefined();
  });
});
