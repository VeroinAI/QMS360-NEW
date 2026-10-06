import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db, organizations, platformRoles, users, projects, applicationAccess,
  auditWorkspaceRoles, auditUserWorkspaceRoles, auditPlans, auditSchedules, audits, auditFindings, correctiveActionReports,
} from "@workspace/db";
import { issueToken } from "../src/lib/auth";
import auditRouter from "../src/routes/audit";
import platformRouter from "../src/routes/platform";

const organizationId = randomUUID();
let server: Server;
let base: string;
let token: string;
let userId: string;
let projectA: string;
let projectB: string;
let recordA: string;
let recordB: string;
let processAudit: string;
let processPlan: string;
let unrelatedPlan: string;
let processCar: string;

beforeAll(async () => {
  await db.insert(organizations).values({ id: organizationId, name: "Synthetic Drona Scope", code: `DRONA-${organizationId}` });
  const [platformRole] = await db.insert(platformRoles).values({
    organizationId, name: "Employee", description: "Synthetic scope fixture",
  }).returning();
  const [user] = await db.insert(users).values({
    organizationId, platformRoleId: platformRole!.id, email: `${organizationId}@example.test`,
    username: "synthetic", fullName: "Synthetic Drona Tester", accessStatus: "active",
  }).returning();
  userId = user!.id;
  token = issueToken(user!);
  const [role] = await db.insert(auditWorkspaceRoles).values({
    organizationId, name: "Audit Administrator", status: "active",
  }).returning();
  await db.insert(auditUserWorkspaceRoles).values({
    organizationId, userId, workspaceRoleId: role!.id, projectIds: [], status: "active",
  });
  await db.insert(applicationAccess).values({ organizationId, username: "synthetic", canOpenAudit: true });
  const projectRows = await db.insert(projects).values([
    { organizationId, name: "Mapped project", code: "A", status: "active" },
    { organizationId, name: "Unmapped project", code: "B", status: "active" },
  ]).returning();
  projectA = projectRows[0]!.id;
  projectB = projectRows[1]!.id;
  const [schedule] = await db.insert(auditSchedules).values({
    organizationId, year: 2026, title: "Department Process Audit", ownerId: userId,
    status: JSON.stringify({ auditTypes: ["Quality Internal Process Audit"], departmentProject: "Quality Department", projectIds: [] }),
  }).returning();
  const [plan] = await db.insert(auditPlans).values({
    organizationId, auditScheduleId: schedule!.id, scope: "Department Process Audit", createdBy: userId,
  }).returning();
  processPlan = plan!.id;
  const [legacy] = await db.insert(auditPlans).values({
    organizationId, scope: "Unrelated projectless legacy plan", createdBy: userId,
  }).returning();
  unrelatedPlan = legacy!.id;
  const records = await db.insert(audits).values([
    { organizationId, projectId: projectA, referenceNumber: "SYN-A", createdBy: userId },
    { organizationId, projectId: projectB, referenceNumber: "SYN-B", createdBy: userId },
    { organizationId, auditPlanId: processPlan, referenceNumber: "SYN-PROCESS", createdBy: userId },
  ]).returning();
  recordA = records[0]!.id;
  recordB = records[1]!.id;
  processAudit = records[2]!.id;
  const [finding] = await db.insert(auditFindings).values({
    organizationId, auditId: processAudit, classification: "NC", description: "Synthetic Process finding",
  }).returning();
  const [car] = await db.insert(correctiveActionReports).values({
    organizationId, auditFindingId: finding!.id, responsibleDepartment: "Quality Department",
  }).returning();
  processCar = car!.id;
  const app = express();
  app.use(express.json());
  // Only this isolated test server supplies the membership result. Token/source
  // verification is covered separately by auth-drona.test and session.test.
  app.use((req, _res, next) => {
    req.dronaProjectIds = req.header("x-fixture-empty-membership") ? [] : [projectA];
    next();
  });
  app.use("/api/audit", auditRouter);
  app.use("/api", platformRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const table of [correctiveActionReports, auditFindings, audits, auditPlans, auditSchedules, auditUserWorkspaceRoles,
    auditWorkspaceRoles, applicationAccess, users, projects, platformRoles]) {
    await db.delete(table).where(eq(table.organizationId, organizationId));
  }
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

async function get(path: string, empty = false) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(empty ? { "x-fixture-empty-membership": "true" } : {}) },
  });
  return { status: response.status, data: await response.json() };
}

describe("Drona membership intersection with existing QMS access", () => {
  it("does not widen an organization-wide QMS role beyond Drona projects", async () => {
    expect((await get(`/audit/audits/${recordA}`)).status).toBe(200);
    expect((await get(`/audit/audits/${recordB}`)).status).toBe(403);
    const result = await get("/audit/audits");
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    expect(result.data.items.map((row: any) => row.id)).toEqual(expect.arrayContaining([recordA, processAudit]));
    expect(result.data.items.map((row: any) => row.id)).not.toContain(recordB);
  });
  it("caps project directories and immediately removes project records when membership is empty", async () => {
    const directory = await get("/platform/projects");
    expect(directory.status).toBe(200);
    expect(directory.data.items.map((row: any) => row.id)).toEqual([projectA]);
    expect((await get("/platform/projects", true)).data.items).toEqual([]);
    expect((await get(`/audit/audits/${recordA}`, true)).status).toBe(403);
    const records = await get("/audit/audits", true);
    expect(records.status, JSON.stringify(records.data)).toBe(200);
    expect(records.data.items.map((row: any) => row.id)).toEqual([processAudit]);
  });
  it("preserves confirmed department-only Process Audit plans/details without granting unrelated projectless records", async () => {
    expect((await get(`/audit/plans/${processPlan}`, true)).status).toBe(200);
    expect((await get(`/audit/audits/${processAudit}`, true)).status).toBe(200);
    expect((await get(`/audit/plans/${unrelatedPlan}`, true)).status).toBe(403);
    const plans = await get("/audit/plans", true);
    expect(plans.status, JSON.stringify(plans.data)).toBe(200);
    expect(plans.data.items.map((row: any) => row.id)).toEqual([processPlan]);
  });
  it("does not convert Drona membership into QMS application approval", async () => {
    await db.update(applicationAccess).set({ canOpenAudit: false })
      .where(eq(applicationAccess.organizationId, organizationId));
    try {
      expect((await get(`/audit/audits/${recordA}`)).status).toBe(403);
      expect((await get(`/audit/audits/${processAudit}`, true)).status).toBe(403);
    } finally {
      await db.update(applicationAccess).set({ canOpenAudit: true })
        .where(eq(applicationAccess.organizationId, organizationId));
    }
  });
  it("keeps Process CAR read/admin scope available with no project membership", async () => {
    const car = await get(`/audit/cars/${processCar}`, true);
    expect(car.status, JSON.stringify(car.data)).toBe(200);
    // Standalone legacy findings remain an explicit opt-in, not the default
    // checklist-backed register. Do not change that existing product rule.
    const register = await get("/audit/car-register?includeLegacy=true", true);
    expect(register.status, JSON.stringify(register.data)).toBe(200);
    expect(JSON.stringify(register.data)).toContain(processCar);
  });
});
