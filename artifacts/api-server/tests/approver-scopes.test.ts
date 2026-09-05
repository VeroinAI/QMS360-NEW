import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  db, lessonApproverScopes, lessonLearnedForms, lessonsAuditLogEntries, lessonsDisciplines,
  organizations, platformRoles, projects, users,
} from "@workspace/db";
import lessonsRouter from "../src/routes/lessons";
import { issueToken } from "../src/lib/auth";

// Scoped approver assignments: blank scope dimensions act as wildcards. Once an
// organization has at least one active rule, only users with a matching rule
// may be designated as lesson approvers.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let creator: { id: string; token: string };
let approverA: { id: string; token: string };
let approverB: { id: string; token: string };
let member: { id: string; token: string };
let projectAId: string;
let projectBId: string;
let disciplineAId: string;
let disciplineBId: string;

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

async function makeUser(label: string, roleId?: string) {
  const [row] = await db.insert(users).values({
    organizationId: orgId,
    email: `${label}.${suffix}@example.test`,
    username: `${label}.${suffix}`,
    fullName: `Scope ${label}`,
    platformRoleId: roleId ?? null,
  }).returning();
  return { id: row!.id, token: issueToken(row!) };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/lessons", lessonsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/lessons`;

  const [org] = await db.insert(organizations).values({ name: `Scope Org ${suffix}`, code: `SC${suffix}` }).returning();
  orgId = org!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  creator = await makeUser("creator", role!.id);
  approverA = await makeUser("approver.a", role!.id);
  approverB = await makeUser("approver.b", role!.id);
  member = await makeUser("member");
  const [pA] = await db.insert(projects).values({ organizationId: orgId, code: `PA-${suffix}`, name: "Scope Project A" }).returning();
  projectAId = pA!.id;
  const [pB] = await db.insert(projects).values({ organizationId: orgId, code: `PB-${suffix}`, name: "Scope Project B" }).returning();
  projectBId = pB!.id;
  const [dA] = await db.insert(lessonsDisciplines).values({ organizationId: orgId, code: `DA-${suffix}`, name: "Civil" }).returning();
  disciplineAId = dA!.id;
  const [dB] = await db.insert(lessonsDisciplines).values({ organizationId: orgId, code: `DB-${suffix}`, name: "Mechanical" }).returning();
  disciplineBId = dB!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.organizationId, [orgId]));
  await db.delete(lessonLearnedForms).where(inArray(lessonLearnedForms.organizationId, [orgId]));
  await db.delete(lessonApproverScopes).where(inArray(lessonApproverScopes.organizationId, [orgId]));
  await db.delete(lessonsDisciplines).where(inArray(lessonsDisciplines.organizationId, [orgId]));
  await db.delete(projects).where(inArray(projects.organizationId, [orgId]));
  await db.delete(users).where(inArray(users.organizationId, [orgId]));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, [orgId]));
  await db.delete(organizations).where(inArray(organizations.id, [orgId]));
});

const approverIds = (json: any) => (json as any[]).map((a) => a.id).sort();

describe("scoped lesson approvers", () => {
  it("lists every eligible approver when no scope rules exist", async () => {
    const res = await api("GET", "/approvers", { token: creator.token });
    expect(res.status).toBe(200);
    expect(approverIds(res.json)).toEqual([approverA.id, approverB.id].sort());
    const withSelf = await api("GET", "/approvers?includeSelf=true", { token: creator.token });
    expect(approverIds(withSelf.json)).toEqual([creator.id, approverA.id, approverB.id].sort());
  });

  it("restricts approvers by project once rules exist (blank dimensions match all)", async () => {
    const globalRule = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: approverA.id } });
    expect(globalRule.status).toBe(201);
    const projectRule = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: approverB.id, projectId: projectAId } });
    expect(projectRule.status).toBe(201);

    const inProjectA = await api("GET", `/approvers?projectId=${projectAId}`, { token: creator.token });
    expect(approverIds(inProjectA.json)).toEqual([approverA.id, approverB.id].sort());

    const inProjectB = await api("GET", `/approvers?projectId=${projectBId}`, { token: creator.token });
    expect(approverIds(inProjectB.json)).toEqual([approverA.id]);

    const noContext = await api("GET", "/approvers", { token: creator.token });
    expect(approverIds(noContext.json)).toEqual([approverA.id]);
  });

  it("supports project + discipline combination rules", async () => {
    // Replace B's project-only rule with a project+discipline combination.
    const list = await api("GET", "/admin/approver-scopes", { token: creator.token });
    const bRule = (list.json as any[]).find((s) => s.userId === approverB.id);
    const removed = await api("DELETE", `/admin/approver-scopes/${bRule.id}`, { token: creator.token });
    expect(removed.status).toBe(204);
    const combo = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: approverB.id, projectId: projectAId, disciplineId: disciplineAId } });
    expect(combo.status).toBe(201);

    const match = await api("GET", `/approvers?projectId=${projectAId}&discipline=Civil`, { token: creator.token });
    expect(approverIds(match.json)).toEqual([approverA.id, approverB.id].sort());

    const wrongDiscipline = await api("GET", `/approvers?projectId=${projectAId}&discipline=Mechanical`, { token: creator.token });
    expect(approverIds(wrongDiscipline.json)).toEqual([approverA.id]);

    const wrongProject = await api("GET", `/approvers?projectId=${projectBId}&discipline=Civil`, { token: creator.token });
    expect(approverIds(wrongProject.json)).toEqual([approverA.id]);
  });

  it("rejects scopes pointing at unknown projects or users", async () => {
    const badProject = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: approverA.id, projectId: randomUUID() } });
    expect(badProject.status).toBeGreaterThanOrEqual(400);
    const badUser = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: randomUUID() } });
    expect(badUser.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects scope rows for users who are not eligible approvers", async () => {
    const res = await api("POST", "/admin/approver-scopes", { token: creator.token, body: { userId: member.id } });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("eligible");
  });

  it("matches categorisation scope dimensions", async () => {
    // Current rules: A = global, B = {project A, discipline Civil}.
    const [catRule] = await db.insert(lessonApproverScopes).values({
      organizationId: orgId, userId: approverB.id, projectId: projectAId, categorisation: "High",
    }).returning();
    const match = await api("GET", `/approvers?projectId=${projectAId}&categorisation=High`, { token: creator.token });
    expect(approverIds(match.json)).toEqual([approverA.id, approverB.id].sort());
    const miss = await api("GET", `/approvers?projectId=${projectAId}&categorisation=Low`, { token: creator.token });
    expect(approverIds(miss.json)).toEqual([approverA.id]);
    const removed = await api("DELETE", `/admin/approver-scopes/${catRule!.id}`, { token: creator.token });
    expect(removed.status).toBe(204);
  });

  it("accepts a discipline UUID (edit mode) and never creates reference rows", async () => {
    const beforeRows = await db.select({ id: lessonsDisciplines.id }).from(lessonsDisciplines).where(inArray(lessonsDisciplines.organizationId, [orgId]));
    const byUuid = await api("GET", `/approvers?projectId=${projectAId}&discipline=${disciplineAId}`, { token: creator.token });
    expect(approverIds(byUuid.json)).toEqual([approverA.id, approverB.id].sort());
    const unknown = await api("GET", "/approvers?discipline=No%20Such%20Discipline", { token: creator.token });
    expect(approverIds(unknown.json)).toEqual([approverA.id]);
    const afterRows = await db.select({ id: lessonsDisciplines.id }).from(lessonsDisciplines).where(inArray(lessonsDisciplines.organizationId, [orgId]));
    expect(afterRows.length).toBe(beforeRows.length);
  });

  it("blocks review when the designated approver is out of scope", async () => {
    const [lesson] = await db.insert(lessonLearnedForms).values({
      organizationId: orgId, projectId: projectBId, disciplineId: disciplineBId,
      referenceNumber: `LS-${suffix}`, title: "Scope rejection",
      issueCategory: "Process", impact: "Medium",
      workflowState: "submitted", creatorId: creator.id, approverId: approverB.id,
    }).returning();
    // B is scoped to {project A, discipline Civil}; this lesson is project B / Mechanical.
    const res = await api("POST", `/forms/${lesson!.id}/review`, { token: approverB.token, body: { decision: "approve" } });
    expect(res.status).toBe(403);
    expect(res.json.error).toContain("scope");
  });
});
