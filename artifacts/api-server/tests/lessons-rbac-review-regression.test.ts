import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  applicationAccess,
  db,
  lessonApproverScopes,
  lessonLearnedForms,
  lessonNotifications,
  lessonsEvidenceFiles,
  lessonsAuditLogEntries,
  lessonsDisciplines,
  lessonsPermissions,
  lessonsUserWorkspaceRoles,
  lessonsWorkspaceRolePermissions,
  lessonsWorkspaceRoles,
  organizations,
  platformRoles,
  projects,
  users,
} from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
const orgIds: string[] = [];
let orgId: string;
let foreignOrgId: string;
let projectAId: string;
let projectBId: string;
let disciplineId: string;
let reader: { id: string; token: string };
let owner: { id: string; token: string };
let approver: { id: string; token: string };
let otherId: string;
let foreignLessonId: string;

async function api(
  method: string,
  path: string,
  options: { token: string; body?: unknown },
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* response has no JSON body */ }
  return { status: response.status, json };
}

async function makeUser(label: string, organizationId = orgId, platformRoleId?: string) {
  const [row] = await db.insert(users).values({
    organizationId,
    email: `${label}.${suffix}@example.test`,
    username: `${label}.${suffix}`,
    fullName: `Lessons ${label}`,
    platformRoleId: platformRoleId ?? null,
  }).returning();
  return { id: row!.id, token: issueToken(row!), username: row!.username };
}

async function giveLessonsRole(userId: string, roleName: string, permissionKeys: string[], grant = "full") {
  const [role] = await db.insert(lessonsWorkspaceRoles).values({
    organizationId: orgId,
    name: `${roleName} ${suffix}`,
  }).returning();
  for (const permissionKey of permissionKeys) {
    let [permission] = await db.select().from(lessonsPermissions).where(and(
      eq(lessonsPermissions.organizationId, orgId),
      eq(lessonsPermissions.key, permissionKey),
    )).limit(1);
    if (!permission) [permission] = await db.insert(lessonsPermissions).values({
      organizationId: orgId, key: permissionKey, label: permissionKey, category: "lessons",
    }).returning();
    await db.insert(lessonsWorkspaceRolePermissions).values({
      organizationId: orgId,
      workspaceRoleId: role!.id,
      permissionId: permission!.id,
      grant,
    });
  }
  await db.insert(lessonsUserWorkspaceRoles).values({
    organizationId: orgId,
    userId,
    workspaceRoleId: role!.id,
  });
}

const lessonValues = (
  referenceNumber: string,
  creatorId: string,
  overrides: Partial<typeof lessonLearnedForms.$inferInsert> = {},
) => ({
  organizationId: orgId,
  projectId: projectAId,
  disciplineId,
  referenceNumber,
  title: referenceNumber,
  categorisation: "Process",
  issueCategory: "Minor",
  impact: "Positive",
  creatorId,
  ...overrides,
});

const updateBody = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  projectId: projectAId,
  title: "Owner draft revised",
  disciplineId,
  categorisationId: "Process",
  issueCategory: "Minor",
  impact: "Positive",
  description: "Updated description",
  rootCause: "Updated root cause",
  correction: "Updated correction",
  correctiveAction: "Updated corrective action",
  capturedAt: "2026-05-20T10:00:00.000Z",
  version: 1,
  conflictFlag: false,
  workflowState: "Draft",
  approverId: approver.id,
  ...overrides,
});

beforeAll(async () => {
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/lessons`;

  const [org, foreignOrg] = await db.insert(organizations).values([
    { name: `Lessons RBAC ${suffix}`, code: `LR${suffix}` },
    { name: `Lessons Foreign ${suffix}`, code: `LF${suffix}` },
  ]).returning();
  orgId = org!.id;
  foreignOrgId = foreignOrg!.id;
  orgIds.push(orgId, foreignOrgId);

  reader = await makeUser("scoped.reader");
  owner = await makeUser("data.owner");
  approver = await makeUser("configured.approver");
  const other = await makeUser("other.creator");
  otherId = other.id;

  for (const user of [
    { username: "scoped.reader", actual: reader },
    { username: "data.owner", actual: owner },
    { username: "configured.approver", actual: approver },
  ]) {
    await db.insert(applicationAccess).values({
      organizationId: orgId,
      username: `${user.username}.${suffix}`,
      canOpenLessons: true,
    });
  }

  // Deliberately preserve the historical persisted `full` grant: the
  // view_own_scope capability itself must still constrain visibility.
  await giveLessonsRole(reader.id, "Scoped Reader", ["view_own_scope"], "full");
  await giveLessonsRole(owner.id, "Data Entry", ["data_entry", "view_own_scope", "submit"], "full");
  // Browser-equivalent fixture: one non-admin workspace role carries both
  // persisted full grants and reaches Lessons through app.ts's nested routers.
  await giveLessonsRole(approver.id, "Lesson Approver", ["view_own_scope", "approve_reject"], "full");

  const [projectA, projectB] = await db.insert(projects).values([
    { organizationId: orgId, code: `PA-${suffix}`, name: "Visible Project" },
    { organizationId: orgId, code: `PB-${suffix}`, name: "Out of Scope Project" },
  ]).returning();
  projectAId = projectA!.id;
  projectBId = projectB!.id;
  const [discipline] = await db.insert(lessonsDisciplines).values({
    organizationId: orgId,
    code: `D-${suffix}`,
    name: "Civil",
  }).returning();
  disciplineId = discipline!.id;

  await db.insert(lessonApproverScopes).values([
    { organizationId: orgId, userId: reader.id, projectId: projectAId },
    { organizationId: orgId, userId: approver.id, projectId: projectAId },
  ]);

  const [foreignRole] = await db.insert(platformRoles).values({
    organizationId: foreignOrgId,
    name: "Org Admin",
    isSystem: true,
  }).returning();
  const foreignUser = await makeUser("foreign.admin", foreignOrgId, foreignRole!.id);
  const [foreignProject] = await db.insert(projects).values({
    organizationId: foreignOrgId,
    code: `FP-${suffix}`,
    name: "Foreign Project",
  }).returning();
  const [foreignLesson] = await db.insert(lessonLearnedForms).values({
    organizationId: foreignOrgId,
    projectId: foreignProject!.id,
    referenceNumber: `FOREIGN-${suffix}`,
    title: "Foreign tenant lesson",
    issueCategory: "Minor",
    impact: "Positive",
    creatorId: foreignUser.id,
  }).returning();
  foreignLessonId = foreignLesson!.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(lessonNotifications).where(inArray(lessonNotifications.organizationId, orgIds));
  await db.delete(lessonsAuditLogEntries).where(inArray(lessonsAuditLogEntries.organizationId, orgIds));
  await db.delete(lessonsEvidenceFiles).where(inArray(lessonsEvidenceFiles.organizationId, orgIds));
  await db.delete(lessonLearnedForms).where(inArray(lessonLearnedForms.organizationId, orgIds));
  await db.delete(lessonApproverScopes).where(inArray(lessonApproverScopes.organizationId, orgIds));
  await db.delete(lessonsDisciplines).where(inArray(lessonsDisciplines.organizationId, orgIds));
  await db.delete(applicationAccess).where(inArray(applicationAccess.organizationId, orgIds));
  await db.delete(lessonsUserWorkspaceRoles).where(inArray(lessonsUserWorkspaceRoles.organizationId, orgIds));
  await db.delete(lessonsWorkspaceRolePermissions).where(inArray(lessonsWorkspaceRolePermissions.organizationId, orgIds));
  await db.delete(lessonsPermissions).where(inArray(lessonsPermissions.organizationId, orgIds));
  await db.delete(lessonsWorkspaceRoles).where(inArray(lessonsWorkspaceRoles.organizationId, orgIds));
  await db.delete(projects).where(inArray(projects.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("non-admin lesson visibility and capabilities", () => {
  it("keeps a full-stored view_own_scope grant limited to owned or assigned in-scope rows everywhere", async () => {
    const [owned, assignedScoped, assignedOutsideScope, unrelated] = await db.insert(lessonLearnedForms).values([
      lessonValues(`OWNED-${suffix}`, reader.id),
      lessonValues(`ASSIGNED-${suffix}`, otherId, { approverId: reader.id }),
      lessonValues(`OUTSIDE-${suffix}`, otherId, { projectId: projectBId, approverId: reader.id }),
      lessonValues(`UNRELATED-${suffix}`, otherId),
    ]).returning();
    const visibleIds = [owned!.id, assignedScoped!.id].sort();

    const forms = await api("GET", "/forms?limit=100", { token: reader.token });
    expect(forms.status).toBe(200);
    expect(forms.json.items.map((row: { id: string }) => row.id).sort()).toEqual(visibleIds);

    const log = await api("GET", "/log?limit=100", { token: reader.token });
    expect(log.status).toBe(200);
    expect(log.json.items.map((row: { id: string }) => row.id).sort()).toEqual(visibleIds);

    const exported = await api("GET", "/reports/log?format=json", { token: reader.token });
    expect(exported.status).toBe(200);
    const exportRows = JSON.parse(decodeURIComponent(exported.json.downloadUrl.split(",")[1]));
    expect(exportRows.map((row: { id: string }) => row.id).sort()).toEqual(visibleIds);

    for (const id of visibleIds) {
      expect((await api("GET", `/forms/${id}`, { token: reader.token })).status).toBe(200);
      expect((await api("GET", `/forms/${id}/report`, { token: reader.token })).status).toBe(200);
    }
    for (const id of [assignedOutsideScope!.id, unrelated!.id]) {
      expect((await api("GET", `/forms/${id}`, { token: reader.token })).status).toBe(403);
      expect((await api("GET", `/forms/${id}/report`, { token: reader.token })).status).toBe(403);
    }
    expect((await api("GET", `/forms/${foreignLessonId}`, { token: reader.token })).status).toBe(404);
    expect((await api("GET", `/forms/${foreignLessonId}/report`, { token: reader.token })).status).toBe(404);
  });

  it("lets data_entry update its own draft, but requires approve_reject to review", async () => {
    const [draft, submitted] = await db.insert(lessonLearnedForms).values([
      lessonValues(`OWNER-DRAFT-${suffix}`, owner.id, { approverId: approver.id }),
      lessonValues(`OWNER-SUBMITTED-${suffix}`, owner.id, {
        approverId: approver.id,
        workflowState: "submitted",
      }),
    ]).returning();

    const updated = await api("PUT", `/forms/${draft!.id}`, {
      token: owner.token,
      body: updateBody(draft!.id),
    });
    expect(updated.status).toBe(200);
    expect(updated.json.title).toBe("Owner draft revised");

    const denied = await api("POST", `/forms/${submitted!.id}/review`, {
      token: owner.token,
      body: { decision: "approve" },
    });
    expect(denied.status).toBe(403);

    const approved = await api("POST", `/forms/${submitted!.id}/review`, {
      token: approver.token,
      body: { decision: "approve" },
    });
    expect(approved.status).toBe(200);
    expect(approved.json.workflowState).toBe("Approved");
  });
});

describe("atomic lesson review decisions", () => {
  it("allows exactly one of simultaneous approve and send_back requests to decide the form", async () => {
    const [lesson] = await db.insert(lessonLearnedForms).values(
      lessonValues(`RACE-${suffix}`, owner.id, {
        approverId: approver.id,
        workflowState: "submitted",
      }),
    ).returning();

    const [approve, sendBack] = await Promise.all([
      api("POST", `/forms/${lesson!.id}/review`, {
        token: approver.token,
        body: { decision: "approve" },
      }),
      api("POST", `/forms/${lesson!.id}/review`, {
        token: approver.token,
        body: { decision: "send_back", comments: "Needs another revision" },
      }),
    ]);
    expect([approve.status, sendBack.status].sort()).toEqual([200, 409]);

    const [stored] = await db.select().from(lessonLearnedForms).where(eq(lessonLearnedForms.id, lesson!.id));
    const winner = approve.status === 200 ? "approve" : "send_back";
    expect(stored!.reviewDecision).toBe(winner);
    expect(stored!.workflowState).toBe(winner === "approve" ? "approved" : "sent_back");
    expect(stored!.reviewedById).toBe(approver.id);
    expect(stored!.reviewedAt).not.toBeNull();
  });
});

describe("sent-back correction and resubmission", () => {
  it("moves the lesson between creator and approver action queues while preserving reviewer comments", async () => {
    const [lesson] = await db.insert(lessonLearnedForms).values(
      lessonValues(`RESUBMIT-${suffix}`, owner.id, {
        approverId: approver.id,
        workflowState: "submitted",
        submittedAt: new Date("2026-05-20T10:00:00.000Z"),
        submittedById: owner.id,
      }),
    ).returning();

    await db.insert(lessonsEvidenceFiles).values([
      {
        organizationId: orgId, app: "lessons", recordType: "lesson_form", recordId: lesson!.id,
        category: "before", fileName: "before.jpg", mimeType: "image/jpeg", sizeBytes: 100,
        storageKey: `tests/${suffix}/before.jpg`, uploadedById: owner.id, status: "stored",
      },
      {
        organizationId: orgId, app: "lessons", recordType: "lesson_form", recordId: lesson!.id,
        category: "after", fileName: "after.jpg", mimeType: "image/jpeg", sizeBytes: 100,
        storageKey: `tests/${suffix}/after.jpg`, uploadedById: owner.id, status: "stored",
      },
    ]);

    const approverBefore = await api("GET", "/log?pendingApproval=true&limit=100", { token: approver.token });
    expect(approverBefore.status).toBe(200);
    expect(approverBefore.json.items.some((row: { id: string }) => row.id === lesson!.id)).toBe(true);

    const sentBack = await api("POST", `/forms/${lesson!.id}/review`, {
      token: approver.token,
      body: { decision: "send_back", comments: "Clarify the corrective action and resubmit." },
    });
    expect(sentBack.status).toBe(200);
    expect(sentBack.json.workflowState).toBe("Sent Back");
    expect(sentBack.json.reviewComments).toBe("Clarify the corrective action and resubmit.");

    const creatorQueue = await api("GET", "/log?pendingApproval=true&limit=100", { token: owner.token });
    const approverAfterSendBack = await api("GET", "/log?pendingApproval=true&limit=100", { token: approver.token });
    expect(creatorQueue.json.items.find((row: { id: string }) => row.id === lesson!.id)?.workflowState).toBe("Sent Back");
    expect(approverAfterSendBack.json.items.some((row: { id: string }) => row.id === lesson!.id)).toBe(false);

    const creatorDetail = await api("GET", `/forms/${lesson!.id}`, { token: owner.token });
    const approverActivity = await api("GET", `/forms/${lesson!.id}/activity`, { token: approver.token });
    expect(creatorDetail.json.reviewComments).toBe("Clarify the corrective action and resubmit.");
    expect(approverActivity.json.items.find((entry: { action: string }) => entry.action === "send_back")?.after.reviewComments)
      .toBe("Clarify the corrective action and resubmit.");

    const corrected = await api("PUT", `/forms/${lesson!.id}`, {
      token: owner.token,
      body: updateBody(lesson!.id, { correctiveAction: "Corrected action with clear ownership", workflowState: "Sent Back" }),
    });
    expect(corrected.status).toBe(200);
    expect(corrected.json.workflowState).toBe("Draft");

    const resubmitted = await api("POST", `/forms/${lesson!.id}/submit`, { token: owner.token });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.json.workflowState).toBe("Submitted");
    expect(resubmitted.json.reviewComments).toBe("Clarify the corrective action and resubmit.");

    const creatorAfterResubmit = await api("GET", "/log?pendingApproval=true&limit=100", { token: owner.token });
    const approverAfterResubmit = await api("GET", "/log?pendingApproval=true&limit=100", { token: approver.token });
    expect(creatorAfterResubmit.json.items.some((row: { id: string }) => row.id === lesson!.id)).toBe(false);
    expect(approverAfterResubmit.json.items.some((row: { id: string }) => row.id === lesson!.id)).toBe(true);
  });
});