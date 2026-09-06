import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import {
  applicationAccess, auditLogEntries, db, integrationConnectors, lessonLearnedForms,
  lessonNotifications, lessonsAuditLogEntries, lessonsDisciplines, masterDataGroups, masterDataValues,
  notifications, organizations, organizationSettings, permissions, platformRoles,
  projects, qaqcMetricEntries, qualityAssessmentBriefs, syncJobs, users, userWorkspaceRoles,
  workspaceRolePermissions, workspaceRoles,
} from "@workspace/db";
import integrationsRouter from "../src/routes/integrations";
import lessonsRouter from "../src/routes/lessons";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";

// Route tests for designated-approver workflows (#18), creator self-approval
// blocking (#20), real sync-job email retries (#13), and connector test emails
// (#12). Runs against the development database with a throwaway organization.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let projectId: string;
let adminA: { id: string; token: string };
let approverA: { id: string; token: string };
let creatorA: { id: string; token: string };
let memberA: { id: string; token: string };
let platformConnectorId: string;
let emailConnectorId: string;
let disabledEmailConnectorId: string;
let lessonId: string;

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

async function insertMetric(status = "draft") {
  const [row] = await db.insert(qaqcMetricEntries).values({
    organizationId: orgId, projectId, reportingPeriod: "2026-08-01",
    category: `NCR ${suffix} ${Math.random().toString(36).slice(2, 6)}`, status,
  }).returning();
  return row!;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", integrationsRouter);
  app.use("/api/lessons", lessonsRouter);
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Approval Test Org ${suffix}`, code: `AT${suffix}` }).returning();
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
  const [approverRow] = await insertUser("Approver One", role!.id);
  const [creatorRow] = await insertUser("Creator One");
  const [memberRow] = await insertUser("Member One");
  adminA = { id: adminRow!.id, token: issueToken(adminRow!) };
  approverA = { id: approverRow!.id, token: issueToken(approverRow!) };
  creatorA = { id: creatorRow!.id, token: issueToken(creatorRow!) };
  memberA = { id: memberRow!.id, token: issueToken(memberRow!) };

  for (const user of [creatorRow!, memberRow!]) {
    await db.insert(applicationAccess).values({
      organizationId: orgId, username: user.username, canOpenQaqc: true, canOpenLessons: true,
    });
  }

  // Plain members need a workspace role granting the metrics module to submit.
  const [qaRole] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: `QA Contributor ${suffix}` }).returning();
  const [metricsPerm] = await db.insert(permissions).values({ organizationId: orgId, key: "metrics", label: "Metrics", category: "qaqc" }).returning();
  await db.insert(workspaceRolePermissions).values({ organizationId: orgId, workspaceRoleId: qaRole!.id, permissionId: metricsPerm!.id, grant: "full" });
  for (const user of [creatorRow!, memberRow!]) {
    await db.insert(userWorkspaceRoles).values({ organizationId: orgId, userId: user.id, workspaceRoleId: qaRole!.id });
  }

  const [project] = await db.insert(projects).values({ organizationId: orgId, code: `P-${suffix}`, name: "Approval Test Project" }).returning();
  projectId = project!.id;

  const [platformConn] = await db.insert(integrationConnectors).values({ organizationId: orgId, connectorType: "platform", name: "ERP", isEnabled: true }).returning();
  const [emailConn] = await db.insert(integrationConnectors).values({ organizationId: orgId, connectorType: "email", name: "SMTP", isEnabled: true, configuration: {} }).returning();
  const [disabledConn] = await db.insert(integrationConnectors).values({ organizationId: orgId, connectorType: "email", name: "SMTP off", isEnabled: false, configuration: {} }).returning();
  platformConnectorId = platformConn!.id;
  emailConnectorId = emailConn!.id;
  disabledEmailConnectorId = disabledConn!.id;

  const [lesson] = await db.insert(lessonLearnedForms).values({
    organizationId: orgId, projectId, referenceNumber: `L-${suffix}`,
    title: "Creator self-approval guard", issueCategory: "Process", impact: "Medium",
    creatorId: adminA.id, approverId: approverA.id, workflowState: "submitted",
  }).returning();
  lessonId = lesson!.id;

  // Master-data values the lesson create/update routes validate against.
  for (const [code, values] of [
    ["disciplines", ["Civil"]],
    ["lesson_categorisations", ["Process"]],
    ["lesson_issue_categories", ["Process"]],
    ["lesson_impacts", ["Medium"]],
  ] as Array<[string, string[]]>) {
    const [group] = await db.insert(masterDataGroups).values({ organizationId: orgId, code, name: code }).returning();
    for (const value of values) {
      await db.insert(masterDataValues).values({ organizationId: orgId, groupId: group!.id, value, label: value });
    }
  }
});

afterAll(async () => {
  await settle(); // let fire-and-forget notification emails settle before teardown
  await new Promise((resolve) => server.close(resolve));
  await db.delete(notifications).where(eq(notifications.organizationId, orgId));
  await db.delete(lessonNotifications).where(eq(lessonNotifications.organizationId, orgId));
  await db.delete(auditLogEntries).where(eq(auditLogEntries.organizationId, orgId));
  await db.delete(lessonsAuditLogEntries).where(eq(lessonsAuditLogEntries.organizationId, orgId));
  await db.delete(syncJobs).where(eq(syncJobs.organizationId, orgId));
  await db.delete(qaqcMetricEntries).where(eq(qaqcMetricEntries.organizationId, orgId));
  await db.delete(qualityAssessmentBriefs).where(eq(qualityAssessmentBriefs.organizationId, orgId));
  await db.delete(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, orgId));
  await db.delete(lessonsDisciplines).where(eq(lessonsDisciplines.organizationId, orgId));
  await db.delete(masterDataValues).where(eq(masterDataValues.organizationId, orgId));
  await db.delete(masterDataGroups).where(eq(masterDataGroups.organizationId, orgId));
  await db.delete(applicationAccess).where(eq(applicationAccess.organizationId, orgId));
  await db.delete(userWorkspaceRoles).where(eq(userWorkspaceRoles.organizationId, orgId));
  await db.delete(workspaceRolePermissions).where(eq(workspaceRolePermissions.organizationId, orgId));
  await db.delete(permissions).where(eq(permissions.organizationId, orgId));
  await db.delete(workspaceRoles).where(eq(workspaceRoles.organizationId, orgId));
  await db.delete(integrationConnectors).where(eq(integrationConnectors.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("QA/QC designated approver (#18)", () => {
  it("lists eligible approvers excluding the requester", async () => {
    const res = await api("GET", "/qaqc/approvers", { token: creatorA.token });
    expect(res.status).toBe(200);
    const ids = res.json.map((a: any) => a.id);
    expect(ids).toContain(adminA.id);
    expect(ids).toContain(approverA.id);
    expect(ids).not.toContain(creatorA.id);
    expect(ids).not.toContain(memberA.id);
  });

  it("rejects metric submission without an approver", async () => {
    const metric = await insertMetric();
    const res = await api("POST", `/qaqc/metrics/${metric.id}/submit`, { token: creatorA.token });
    expect(res.status).toBe(422);
  });

  it("rejects self as approver and non-eligible approvers", async () => {
    const metric = await insertMetric();
    const self = await api("POST", `/qaqc/metrics/${metric.id}/submit`, { token: creatorA.token, body: { approverId: creatorA.id } });
    expect(self.status).toBe(422);
    const plain = await api("POST", `/qaqc/metrics/${metric.id}/submit`, { token: creatorA.token, body: { approverId: memberA.id } });
    expect(plain.status).toBe(422);
  });

  it("stores the designated approver on submission and gates review", async () => {
    const metric = await insertMetric();
    const submitted = await api("POST", `/qaqc/metrics/${metric.id}/submit`, { token: creatorA.token, body: { approverId: approverA.id } });
    expect(submitted.status).toBe(200);
    expect(submitted.json.approverId).toBe(approverA.id);

    const bySubmitter = await api("POST", `/qaqc/metrics/${metric.id}/review`, { token: creatorA.token, body: { decision: "approve" } });
    expect(bySubmitter.status).toBe(403);
    const byBystander = await api("POST", `/qaqc/metrics/${metric.id}/review`, { token: memberA.token, body: { decision: "approve" } });
    expect(byBystander.status).toBe(403);

    const byApprover = await api("POST", `/qaqc/metrics/${metric.id}/review`, { token: approverA.token, body: { decision: "approve" } });
    expect(byApprover.status).toBe(200);
    expect(byApprover.json.workflowState).toBe("Approved");
  });

  it("lets a non-designated org admin review via bypass", async () => {
    const metric = await insertMetric();
    await api("POST", `/qaqc/metrics/${metric.id}/submit`, { token: creatorA.token, body: { approverId: approverA.id } });
    const res = await api("POST", `/qaqc/metrics/${metric.id}/review`, { token: adminA.token, body: { decision: "send_back", comments: "Rework" } });
    expect(res.status).toBe(200);
    expect(res.json.workflowState).toBe("Sent Back");
  });

  it("blocks admins from reviewing briefs they submitted themselves", async () => {
    const [brief] = await db.insert(qualityAssessmentBriefs).values({
      organizationId: orgId, projectId, reportingPeriod: "2026-08-01", narrative: "Narrative",
    }).returning();
    const submitted = await api("POST", `/qaqc/quality-briefs/${brief!.id}/submit`, { token: adminA.token, body: { approverId: approverA.id } });
    expect(submitted.status).toBe(200);

    const selfReview = await api("POST", `/qaqc/quality-briefs/${brief!.id}/review`, { token: adminA.token, body: { decision: "approve" } });
    expect(selfReview.status).toBe(403);
    const byApprover = await api("POST", `/qaqc/quality-briefs/${brief!.id}/review`, { token: approverA.token, body: { decision: "approve" } });
    expect(byApprover.status).toBe(200);
  });
});

describe("lesson creator self-approval (#20)", () => {
  it("blocks the creator from reviewing even with admin bypass, allows the designated approver", async () => {
    const selfReview = await api("POST", `/lessons/forms/${lessonId}/review`, { token: adminA.token, body: { decision: "approve" } });
    expect(selfReview.status).toBe(403);
    expect(selfReview.json.error).toContain("created");

    const byApprover = await api("POST", `/lessons/forms/${lessonId}/review`, { token: approverA.token, body: { decision: "approve" } });
    expect(byApprover.status).toBe(200);
  });

  const draftLessonBody = (approverId: string | null) => ({
    id: randomUUID(), projectId, title: "Admin self-approval guard",
    disciplineId: "Civil", categorisationId: "Process", issueCategory: "Process", impact: "Medium",
    description: "desc", rootCause: "cause", correction: "fix", correctiveAction: "action",
    version: 1, conflictFlag: false, workflowState: "Draft", approverId,
  });

  it("rejects approverId === creatorId on create even for platform admins", async () => {
    const selfAssigned = await api("POST", "/lessons/forms", { token: adminA.token, body: draftLessonBody(adminA.id) });
    expect(selfAssigned.status).toBe(422);
    expect(selfAssigned.json.error).toContain("different from the creator");

    // Admins can still create lessons with a different approver.
    const assigned = await api("POST", "/lessons/forms", { token: adminA.token, body: draftLessonBody(approverA.id) });
    expect(assigned.status).toBe(201);
    expect(assigned.json.approverId).toBe(approverA.id);
  });

  it("rejects approverId === creatorId on update even for platform admins", async () => {
    const created = await api("POST", "/lessons/forms", { token: adminA.token, body: draftLessonBody(approverA.id) });
    expect(created.status).toBe(201);

    const selfAssigned = await api("PUT", `/lessons/forms/${created.json.id}`, {
      token: adminA.token, body: draftLessonBody(adminA.id),
    });
    expect(selfAssigned.status).toBe(422);
    expect(selfAssigned.json.error).toContain("different from the creator");

    const reassigned = await api("PUT", `/lessons/forms/${created.json.id}`, {
      token: adminA.token, body: draftLessonBody(approverA.id),
    });
    expect(reassigned.status).toBe(200);
    expect(reassigned.json.approverId).toBe(approverA.id);
  });
});

describe("sync job retry resends failed emails (#13)", () => {
  const insertJob = (outcome: string, jobType: string, errorQueue: Array<Record<string, unknown>>) =>
    db.insert(syncJobs).values({ organizationId: orgId, connectorId: emailConnectorId, jobType, outcome, errorQueue }).returning();

  it("rejects retrying jobs that did not fail", async () => {
    const [job] = await insertJob("success", "email_delivery", []);
    const res = await api("POST", `/integrations/sync-jobs/${job!.id}/retry`, { token: adminA.token });
    expect(res.status).toBe(409);
  });

  it("rejects retrying failed jobs without a recorded email payload", async () => {
    const [job] = await insertJob("failed", "oracle_sync", [{ message: "boom" }]);
    const res = await api("POST", `/integrations/sync-jobs/${job!.id}/retry`, { token: adminA.token });
    expect(res.status).toBe(422);
  });

  it("rejects legacy failed email jobs recorded before payloads existed", async () => {
    const [job] = await insertJob("failed", "email_delivery", [{ message: "old failure" }]);
    const res = await api("POST", `/integrations/sync-jobs/${job!.id}/retry`, { token: adminA.token });
    expect(res.status).toBe(422);
  });

  it("resends the recorded payload and records the new outcome", async () => {
    const [job] = await insertJob("failed", "email_delivery", [{
      message: "SMTP down", recipientIds: [creatorA.id], subject: "SLA breached", text: "A lesson SLA was breached.",
    }]);
    const res = await api("POST", `/integrations/sync-jobs/${job!.id}/retry`, { token: adminA.token });
    expect(res.status).toBe(200);
    // The connector has no SMTP host configured, so the resend is attempted and re-fails.
    expect(res.json.status).toBe("failed");
    expect(res.json.error).toContain("Retry");

    const [after] = await db.select().from(syncJobs).where(eq(syncJobs.id, job!.id));
    expect(after!.lastRunAt).not.toBeNull();
    expect(after!.outcome).toBe("failed");
  });

  it("forbids non-admin retries", async () => {
    const [job] = await insertJob("failed", "email_delivery", [{ recipientIds: [creatorA.id], subject: "s", text: "t" }]);
    const res = await api("POST", `/integrations/sync-jobs/${job!.id}/retry`, { token: memberA.token });
    expect(res.status).toBe(403);
  });
});

describe("connector test email (#12)", () => {
  it("rejects non-email connectors", async () => {
    const res = await api("POST", `/integrations/connectors/${platformConnectorId}/test-email`, { token: adminA.token });
    expect(res.status).toBe(422);
  });

  it("rejects disabled email connectors", async () => {
    const res = await api("POST", `/integrations/connectors/${disabledEmailConnectorId}/test-email`, { token: adminA.token });
    expect(res.status).toBe(422);
  });

  it("requires admin", async () => {
    const res = await api("POST", `/integrations/connectors/${emailConnectorId}/test-email`, { token: memberA.token });
    expect(res.status).toBe(403);
  });

  it("fails cleanly and records a sync job when SMTP is unconfigured", async () => {
    const res = await api("POST", `/integrations/connectors/${emailConnectorId}/test-email`, { token: adminA.token });
    expect(res.status).toBe(422);
    const rows = await db.select().from(syncJobs).where(and(
      eq(syncJobs.organizationId, orgId), eq(syncJobs.connectorId, emailConnectorId), eq(syncJobs.jobType, "email_delivery"),
    ));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.outcome === "failed")).toBe(true);
  });
});
