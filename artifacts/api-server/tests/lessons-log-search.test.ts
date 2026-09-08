import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db, lessonLearnedForms, lessonNotifications, lessonsAuditLogEntries, lessonsDisciplines, organizations, platformRoles, projects, users,
} from "@workspace/db";
import lessonsRouter from "../src/routes/lessons";
import { issueToken } from "../src/lib/auth";

let app: Express;
let server: Server;
let baseUrl: string;
const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let token: string;
let creatorId: string;
let projectId: string;
let disciplineId: string;

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, json: await response.json() as any };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/lessons", lessonsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/lessons`;

  const [organization] = await db.insert(organizations).values({ name: `Lesson search ${suffix}`, code: `LS${suffix}` }).returning();
  orgId = organization!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const [user] = await db.insert(users).values({ organizationId: orgId, email: `search.${suffix}@example.test`, username: `search.${suffix}`, fullName: "Lesson Search Admin", platformRoleId: role!.id }).returning();
  creatorId = user!.id;
  token = issueToken(user!);
  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Lesson Search Project" }).returning();
  projectId = project!.id;
  const [discipline] = await db.insert(lessonsDisciplines).values({ organizationId: orgId, code: `D-${suffix}`, name: "Civil" }).returning();
  disciplineId = discipline!.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(lessonNotifications).where(eq(lessonNotifications.organizationId, orgId));
  await db.delete(lessonsAuditLogEntries).where(eq(lessonsAuditLogEntries.organizationId, orgId));
  await db.delete(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, orgId));
  await db.delete(lessonsDisciplines).where(eq(lessonsDisciplines.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("GET /api/lessons/log search", () => {
  it("matches both generated system and supplied user reference numbers", async () => {
    const [systemReference, userReference, unrelated] = await db.insert(lessonLearnedForms).values([
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-SYSTEM-${suffix}`, reference: "Site register 42", title: "Pump seal lesson", issueCategory: "Minor", impact: "Positive", creatorId },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-OTHER-${suffix}`, reference: `USER-REF-${suffix}`, title: "Valve lesson", issueCategory: "Minor", impact: "Positive", creatorId },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-UNRELATED-${suffix}`, reference: "Another source", title: "Unrelated lesson", issueCategory: "Minor", impact: "Positive", creatorId },
    ]).returning();

    const bySystemReference = await api(`/log?search=${encodeURIComponent(`ll-system-${suffix}`)}`);
    expect(bySystemReference.status).toBe(200);
    expect(bySystemReference.json.items.map(item => item.id)).toEqual([systemReference!.id]);

    const byUserReference = await api(`/log?search=${encodeURIComponent(`user-ref-${suffix}`)}`);
    expect(byUserReference.status).toBe(200);
    expect(byUserReference.json.items.map(item => item.id)).toEqual([userReference!.id]);
    expect(byUserReference.json.items.map(item => item.id)).not.toContain(unrelated!.id);
  });

  it("filters lessons by project and discipline", async () => {
    const [otherProject] = await db.insert(projects).values({
      organizationId: orgId, code: `P2-${suffix}`, name: "Other Project",
    }).returning();
    const [otherDiscipline] = await db.insert(lessonsDisciplines).values({
      organizationId: orgId, code: `D2-${suffix}`, name: "Electrical",
    }).returning();
    const [matching, other] = await db.insert(lessonLearnedForms).values([
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-FILTER-${suffix}`, title: "Civil project lesson", issueCategory: "Minor", impact: "Positive", creatorId },
      { organizationId: orgId, projectId: otherProject!.id, disciplineId: otherDiscipline!.id, referenceNumber: `LL-OTHER-FILTER-${suffix}`, title: "Electrical project lesson", issueCategory: "Minor", impact: "Positive", creatorId },
    ]).returning();

    const byProject = await api(`/log?projectId=${encodeURIComponent(projectId)}`);
    expect(byProject.status).toBe(200);
    expect(byProject.json.items.map(item => item.id)).toContain(matching!.id);
    expect(byProject.json.items.map(item => item.id)).not.toContain(other!.id);

    const byDiscipline = await api(`/log?disciplineId=${encodeURIComponent("Civil")}`);
    expect(byDiscipline.status).toBe(200);
    expect(byDiscipline.json.items.map(item => item.id)).toContain(matching!.id);
    expect(byDiscipline.json.items.map(item => item.id)).not.toContain(other!.id);
  });

  it("derives pending approvals for the current assignee, counts before pagination, and exports the same rows", async () => {
    const [submitter, otherApprover] = await db.insert(users).values([
      { organizationId: orgId, email: `submitter.${suffix}@example.test`, username: `submitter.${suffix}`, fullName: "Submitter" },
      { organizationId: orgId, email: `other.${suffix}@example.test`, username: `other.${suffix}`, fullName: "Other approver" },
    ]).returning();
    const now = new Date("2026-02-01T10:00:00.000Z");
    const [oldest, newest, otherAssigned, draft, selfAssigned] = await db.insert(lessonLearnedForms).values([
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-PENDING-OLD-${suffix}`, title: "Old pending", issueCategory: "Minor", impact: "Positive", creatorId: submitter!.id, approverId: creatorId, workflowState: "submitted", submittedAt: now },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-PENDING-NEW-${suffix}`, title: "New pending", issueCategory: "Minor", impact: "Positive", creatorId: submitter!.id, approverId: creatorId, workflowState: "submitted", submittedAt: new Date(now.getTime() + 1_000) },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-OTHER-ASSIGNEE-${suffix}`, title: "Other assignee", issueCategory: "Minor", impact: "Positive", creatorId: submitter!.id, approverId: otherApprover!.id, workflowState: "submitted", submittedAt: now },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-DRAFT-${suffix}`, title: "Draft", issueCategory: "Minor", impact: "Positive", creatorId: submitter!.id, approverId: creatorId, workflowState: "draft" },
      { organizationId: orgId, projectId, disciplineId, referenceNumber: `LL-SELF-${suffix}`, title: "Self assigned", issueCategory: "Minor", impact: "Positive", creatorId, approverId: creatorId, workflowState: "submitted", submittedAt: now },
    ]).returning();

    const page = await api("/log?pendingApproval=true&limit=1&page=1");
    expect(page.status).toBe(200);
    expect(page.json.total).toBe(2);
    expect(page.json.items.map((item: { id: string }) => item.id)).toEqual([oldest!.id]);

    const exported = await api("/reports/log?pendingApproval=true&format=json");
    expect(exported.status).toBe(200);
    const payload = JSON.parse(decodeURIComponent(exported.json.downloadUrl.split(",")[1]));
    expect(payload.map((item: { id: string }) => item.id)).toEqual([oldest!.id, newest!.id]);
    expect(payload.map((item: { id: string }) => item.id)).not.toContain(otherAssigned!.id);
    expect(payload.map((item: { id: string }) => item.id)).not.toContain(draft!.id);
    expect(payload.map((item: { id: string }) => item.id)).not.toContain(selfAssigned!.id);

    const reviewed = await api(`/forms/${oldest!.id}/review`, { method: "POST", body: { decision: "approve" } });
    expect(reviewed.status).toBe(200);
    const afterReview = await api("/log?pendingApproval=true");
    expect(afterReview.json.items.map((item: { id: string }) => item.id)).not.toContain(oldest!.id);
    const repeatedReview = await api(`/forms/${oldest!.id}/review`, { method: "POST", body: { decision: "send_back", comments: "too late" } });
    expect(repeatedReview.status).toBe(409);
  });
});