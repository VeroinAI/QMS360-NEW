import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  aiSuggestionLogs, applicationAccess, auditLogEntries, db, moduleFieldSettings, organizations, organizationSettings,
  permissions, platformRoles, projects, qaqcMetricEntries, users, userWorkspaceRoles,
  workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import platformRouter from "../src/routes/platform";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";

// Route tests for per-module field access control: an admin-locked (read-only)
// field must reject non-admin writes with a 422 naming the field — on create,
// on update, and through the bulk metrics import — while unchanged
// resubmissions, unconfigured fields, and administrators keep working.
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

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", platformRouter);
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Field Access Org ${suffix}`, code: `FA${suffix}` }).returning();
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

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Field Access Project" }).returning();
  projectId = project!.id;

  // issuedCount is admin-locked for the metric-entry form in this org.
  await db.insert(moduleFieldSettings).values({
    organizationId: orgId, module: "qaqc", formKey: "metric-entry", fieldKey: "issuedCount", access: "read_only",
  });
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => server.close(resolve));
  await db.delete(moduleFieldSettings).where(eq(moduleFieldSettings.organizationId, orgId));
  await db.delete(aiSuggestionLogs).where(eq(aiSuggestionLogs.organizationId, orgId));
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

describe("field access enforcement", () => {
  let baseMetric: any;

  it("serves the catalog to any authenticated user but restricts settings writes to admins", async () => {
    const get = await api("GET", "/platform/field-settings", { token: member.token });
    expect(get.status).toBe(200);
    expect(get.json.modules.map((m: any) => m.module).sort()).toEqual(["audit", "lessons", "qaqc"]);
    const forbidden = await api("PUT", "/platform/field-settings", {
      token: member.token,
      body: { settings: [{ module: "qaqc", formKey: "metric-entry", fieldKey: "closedCount", access: "read_only" }] },
    });
    expect(forbidden.status).toBe(403);
  });

  it("rejects a non-admin create that changes a read-only field", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: member.token, body: metricRow({ issuedCount: 9 }) });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("issuedCount");
  });

  it("allows a non-admin create that leaves the read-only field at its default", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: member.token, body: metricRow() });
    expect(res.status).toBe(201);
  });

  it("lets an admin create with a non-default value (bypass)", async () => {
    const res = await api("POST", "/qaqc/metrics", { token: admin.token, body: metricRow({ period: "2026-09", issuedCount: 5, closedCount: 2 }) });
    expect(res.status).toBe(201);
    baseMetric = { ...res.json, period: "2026-09" };
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

  it("accepts non-admin updates to unconfigured (editable) fields", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: member.token, body: { ...baseMetric, closedCount: 3 } });
    expect(res.status).toBe(200);
  });

  it("lets an admin update the read-only field (bypass)", async () => {
    const res = await api("PUT", `/qaqc/metrics/${baseMetric.id}`, { token: admin.token, body: { ...baseMetric, closedCount: 3, issuedCount: 8 } });
    expect(res.status).toBe(200);
  });

  it("strips read-only fields from AI-extracted values (filterReadOnlyValues)", async () => {
    const { filterReadOnlyValues } = await import("../src/lib/field-access");
    const memberUser = { organizationId: orgId, platformRole: "Member", workspaceRoles: [] };
    const stripped = await filterReadOnlyValues(memberUser, "qaqc", "metric-entry", {
      projectId, period: "2026-08", issuedCount: 12, closedCount: 4,
    });
    expect(stripped.skipped).toEqual(["issuedCount"]);
    expect(stripped.values.issuedCount).toBeUndefined();
    expect(stripped.values.closedCount).toBe(4);
    // Values equal to the create default are not writes and survive.
    const defaults = await filterReadOnlyValues(memberUser, "qaqc", "metric-entry", { issuedCount: 0 });
    expect(defaults.skipped).toEqual([]);
    expect(defaults.values.issuedCount).toBe(0);
    // Admins are exempt, matching the interactive API behaviour.
    const adminUser = { organizationId: orgId, platformRole: "Org Admin", workspaceRoles: [] };
    const kept = await filterReadOnlyValues(adminUser, "qaqc", "metric-entry", { issuedCount: 12 });
    expect(kept.skipped).toEqual([]);
    expect(kept.values.issuedCount).toBe(12);
  });

  it("rejects AI quick-entry answers that target a read-only field", async () => {
    const start = await api("POST", "/qaqc/ai/prompt-to-transaction", {
      token: member.token,
      body: { prompt: `External NCR for project ${projectId} in 2026-08: 12 issued, 9 closed` },
    });
    if (start.status === 503) return; // AI provider unavailable in this environment
    expect(start.status).toBe(200);
    // The locked field must never be seeded into the draft, even if the AI extracted it.
    expect(start.json.extracted.issuedCount).toBeUndefined();
    expect(start.json.missing.map((m: any) => m.field)).not.toContain("issuedCount");
    const rejected = await api("POST", `/qaqc/ai/prompt-to-transaction/${start.json.sessionId}/answer`, {
      token: member.token, body: { field: "issuedCount", value: 5 },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.json.error).toContain("issuedCount");
    const allowed = await api("POST", `/qaqc/ai/prompt-to-transaction/${start.json.sessionId}/answer`, {
      token: member.token, body: { field: "closedCount", value: 5 },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.json.extracted.closedCount).toBe(5);
  }, 30_000);

  it("applies the same rules to bulk import rows", async () => {
    const res = await api("POST", "/qaqc/metrics/import", {
      token: member.token,
      body: [
        metricRow({ period: "2026-09", issuedCount: 9, closedCount: 3 }), // update of existing row, read-only field changed
        metricRow({ period: "2026-09", issuedCount: 8, closedCount: 3 }), // update, read-only field unchanged
        metricRow({ period: "2026-10" }),                                  // create at the default value
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(1);
    expect(res.json.updated).toBe(1);
    expect(res.json.rejected).toBe(1);
    expect(res.json.errors[0].error).toContain("Row 1");
    expect(res.json.errors[0].error).toContain("issuedCount");
  });

  it("lets an admin change field access and reflects it in the catalog", async () => {
    const put = await api("PUT", "/platform/field-settings", {
      token: admin.token,
      body: { settings: [{ module: "qaqc", formKey: "metric-entry", fieldKey: "closedCount", access: "read_only" }] },
    });
    expect(put.status).toBe(200);
    const catalog = await api("GET", "/platform/field-settings", { token: member.token });
    const form = catalog.json.modules.find((m: any) => m.module === "qaqc").forms.find((f: any) => f.formKey === "metric-entry");
    expect(form.fields.find((f: any) => f.fieldKey === "closedCount").access).toBe("read_only");
    expect(form.fields.find((f: any) => f.fieldKey === "issuedCount").access).toBe("read_only");
    const restore = await api("PUT", "/platform/field-settings", {
      token: admin.token,
      body: { settings: [{ module: "qaqc", formKey: "metric-entry", fieldKey: "closedCount", access: "editable" }] },
    });
    expect(restore.status).toBe(200);
  });
});
