import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  auditAuditLogEntries, auditLogEntries, auditPlans, audits, db, organizations,
  organizationSettings, platformRoles, projects, qaqcMetricEntries, users,
} from "@workspace/db";
import auditRouter from "../src/routes/audit";
import platformRouter from "../src/routes/platform";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";
import { allocateReferenceNumber } from "../src/lib/numbering";

// Route tests for configurable per-module reference numbering: pattern CRUD,
// generation via metric/audit creation, starting-number semantics, reset, and
// concurrent allocation uniqueness.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let orgBId: string;
let projectId: string;
let adminA: { id: string; token: string };
let memberA: { id: string; token: string };
let adminB: { id: string; token: string };
let planId: string;
let planBId: string;
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

// category is a fixed enum; the (project, period, category) unique index means
// each metric needs a distinct period/category combination.
const createMetric = (category: "External NCR" | "Internal NCR" | "RFI" | "RMI", period = "2026-08") => api("POST", "/qaqc/metrics", {
  token: adminA.token,
  body: {
    id: randomUUID(), projectId, period, category, issuedCount: 1, closedCount: 0,
    ageing0To15: 0, ageing15To45: 0, ageingOver45: 0, workflowState: "Draft",
  },
});

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", platformRouter);
  app.use("/api", auditRouter);
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Numbering Org ${suffix}`, code: `NB${suffix}` }).returning();
  const [orgB] = await db.insert(organizations).values({ name: `Numbering Org B ${suffix}`, code: `NC${suffix}` }).returning();
  orgId = org!.id;
  orgBId = orgB!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();

  const insertUser = (org: string, name: string, platformRoleId?: string) => db.insert(users).values({
    organizationId: org,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}@example.test`,
    username: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}`,
    fullName: name,
    platformRoleId: platformRoleId ?? null,
  }).returning();
  const [adminRow] = await insertUser(orgId, "Num Admin", role!.id);
  const [memberRow] = await insertUser(orgId, "Num Member");
  adminA = { id: adminRow!.id, token: issueToken(adminRow!) };
  memberA = { id: memberRow!.id, token: issueToken(memberRow!) };

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Numbering Project" }).returning();
  projectId = project!.id;
  const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, scope: "QMS" }).returning();
  planId = plan!.id;

  const [roleB] = await db.insert(platformRoles).values({ organizationId: orgBId, name: "Org Admin", isSystem: true }).returning();
  const [adminBRow] = await insertUser(orgBId, "Num Admin B", roleB!.id);
  adminB = { id: adminBRow!.id, token: issueToken(adminBRow!) };
  const [projectB] = await db.insert(projects).values({ organizationId: orgBId, code: `PB-${suffix}`, name: "Numbering Project B" }).returning();
  projectBId = projectB!.id;
  const [planB] = await db.insert(auditPlans).values({ organizationId: orgBId, scope: "QMS" }).returning();
  planBId = planB!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const orgIds = [orgId, orgBId];
  await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, orgIds));
  await db.delete(auditAuditLogEntries).where(inArray(auditAuditLogEntries.organizationId, orgIds));
  await db.delete(audits).where(inArray(audits.organizationId, orgIds));
  await db.delete(auditPlans).where(inArray(auditPlans.organizationId, orgIds));
  await db.delete(qaqcMetricEntries).where(inArray(qaqcMetricEntries.organizationId, orgIds));
  await db.delete(organizationSettings).where(inArray(organizationSettings.organizationId, orgIds));
  await db.delete(projects).where(inArray(projects.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("numbering config API", () => {
  it("returns default patterns with previews for all three modules", async () => {
    const res = await api("GET", "/platform/numbering", { token: memberA.token });
    expect(res.status).toBe(200);
    expect(res.json.modules.lessons.configured).toBe(false);
    expect(res.json.modules.lessons.preview).toBe("LL-0001");
    expect(res.json.modules.qaqc.preview).toBe("QC-0001");
    expect(res.json.modules.audit.preview).toBe("AUD-0001");
  });

  it("rejects non-admin saves, unknown modules, and invalid patterns", async () => {
    const forbidden = await api("PUT", "/platform/numbering/qaqc", {
      token: memberA.token,
      body: { prefix: "X", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 1 },
    });
    expect(forbidden.status).toBe(403);
    const unknown = await api("PUT", "/platform/numbering/payroll", {
      token: adminA.token,
      body: { prefix: "X", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 1 },
    });
    expect(unknown.status).toBe(404);
    const invalid = await api("PUT", "/platform/numbering/qaqc", {
      token: adminA.token,
      body: { prefix: "X", suffix: "", separator: "-", position: "somewhere", padding: 4, startingNumber: 1 },
    });
    expect(invalid.status).toBe(422);
    const unbounded = await api("PUT", "/platform/numbering/qaqc", {
      token: adminA.token,
      body: { prefix: "X", suffix: "", separator: "-", position: "after_prefix", padding: 4, startingNumber: 20000000000000 },
    });
    expect(unbounded.status).toBe(422);
  });
});

describe("QA/QC metric generation", () => {
  it("generates reference numbers from the configured pattern and advances the counter", async () => {
    const saved = await api("PUT", "/platform/numbering/qaqc", {
      token: adminA.token,
      body: { prefix: "NCR", suffix: "2026", separator: "-", position: "after_suffix", padding: 3, startingNumber: 100 },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.configured).toBe(true);
    expect(saved.json.preview).toBe("NCR-2026-100");

    const first = await createMetric("External NCR");
    const second = await createMetric("Internal NCR");
    expect(first.status).toBe(201);
    expect(first.json.referenceNumber).toBe("NCR-2026-100");
    expect(second.json.referenceNumber).toBe("NCR-2026-101");
  });

  it("ignores a new starting number once numbers have been issued", async () => {
    const res = await api("PUT", "/platform/numbering/qaqc", {
      token: adminA.token,
      body: { prefix: "NCR", suffix: "2026", separator: "-", position: "after_suffix", padding: 3, startingNumber: 500 },
    });
    expect(res.status).toBe(200);
    expect(res.json.preview).toBe("NCR-2026-102");
    const third = await createMetric("RFI");
    expect(third.json.referenceNumber).toBe("NCR-2026-102");
  });

  it("allocates unique numbers under concurrent creation", async () => {
    const periods = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
    const results = await Promise.all(periods.map((period) => createMetric("RMI", period)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const refs = results.map((r) => r.json.referenceNumber);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("resets a module to the default pattern", async () => {
    const res = await api("DELETE", "/platform/numbering/qaqc", { token: adminA.token });
    expect(res.status).toBe(200);
    expect(res.json.configured).toBe(false);
    expect(res.json.preview).toMatch(/^QC-/);
  });

  it("keeps the counter moving forward after a reset", async () => {
    // Numbers 100..106 were issued above; reset must not restart at 1.
    const res = await createMetric("External NCR", "2027-02");
    expect(res.status).toBe(201);
    expect(res.json.referenceNumber).toMatch(/^QC-\d+$/);
    expect(Number(res.json.referenceNumber.split("-").pop())).toBeGreaterThanOrEqual(107);
  });
});

describe("lessons module counter", () => {
  it("allocates from the default lessons pattern per organization", async () => {
    const first = await allocateReferenceNumber(orgId, "lessons");
    const second = await allocateReferenceNumber(orgId, "lessons");
    const otherOrg = await allocateReferenceNumber(orgBId, "lessons");
    expect(first).toBe("LL-0001");
    expect(second).toBe("LL-0002");
    expect(otherOrg).toBe("LL-0001"); // counters are organization-scoped
  });
});

describe("audit reference numbers", () => {
  it("keeps the manual title as reference when no pattern is configured", async () => {
    const res = await api("POST", "/audits", {
      token: adminB.token,
      body: { id: randomUUID(), planId: planBId, projectId: projectBId, title: `Manual Audit ${suffix}`, status: "Planned" },
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(audits).where(eq(audits.id, res.json.id));
    expect(row!.referenceNumber).toBe(`Manual Audit ${suffix}`);
  });

  it("generates references from the configured pattern once set", async () => {
    const saved = await api("PUT", "/platform/numbering/audit", {
      token: adminA.token,
      body: { prefix: "AUDX", suffix: "", separator: "-", position: "after_prefix", padding: 2, startingNumber: 5 },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.preview).toBe("AUDX-05");

    for (const title of [`Pattern Audit 1 ${suffix}`, `Pattern Audit 2 ${suffix}`]) {
      const res = await api("POST", "/audits", {
        token: adminA.token,
        body: { id: randomUUID(), planId, projectId, title, status: "Planned" },
      });
      expect(res.status).toBe(201);
    }
    const rows = await db.select().from(audits).where(eq(audits.organizationId, orgId));
    const refs = rows.map((r) => r.referenceNumber).sort();
    expect(refs).toEqual(["AUDX-05", "AUDX-06"]);
  });

  it("keeps generated references immutable when the audit is edited", async () => {
    const created = await api("POST", "/audits", {
      token: adminA.token,
      body: { id: randomUUID(), planId, projectId, title: `Immutable Ref ${suffix}`, status: "Planned" },
    });
    expect(created.status).toBe(201);
    const updated = await api("PUT", `/audits/${created.json.id}`, {
      token: adminA.token,
      body: { id: created.json.id, planId, projectId, title: `Retitled ${suffix}`, status: "In Progress" },
    });
    expect(updated.status).toBe(200);
    const [row] = await db.select().from(audits).where(eq(audits.id, created.json.id));
    expect(row!.referenceNumber).toMatch(/^AUDX-/);
  });

  it("keeps generated references even after the pattern is reset", async () => {
    const created = await api("POST", "/audits", {
      token: adminA.token,
      body: { id: randomUUID(), planId, projectId, title: `Reset Survivor ${suffix}`, status: "Planned" },
    });
    expect(created.status).toBe(201);
    const reset = await api("DELETE", "/platform/numbering/audit", { token: adminA.token });
    expect(reset.status).toBe(200);
    const updated = await api("PUT", `/audits/${created.json.id}`, {
      token: adminA.token,
      body: { id: created.json.id, planId, projectId, title: `Renamed ${suffix}`, status: "In Progress" },
    });
    expect(updated.status).toBe(200);
    const [row] = await db.select().from(audits).where(eq(audits.id, created.json.id));
    expect(row!.referenceNumber).toMatch(/^AUDX-/);
  });
});
