import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { auditLogEntries, db, organizations, platformRoles, projects, qaqcMetricEntries, users } from "@workspace/db";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";

// Route tests for the QA/QC metrics bulk import. Per-row validation must
// import valid rows, report invalid ones with row numbers, and never write
// rows against another organization's project. Runs against the real
// development database with throwaway organizations.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgAId: string;
let orgBId: string;
let adminA: { id: string; organizationId: string; token: string };
let projectAId: string;
let projectBId: string;

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

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/qaqc`;

  const [orgA] = await db.insert(organizations).values({ name: `Import Test Org A ${suffix}`, code: `ITA${suffix}` }).returning();
  const [orgB] = await db.insert(organizations).values({ name: `Import Test Org B ${suffix}`, code: `ITB${suffix}` }).returning();
  orgAId = orgA!.id;
  orgBId = orgB!.id;

  const [roleA] = await db.insert(platformRoles).values({ organizationId: orgAId, name: "Org Admin", isSystem: true }).returning();
  const [adminRowA] = await db.insert(users).values({
    organizationId: orgAId,
    email: `admin.a.${suffix}@example.test`,
    username: `admin.a.${suffix}`,
    fullName: "Admin A",
    platformRoleId: roleA!.id,
  }).returning();
  adminA = { id: adminRowA!.id, organizationId: orgAId, token: issueToken(adminRowA!) };

  const [projectA] = await db.insert(projects).values({ organizationId: orgAId, code: `PA-${suffix}`, name: "Org A Project" }).returning();
  const [projectB] = await db.insert(projects).values({ organizationId: orgBId, code: `PB-${suffix}`, name: "Org B Project" }).returning();
  projectAId = projectA!.id;
  projectBId = projectB!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const orgIds = [orgAId, orgBId];
  await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, orgIds));
  await db.delete(qaqcMetricEntries).where(inArray(qaqcMetricEntries.organizationId, orgIds));
  await db.delete(projects).where(inArray(projects.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  projectId: projectAId,
  period: "2020-02",
  category: "External NCR",
  issuedCount: 5,
  closedCount: 2,
  ageing0To15: 1,
  ageing15To45: 1,
  ageingOver45: 1,
  workflowState: "Draft",
  ...overrides,
});

describe("metrics import", () => {
  it("rejects a non-array body with 422", async () => {
    const res = await api("POST", "/metrics/import", { token: adminA.token, body: { nope: true } });
    expect(res.status).toBe(422);
  });

  it("rejects unauthenticated calls with 401", async () => {
    const res = await api("POST", "/metrics/import", { body: [] });
    expect(res.status).toBe(401);
  });

  it("imports valid rows and reports invalid ones per row", async () => {
    const res = await api("POST", "/metrics/import", {
      token: adminA.token,
      body: [row(), row({ id: crypto.randomUUID(), category: "Bogus Category" })],
    });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(1);
    expect(res.json.rejected).toBe(1);
    expect(res.json.errors[0].error).toContain("Row 2");
  });

  it("rejects rows pointing at another organization's project", async () => {
    const res = await api("POST", "/metrics/import", {
      token: adminA.token,
      body: [row({ projectId: projectBId, period: "2020-03" })],
    });
    expect(res.status).toBe(200);
    expect(res.json.created).toBe(0);
    expect(res.json.rejected).toBe(1);
    expect(res.json.errors[0].error).toContain("Project does not belong");
  });

  it("updates the existing row when the same project, period and category re-import", async () => {
    const res = await api("POST", "/metrics/import", {
      token: adminA.token,
      body: [row({ issuedCount: 9, closedCount: 8 })],
    });
    expect(res.status).toBe(200);
    expect(res.json.updated).toBe(1);
    expect(res.json.created).toBe(0);
  });
});
