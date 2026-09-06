import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import {
  db, lessonEscalationInstances, lessonEscalationRules, lessonLearnedForms, lessonNotifications,
  organizations, platformRoles, projects, users,
} from "@workspace/db";
import platformRouter from "../src/routes/platform";
import { issueToken } from "../src/lib/auth";
import { evaluateEscalations, runEscalationSweep } from "../src/lib/escalation";

// Guards for the admin-triggered escalation sweep (POST /api/platform/escalations/sweep):
// it must require an administrator, act only on the caller's organization, and
// never overlap an in-flight sweep (overlap could double-advance instances and
// duplicate notifications/emails).

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgA: string;
let orgB: string;
let adminA: { id: string; token: string };
let memberA: { id: string; token: string };
let projectB: string;
let breachedLessonB: string;

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

async function makeOrg(label: string) {
  const [org] = await db.insert(organizations).values({ name: `Sweep ${label} ${suffix}`, code: `SW${label}${suffix}` }).returning();
  const [adminRole] = await db.insert(platformRoles).values({ organizationId: org!.id, name: "Org Admin", isSystem: true }).returning();
  const [adminRow] = await db.insert(users).values({
    organizationId: org!.id, email: `sw.${label}.admin.${suffix}@example.test`,
    username: `sw.${label}.admin.${suffix}`, fullName: "Sweep Admin", platformRoleId: adminRole!.id,
  }).returning();
  return { orgId: org!.id, admin: { id: adminRow!.id, token: issueToken(adminRow!) } };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", platformRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/platform`;

  const a = await makeOrg("a");
  orgA = a.orgId; adminA = a.admin;
  const b = await makeOrg("b");
  orgB = b.orgId;

  const [memberRole] = await db.insert(platformRoles).values({ organizationId: orgA, name: "Viewer", isSystem: false }).returning();
  const [memberRow] = await db.insert(users).values({
    organizationId: orgA, email: `sw.member.${suffix}@example.test`,
    username: `sw.member.${suffix}`, fullName: "Sweep Member", platformRoleId: memberRole!.id,
  }).returning();
  memberA = { id: memberRow!.id, token: issueToken(memberRow!) };

  // Org B has an active lesson rule and a lesson created long enough ago to breach it.
  await db.insert(lessonEscalationRules).values({
    organizationId: orgB, triggerKey: "lesson_sla", priority: "P1", slaWorkingDays: 5,
    recipientRole: "Form Approver", repeatCadenceDays: 3, configuration: { level: "P1" }, status: "active",
  });
  const [project] = await db.insert(projects).values({ organizationId: orgB, code: `PB${suffix}`, name: "Org B Project" }).returning();
  projectB = project!.id;
  const anchor = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const [lesson] = await db.insert(lessonLearnedForms).values({
    organizationId: orgB, projectId: projectB, referenceNumber: `LL-${suffix}`,
    title: "Breached lesson", issueCategory: "Minor", impact: "Positive",
    creatorId: b.admin.id, workflowState: "submitted", createdAt: anchor, updatedAt: anchor,
  }).returning();
  breachedLessonB = lesson!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const orgs = [orgA, orgB];
  await db.delete(lessonNotifications).where(inArray(lessonNotifications.organizationId, orgs));
  await db.delete(lessonEscalationInstances).where(inArray(lessonEscalationInstances.organizationId, orgs));
  await db.delete(lessonEscalationRules).where(inArray(lessonEscalationRules.organizationId, orgs));
  await db.delete(lessonLearnedForms).where(inArray(lessonLearnedForms.organizationId, orgs));
  await db.delete(projects).where(inArray(projects.organizationId, orgs));
  await db.delete(users).where(inArray(users.organizationId, orgs));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgs));
  await db.delete(organizations).where(inArray(organizations.id, orgs));
});

describe("admin-triggered escalation sweep", () => {
  it("rejects non-administrators", async () => {
    const res = await api("POST", "/escalations/sweep", { token: memberA.token });
    expect(res.status).toBe(403);
  });

  it("runs for an administrator and returns per-app creation counts", async () => {
    const res = await api("POST", "/escalations/sweep", { token: adminA.token });
    expect(res.status).toBe(200);
    expect(res.json.created).toMatchObject({ qaqc: expect.any(Number), lessons: expect.any(Number), audit: expect.any(Number) });
  });

  it("never creates escalation instances for other organizations", async () => {
    // Org A's admin sweeps: org B's breached lesson must remain untouched.
    const res = await api("POST", "/escalations/sweep", { token: adminA.token });
    expect(res.status).toBe(200);
    const foreign = await db.select().from(lessonEscalationInstances)
      .where(inArray(lessonEscalationInstances.organizationId, [orgB]));
    expect(foreign).toHaveLength(0);

    // Evaluating org B directly does pick up its own breached lesson.
    const created = await evaluateEscalations(db, orgB);
    expect(created.lessons).toBe(1);
    const own = await db.select().from(lessonEscalationInstances)
      .where(inArray(lessonEscalationInstances.organizationId, [orgB]));
    expect(own).toHaveLength(1);
    expect(own[0]!.recordId).toBe(breachedLessonB);
  });

  it("refuses to overlap an in-flight sweep", async () => {
    const first = runEscalationSweep(orgA);
    const second = await runEscalationSweep(orgA); // guard is set synchronously
    expect(second).toBeNull();
    const result = await first.catch(() => null);
    expect(result).not.toBeUndefined();
  });
});
