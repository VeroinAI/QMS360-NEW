import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import * as Api from "@workspace/api-zod";
import {
  applicationAccess,
  auditAuditLogEntries,
  auditDelegations,
  auditEscalationRules,
  auditEvidenceFiles,
  auditFindings,
  auditNotificationTemplates,
  auditNotifications,
  auditPlans,
  auditSchedules,
  auditUserWorkspaceRoles,
  auditWorkspaceRoles,
  audits,
  correctiveActionReports,
  db,
  organizationSettings,
  users,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { requireAppAccess, requirePermission } from "../middlewares/rbac";
import { assertProjectInOrg } from "../lib/tenancy";
import { confirmEvidence, createEvidenceIntent, listEvidence } from "../lib/evidence";
import { asyncHandler, HttpError, notify, paginated, pagination, writeAuditLog } from "../lib/workspace";

const router = Router();
router.use(requireAuth);
router.use(requireAppAccess("audit"));
const auditModules: Array<[string, string]> = [
  ["/schedules", "schedules"], ["/plans", "plans"], ["/audits", "audits"],
  ["/findings", "findings"], ["/cars", "cars"],
];
for (const [path, module] of auditModules) {
  router.use(path, (req, res, next) =>
    requirePermission("audit", module, req.method === "GET" ? "select" : "full")(req, res, next));
}
router.use("/evidence", (req, res, next) =>
  requirePermission("audit", "audits", req.method === "GET" ? "select" : "full")(req, res, next));
router.use(asyncHandler(async (req, _res, next) => {
  if (req.method !== "GET" && typeof req.body?.projectId === "string") {
    await assertProjectInOrg(db, actor(req).organizationId, req.body.projectId);
  }
  next();
}));

type AnyRow = Record<string, any>;
const active = (table: AnyRow, organizationId: string) =>
  and(eq(table.organizationId, organizationId), isNull(table.deletedAt));
const actor = (req: Request) => req.currentUser!;
const body = <T>(schema: { safeParse: (value: unknown) => any }, req: Request): T => {
  const result = schema.safeParse(req.body);
  if (!result.success) throw new HttpError(422, result.error.issues.map((i: any) => i.message).join("; "));
  return result.data as T;
};
const auditLog = (req: Request, action: string, entityType: string, entityId: string, before?: AnyRow, after?: AnyRow) =>
  writeAuditLog(db, "audit", {
    organizationId: actor(req).organizationId, actorId: actor(req).id, action, entityType, entityId,
    before, after, ipAddress: req.ip,
  });
const dateOnly = (value: Date | string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : null;
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const csv = (res: Response, name: string, rows: AnyRow[]) => {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  res.send([keys.map(escape).join(","), ...rows.map((row) => keys.map((key) =>
    escape(typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key])).join(","))].join("\n"));
};
const maybeCsv = (req: Request, res: Response, name: string, rows: AnyRow[]) => {
  if (String(req.query.format ?? "").toLowerCase() === "csv" || req.accepts(["json", "text/csv"]) === "text/csv") {
    csv(res, name, rows);
    return true;
  }
  return false;
};

type ScheduleMeta = {
  projectIds?: string[]; auditTypes?: string[]; plannedStartDate?: string;
  plannedEndDate?: string; reviewComments?: string | null;
};
const scheduleMeta = (row: AnyRow): ScheduleMeta => parseJson(row.status, {});
const scheduleDto = (row: AnyRow) => {
  const meta = scheduleMeta(row);
  return {
    id: row.id, year: row.year, title: row.title, projectIds: meta.projectIds ?? (row.projectId ? [row.projectId] : []),
    auditTypes: meta.auditTypes ?? [], plannedStartDate: new Date(meta.plannedStartDate ?? `${row.year}-01-01`),
    plannedEndDate: new Date(meta.plannedEndDate ?? `${row.year}-12-31`), ownerId: row.ownerId ?? undefined,
    workflowState: ({ draft: "Draft", submitted: "Submitted", approved: "Approved", sent_back: "Sent Back" } as AnyRow)[row.workflowState] ?? "Draft",
    reviewComments: meta.reviewComments ?? null,
  };
};
const scheduleValues = (data: AnyRow) => ({
  id: data.id, year: data.year, title: data.title, projectId: data.projectIds[0] ?? null,
  ownerId: data.ownerId ?? null,
  workflowState: ({ Draft: "draft", Submitted: "submitted", Approved: "approved", "Sent Back": "sent_back", Deleted: "deleted" } as AnyRow)[data.workflowState],
  status: JSON.stringify({
    projectIds: data.projectIds, auditTypes: data.auditTypes ?? [], plannedStartDate: dateOnly(data.plannedStartDate),
    plannedEndDate: dateOnly(data.plannedEndDate), reviewComments: data.reviewComments ?? null,
  }),
});

router.get("/schedules", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = active(auditSchedules, actor(req).organizationId);
  const [items, [{ count }]] = await Promise.all([
    db.select().from(auditSchedules).where(where).orderBy(desc(auditSchedules.year), desc(auditSchedules.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditSchedules).where(where),
  ]);
  res.json(paginated(items.map(scheduleDto), Number(count), page, limit));
}));
router.post("/schedules", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditScheduleBody, req);
  const [row] = await db.insert(auditSchedules).values({ organizationId: actor(req).organizationId, ...scheduleValues(data) }).returning();
  await auditLog(req, "create", "audit_schedule", row.id, undefined, row);
  res.status(201).json(scheduleDto(row));
}));
router.get("/schedules/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit schedule not found");
  res.json(scheduleDto(row));
}));
router.put("/schedules/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditScheduleBody, req);
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back schedules may be edited");
  const [row] = await db.update(auditSchedules).set({ ...scheduleValues(data), id: undefined, updatedAt: new Date() })
    .where(eq(auditSchedules.id, before.id)).returning();
  await auditLog(req, "update", "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));
router.delete("/schedules/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditSchedules).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit schedule not found");
  await auditLog(req, "delete", "audit_schedule", row.id, row);
  res.status(204).end();
}));
router.post("/schedules/:id/submit", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Schedule is not eligible for submission");
  const [row] = await db.update(auditSchedules).set({ workflowState: "submitted", updatedAt: new Date() }).where(eq(auditSchedules.id, before.id)).returning();
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, actor(req).organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)));
  await Promise.all(admins.filter((u) => u.id !== actor(req).id).map((u) => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: u.id, type: "schedule_submitted",
    title: "Audit schedule awaiting review", body: `${row.title} has been submitted.`, entityType: "audit_schedule", entityId: row.id,
  })));
  await auditLog(req, "submit", "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));
router.post("/schedules/:id/review", requireAdmin, asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.ReviewAuditScheduleBody, req);
  if (data.decision === "send_back" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit schedule not found");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted schedules may be reviewed");
  const meta = scheduleMeta(before);
  const [row] = await db.update(auditSchedules).set({
    workflowState: data.decision === "approve" ? "approved" : "sent_back",
    status: JSON.stringify({ ...meta, reviewComments: data.comments ?? null }), updatedAt: new Date(),
  }).where(eq(auditSchedules.id, before.id)).returning();
  if (before.ownerId) await notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: before.ownerId, type: "schedule_decision",
    title: `Audit schedule ${data.decision === "approve" ? "approved" : "sent back"}`,
    body: data.comments || row.title, entityType: "audit_schedule", entityId: row.id,
  });
  await auditLog(req, data.decision, "audit_schedule", row.id, before, row);
  res.json(scheduleDto(row));
}));

type PlanMeta = { objectives?: string | null; leadAuditorId?: string; processOwnerIds?: string[]; feasibilityNotes?: string | null };
const planMeta = (row: AnyRow): PlanMeta => parseJson(row.status, {});
const planDto = (row: AnyRow) => {
  const meta = planMeta(row);
  return {
    id: row.id, scheduleId: row.auditScheduleId!, scope: row.scope ?? "", objectives: meta.objectives ?? null,
    criteria: parseJson(row.criteria, row.criteria ? [row.criteria] : []), auditDate: new Date(row.auditDate!),
    location: row.location ?? "", leadAuditorId: meta.leadAuditorId, teamMemberIds: row.teamMemberIds,
    processOwnerIds: meta.processOwnerIds ?? [], feasibilityNotes: meta.feasibilityNotes ?? null,
    status: ({ draft: "Draft", shared: "Shared", active: "Active", completed: "Completed" } as AnyRow)[row.workflowState] ?? "Draft",
  };
};
const planValues = (data: AnyRow) => ({
  id: data.id, auditScheduleId: data.scheduleId, scope: data.scope, criteria: JSON.stringify(data.criteria),
  auditDate: dateOnly(data.auditDate)!, location: data.location, teamMemberIds: data.teamMemberIds,
  workflowState: String(data.status).toLowerCase(),
  status: JSON.stringify({ objectives: data.objectives ?? null, leadAuditorId: data.leadAuditorId, processOwnerIds: data.processOwnerIds ?? [], feasibilityNotes: data.feasibilityNotes ?? null }),
});
router.get("/plans", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditPlans, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditPlans).where(where).orderBy(desc(auditPlans.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditPlans).where(where),
  ]);
  res.json(paginated(rows.map(planDto), Number(count), page, limit));
}));
router.post("/plans", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditPlanBody, req);
  const [schedule] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, data.scheduleId)));
  if (!schedule) throw new HttpError(404, "Audit schedule not found");
  const [row] = await db.insert(auditPlans).values({ organizationId: actor(req).organizationId, projectId: schedule.projectId, ...planValues(data) }).returning();
  await auditLog(req, "create", "audit_plan", row.id, undefined, row); res.status(201).json(planDto(row));
}));
router.get("/plans/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit plan not found"); res.json(planDto(row));
}));
router.put("/plans/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditPlanBody, req);
  const [before] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit plan not found");
  const [row] = await db.update(auditPlans).set({ ...planValues(data), id: undefined, updatedAt: new Date() }).where(eq(auditPlans.id, before.id)).returning();
  await auditLog(req, "update", "audit_plan", row.id, before, row); res.json(planDto(row));
}));
router.delete("/plans/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditPlans).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit plan not found"); await auditLog(req, "delete", "audit_plan", row.id, row); res.status(204).end();
}));
router.post("/plans/:id/share", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit plan not found");
  if (before.workflowState !== "draft") throw new HttpError(409, "Only draft plans can be shared");
  const [row] = await db.update(auditPlans).set({ workflowState: "shared", updatedAt: new Date() }).where(eq(auditPlans.id, before.id)).returning();
  await Promise.all((planMeta(row).processOwnerIds ?? []).map((id) => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: id, type: "plan_shared", title: "Audit plan shared",
    body: row.scope ?? "An audit plan has been shared with you.", entityType: "audit_plan", entityId: row.id,
  })));
  await auditLog(req, "share", "audit_plan", row.id, before, row); res.status(202).json(planDto(row));
}));

type AuditMeta = { title?: string; openingMeeting?: AnyRow; closingMeeting?: AnyRow; startedAt?: string | null; closedAt?: string | null };
const auditMeta = (row: AnyRow): AuditMeta => parseJson(row.status, {});
const auditDto = (row: AnyRow) => {
  const meta = auditMeta(row);
  return {
    id: row.id, planId: row.auditPlanId!, projectId: row.projectId!, title: meta.title ?? row.referenceNumber,
    status: ({ planned: "Planned", "in progress": "In Progress", "report draft": "Report Draft", "car follow-up": "CAR Follow-up", closed: "Closed", scheduled: "Planned" } as AnyRow)[row.workflowState.toLowerCase()] ?? "Planned",
    openingMeeting: meta.openingMeeting ? { ...meta.openingMeeting, heldAt: new Date(meta.openingMeeting.heldAt) } : undefined,
    closingMeeting: meta.closingMeeting ? { ...meta.closingMeeting, heldAt: new Date(meta.closingMeeting.heldAt) } : undefined,
    checklist: Array.isArray(row.checklistState) ? row.checklistState : [],
    startedAt: meta.startedAt ? new Date(meta.startedAt) : null, closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
};
const auditValues = (data: AnyRow) => ({
  id: data.id, auditPlanId: data.planId, projectId: data.projectId, referenceNumber: data.title,
  workflowState: String(data.status).toLowerCase(), checklistState: data.checklist ?? [],
  openingMeetingMinutes: data.openingMeeting?.minutes, closingMeetingMinutes: data.closingMeeting?.minutes,
  status: JSON.stringify({
    title: data.title, openingMeeting: data.openingMeeting, closingMeeting: data.closingMeeting,
    startedAt: data.startedAt?.toISOString?.() ?? data.startedAt ?? null, closedAt: data.closedAt?.toISOString?.() ?? data.closedAt ?? null,
  }),
});
router.get("/audits", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(audits, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(audits).where(where).orderBy(desc(audits.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(audits).where(where),
  ]); res.json(paginated(rows.map(auditDto), Number(count), page, limit));
}));
router.post("/audits", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditBody, req);
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.planId)));
  if (!plan) throw new HttpError(422, "Audit plan does not belong to this organization");
  if (data.projectId && plan.projectId && data.projectId !== plan.projectId) {
    throw new HttpError(422, "Audit project must match the selected plan");
  }
  if (plan.auditScheduleId) {
    const [schedule] = await db.select({ projectId: auditSchedules.projectId }).from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, plan.auditScheduleId),
    )).limit(1);
    if (!schedule) throw new HttpError(422, "Audit plan is not linked to a valid schedule");
    if (data.projectId && schedule.projectId && data.projectId !== schedule.projectId) {
      throw new HttpError(422, "Audit project must match the plan schedule");
    }
  }
  try {
    const [row] = await db.insert(audits).values({ organizationId: actor(req).organizationId, ...auditValues(data) }).returning();
    await auditLog(req, "create", "audit", row.id, undefined, row); res.status(201).json(auditDto(row));
  } catch (error: any) {
    if (error?.code === "23505") throw new HttpError(409, "An active audit with this title already exists");
    throw error;
  }
}));
router.get("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit not found"); res.json(auditDto(row));
}));
router.put("/audits/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const [row] = await db.update(audits).set({ ...auditValues(data), id: undefined, updatedAt: new Date() }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, "update", "audit", row.id, before, row); res.json(auditDto(row));
}));
router.delete("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(audits).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit not found"); await auditLog(req, "delete", "audit", row.id, row); res.status(204).end();
}));
async function updateMeeting(req: Request, kind: "opening" | "closing", schema: { safeParse: (value: unknown) => any }) {
  const data = body<AnyRow>(schema, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const meta = auditMeta(before); meta[`${kind}Meeting`] = { ...data, heldAt: data.heldAt.toISOString() };
  if (kind === "opening" && !meta.startedAt) meta.startedAt = data.heldAt.toISOString();
  const [row] = await db.update(audits).set({
    status: JSON.stringify(meta), [kind === "opening" ? "openingMeetingMinutes" : "closingMeetingMinutes"]: data.minutes,
    workflowState: kind === "opening" && before.workflowState === "planned" ? "in progress" : before.workflowState, updatedAt: new Date(),
  }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, `${kind}_meeting`, "audit", row.id, before, row); return row;
}
router.put("/audits/:id/opening-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "opening", Api.UpdateAuditOpeningMeetingBody)))));
router.put("/audits/:id/closing-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "closing", Api.UpdateAuditClosingMeetingBody)))));
router.put("/audits/:id/checklist", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditChecklistBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const [row] = await db.update(audits).set({ checklistState: data as any, updatedAt: new Date() }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, "update_checklist", "audit", row.id, before, row); res.json(auditDto(row));
}));

type FindingMeta = { title?: string; clause?: string | null; responsibleDepartments?: string[]; evidenceIds?: string[]; raisedAt?: string };
const findingMeta = (row: AnyRow): FindingMeta => row.evidence ?? {};
const findingDto = (row: AnyRow) => {
  const meta = findingMeta(row);
  return {
    id: row.id, auditId: row.auditId, title: meta.title ?? "Audit finding", description: row.description ?? "",
    clause: meta.clause ?? null, classification: row.classification, priority: row.priority ?? "P6",
    riskLevel: row.riskLevel ?? "Low", responsibleDepartments: meta.responsibleDepartments ?? (row.responsibleDepartment ? [row.responsibleDepartment] : []),
    evidenceIds: meta.evidenceIds ?? [], status: row.status === "active" ? "Open" : row.status,
    raisedAt: new Date(meta.raisedAt ?? row.createdAt),
  };
};
const findingValues = (data: AnyRow) => ({
  id: data.id, auditId: data.auditId, responsibleDepartment: data.responsibleDepartments[0] ?? null,
  classification: data.classification, priority: data.priority, riskLevel: data.riskLevel, description: data.description,
  status: data.status === "Open" ? "active" : data.status,
  evidence: { title: data.title, clause: data.clause ?? null, responsibleDepartments: data.responsibleDepartments, evidenceIds: data.evidenceIds ?? [], raisedAt: data.raisedAt?.toISOString?.() ?? data.raisedAt ?? new Date().toISOString() },
});
const prioritySla: Record<string, number> = { P1: 2, P2: 2, P3: 2, P4: 2, P5: 3, P6: 3 };
router.get("/findings", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditFindings, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditFindings).where(where).orderBy(desc(auditFindings.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditFindings).where(where),
  ]); res.json(paginated(rows.map(findingDto), Number(count), page, limit));
}));
router.post("/findings", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditFindingBody, req);
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, data.auditId)));
  if (!audit) throw new HttpError(404, "Audit not found");
  const [row] = await db.insert(auditFindings).values({ organizationId: actor(req).organizationId, ...findingValues(data) }).returning();
  await auditLog(req, "create", "audit_finding", row.id, undefined, row); res.status(201).json(findingDto(row));
}));
router.get("/findings/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit finding not found"); res.json(findingDto(row));
}));
router.put("/findings/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditFindingBody, req);
  const [before] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit finding not found");
  const [row] = await db.update(auditFindings).set({ ...findingValues(data), id: undefined, updatedAt: new Date() }).where(eq(auditFindings.id, before.id)).returning();
  await auditLog(req, "update", "audit_finding", row.id, before, row); res.json(findingDto(row));
}));
router.delete("/findings/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditFindings).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit finding not found"); await auditLog(req, "delete", "audit_finding", row.id, row); res.status(204).end();
}));

type CarMeta = {
  extensionReason?: string | null; extensionReviewedBy?: string | null; extensionReviewedAt?: string | null;
  reviewComments?: string | null; effectivenessVerified?: boolean; closedAt?: string | null;
};
const carMeta = (row: AnyRow): CarMeta => parseJson(row.effectivenessNotes, {});
const carDto = (row: AnyRow) => {
  const meta = carMeta(row);
  return {
    id: row.id, findingId: row.auditFindingId, responsibleDepartment: row.responsibleDepartment,
    ownerId: row.ownerId ?? row.id, rootCause: row.rootCause, correction: row.correction, correctiveAction: row.correctiveAction,
    status: ({ open: "Open", draft: "Draft", submitted: "Submitted", accepted: "Accepted", rejected: "Rejected", extension_requested: "Extension Requested", closed: "Closed" } as AnyRow)[row.workflowState] ?? "Open",
    dueDate: new Date(row.dueDate ?? row.createdAt), extensionRequestedTo: row.extensionDueDate ? new Date(row.extensionDueDate) : null,
    extensionReason: meta.extensionReason ?? null,
    extensionStatus: row.extensionStatus === "none" ? null : row.extensionStatus === "requested" ? "pending" : row.extensionStatus,
    extensionReviewedBy: meta.extensionReviewedBy ?? null,
    extensionReviewedAt: meta.extensionReviewedAt ? new Date(meta.extensionReviewedAt) : null,
    effectivenessVerified: meta.effectivenessVerified ?? false, closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
};
router.post("/findings/:id/cars", asyncHandler(async (req, res) => {
  const data = body<{ responsibleDepartments: string[] }>(Api.CreateFindingCarsBody, req);
  const departments = [...new Set(data.responsibleDepartments.map((x) => x.trim()).filter(Boolean))];
  const [finding] = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.id, String(req.params.id))));
  if (!finding) throw new HttpError(404, "Audit finding not found");
  const existing = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.auditFindingId, finding.id), inArray(correctiveActionReports.responsibleDepartment, departments)));
  if (existing.length) throw new HttpError(409, `CAR already exists for: ${existing.map((x) => x.responsibleDepartment).join(", ")}`);
  const dueDate = new Date(Date.now() + (prioritySla[finding.priority ?? "P6"] ?? 3) * 86400000).toISOString().slice(0, 10);
  const rows = await db.insert(correctiveActionReports).values(departments.map((department) => ({
    organizationId: actor(req).organizationId, auditFindingId: finding.id, responsibleDepartment: department,
    ownerId: actor(req).id, workflowState: "open", dueDate,
  }))).returning();
  await db.update(auditFindings).set({ status: "CAR Issued", updatedAt: new Date() }).where(eq(auditFindings.id, finding.id));
  await Promise.all(rows.map((row) => auditLog(req, "create", "corrective_action_report", row.id, undefined, row)));
  res.status(201).json(paginated(rows.map(carDto), rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/cars", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const clauses: any[] = [active(correctiveActionReports, actor(req).organizationId)];
  if (req.query.status) clauses.push(eq(correctiveActionReports.workflowState, String(req.query.status).toLowerCase().replaceAll(" ", "_")));
  const where = and(...clauses);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(correctiveActionReports).where(where).orderBy(desc(correctiveActionReports.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(correctiveActionReports).where(where),
  ]); res.json(paginated(rows.map(carDto), Number(count), page, limit));
}));
router.put("/cars/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateCorrectiveActionReportBody, req);
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR cannot be edited in its current state");
  const [row] = await db.update(correctiveActionReports).set({
    rootCause: data.rootCause, correction: data.correction, correctiveAction: data.correctiveAction,
    ownerId: data.ownerId, dueDate: dateOnly(data.dueDate), workflowState: "draft", updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "update", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/submit", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR is not eligible for submission");
  if (!before.rootCause || !before.correction || !before.correctiveAction) throw new HttpError(422, "Root cause, correction, and corrective action are required");
  const [row] = await db.update(correctiveActionReports).set({ workflowState: "submitted", updatedAt: new Date() }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "submit", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/review", requireAdmin, asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCorrectiveActionReportBody, req);
  if (data.decision === "reject" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when rejecting");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted CARs may be reviewed");
  const [row] = await db.update(correctiveActionReports).set({
    workflowState: data.decision === "accept" ? "accepted" : "rejected",
    effectivenessNotes: JSON.stringify({ ...carMeta(before), reviewComments: data.comments ?? null }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "car_decision", title: `CAR ${data.decision}ed`, body: data.comments || "Your CAR has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, data.decision, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension", asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.RequestCarExtensionBody, req);
  if (!data.reason.trim()) throw new HttpError(422, "Extension reason is required");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (["closed"].includes(before.workflowState) || before.extensionStatus === "requested") throw new HttpError(409, "Extension cannot be requested");
  if (before.dueDate && dateOnly(data.requestedDueDate)! <= before.dueDate) throw new HttpError(422, "Requested due date must be after the current due date");
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: "requested", extensionRequestedAt: new Date(), extensionDueDate: dateOnly(data.requestedDueDate),
    workflowState: "extension_requested", effectivenessNotes: JSON.stringify({ ...carMeta(before), extensionReason: data.reason }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "request_extension", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension/review", requireAdmin, asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCarExtensionBody, req);
  if (data.decision === "reject" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when rejecting");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.extensionStatus !== "requested") throw new HttpError(409, "No extension is awaiting review");
  const meta = { ...carMeta(before), extensionReviewedBy: actor(req).id, extensionReviewedAt: new Date().toISOString(), reviewComments: data.comments ?? null };
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: data.decision === "approve" ? "approved" : "rejected",
    extensionApprovedAt: data.decision === "approve" ? new Date() : null,
    extensionDueDate: data.decision === "approve" ? before.extensionDueDate : null,
    workflowState: "accepted", effectivenessNotes: JSON.stringify(meta), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "extension_decision", title: `CAR extension ${data.decision}d`, body: data.comments || "Your extension request has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, `${data.decision}_extension`, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/close", requireAdmin, asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState !== "accepted") throw new HttpError(409, "Only accepted CARs may be closed");
  const [row] = await db.update(correctiveActionReports).set({
    workflowState: "closed", effectivenessNotes: JSON.stringify({ ...carMeta(before), effectivenessVerified: true, closedAt: new Date().toISOString() }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "close", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));

const evidenceDto = (row: AnyRow) => ({
  id: row.id, recordType: row.recordType, recordId: row.recordId, category: row.category, fileName: row.fileName,
  mimeType: row.mimeType, sizeBytes: row.sizeBytes,
  status: ({ uploading: "pending", stored: "confirmed", failed: "failed" } as AnyRow)[row.status] ?? row.status,
  clientReference: row.clientReference ?? row.id, storageUrl: row.status === "stored" ? `/api/files/${row.id}` : null,
  gpsLat: null, gpsLng: null, createdAt: row.createdAt,
});
router.post("/evidence", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditEvidenceIntentBody, req);
  const [settings] = await db.select().from(organizationSettings).where(and(eq(organizationSettings.organizationId, actor(req).organizationId), isNull(organizationSettings.deletedAt)));
  if (settings) {
    const limits = settings.evidenceLimits;
    const maxMb = data.mimeType.startsWith("image/") ? limits.photoMaxMb : data.mimeType.startsWith("video/") ? limits.videoMaxMb : limits.docMaxMb;
    if (data.sizeBytes > maxMb * 1024 * 1024) throw new HttpError(422, `File exceeds the organization's ${maxMb}MB limit`);
  }
  try {
    const intent = await createEvidenceIntent({
      app: "audit", recordType: data.recordType, recordId: data.recordId, category: data.category,
      fileName: data.fileName, mimeType: data.mimeType, sizeBytes: data.sizeBytes,
      clientReference: data.clientReference, userId: actor(req).id, organizationId: actor(req).organizationId,
    });
    await auditLog(req, "create", "evidence", intent.id, undefined, data); res.status(201).json(intent);
  } catch (error) {
    if (error instanceof Error) throw new HttpError(422, error.message);
    throw error;
  }
}));
router.put("/evidence/:id/confirm", asyncHandler(async (req, res) => {
  const row = await confirmEvidence(db, "audit", String(req.params.id), actor(req).organizationId);
  if (!row) throw new HttpError(404, "Evidence not found");
  await auditLog(req, "confirm", "evidence", row.id, undefined, row); res.json(evidenceDto(row));
}));
router.get("/evidence", asyncHandler(async (req, res) => {
  const parsed = Api.ListAuditEvidenceQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(422, parsed.error.message);
  const { page, limit } = parsed.data;
  const all = await listEvidence(db, "audit", actor(req).organizationId, parsed.data.recordType, parsed.data.recordId);
  res.json(paginated(all.slice((page - 1) * limit, page * limit).map(evidenceDto), all.length, page, limit));
}));

async function dashboardData(organizationId: string, projectId?: string) {
  const auditWhere = and(active(audits, organizationId), projectId ? eq(audits.projectId, projectId) : undefined);
  const [auditRows, findingRows, carRows] = await Promise.all([
    db.select().from(audits).where(auditWhere),
    db.select().from(auditFindings).where(active(auditFindings, organizationId)),
    db.select().from(correctiveActionReports).where(active(correctiveActionReports, organizationId)),
  ]);
  const countBy = (rows: AnyRow[], key: string) => rows.reduce((out: AnyRow, row) => ({ ...out, [row[key]]: (out[row[key]] ?? 0) + 1 }), {});
  const now = dateOnly(new Date())!;
  return {
    generatedAt: new Date(),
    metrics: {
      audits: { open: auditRows.filter((x) => x.workflowState !== "closed").length, closed: auditRows.filter((x) => x.workflowState === "closed").length },
      findingsByClassification: countBy(findingRows, "classification"),
      carStatus: countBy(carRows, "workflowState"),
      overdueCars: carRows.filter((x) => x.workflowState !== "closed" && (x.extensionDueDate ?? x.dueDate) && (x.extensionDueDate ?? x.dueDate)! < now).length,
      openFindings: findingRows.filter((x) => !["Closed", "Verified"].includes(x.status)).length,
    },
    series: Object.entries(countBy(findingRows, "classification")).map(([classification, count]) => ({ classification, count })),
  };
}
router.get("/dashboard", asyncHandler(async (req, res) => res.json(await dashboardData(actor(req).organizationId, req.query.projectId ? String(req.query.projectId) : undefined))));
router.get("/reports/open-vs-closed", asyncHandler(async (req, res) => {
  const report = await dashboardData(actor(req).organizationId, req.query.projectId ? String(req.query.projectId) : undefined);
  const rows = Object.entries(report.metrics.audits as AnyRow).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "audit-open-vs-closed", rows)) res.json(report);
}));
router.get("/reports/findings-log", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditFindings, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditFindings).where(where).orderBy(desc(auditFindings.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditFindings).where(where),
  ]); const result = rows.map(findingDto);
  if (!maybeCsv(req, res, "audit-findings-log", result)) res.json(paginated(result, Number(count), page, limit));
}));
router.get("/reports/ageing", asyncHandler(async (req, res) => {
  const [findings, cars] = await Promise.all([
    db.select().from(auditFindings).where(active(auditFindings, actor(req).organizationId)),
    db.select().from(correctiveActionReports).where(active(correctiveActionReports, actor(req).organizationId)),
  ]);
  const bucket = (createdAt: Date) => { const days = Math.floor((Date.now() - createdAt.valueOf()) / 86400000); return days <= 15 ? "0-15" : days <= 45 ? "16-45" : ">45"; };
  const rows = [...findings.map((x) => ({ type: "finding", bucket: bucket(x.createdAt), id: x.id })), ...cars.map((x) => ({ type: "CAR", bucket: bucket(x.createdAt), id: x.id }))];
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [`${x.type}:${x.bucket}`]: (out[`${x.type}:${x.bucket}`] ?? 0) + 1 }), {});
  if (!maybeCsv(req, res, "audit-ageing", rows)) res.json({ generatedAt: new Date(), metrics, series: rows });
}));
router.get("/reports/car-status", asyncHandler(async (req, res) => {
  const rows = await db.select().from(correctiveActionReports).where(active(correctiveActionReports, actor(req).organizationId));
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [x.workflowState]: (out[x.workflowState] ?? 0) + 1 }), {});
  const series = Object.entries(metrics).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "car-status", series)) res.json({ generatedAt: new Date(), metrics, series });
}));
router.get("/reports/schedule", asyncHandler(async (req, res) => {
  const rows = (await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)).orderBy(desc(auditSchedules.year))).map(scheduleDto);
  if (!maybeCsv(req, res, "annual-audit-schedule", rows)) res.json(paginated(rows, rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/audits/:id/report", asyncHandler(async (req, res) => {
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!audit) throw new HttpError(404, "Audit not found");
  const findings = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.auditId, audit.id)));
  const cars = findings.length ? await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), inArray(correctiveActionReports.auditFindingId, findings.map((x) => x.id)))) : [];
  const payload = { audit: auditDto(audit), plan: audit.auditPlanId ? planDto((await db.select().from(auditPlans).where(eq(auditPlans.id, audit.auditPlanId)))[0] ?? {}) : null, findings: findings.map(findingDto), cars: cars.map(carDto), generatedAt: new Date(), downloadUrl: null };
  if (!maybeCsv(req, res, `audit-${audit.referenceNumber}`, findings.map((finding) => ({ ...findingDto(finding), cars: cars.filter((car) => car.auditFindingId === finding.id).map(carDto) })))) res.json(payload);
}));

router.use("/admin", requireAdmin);
router.get("/admin/roles", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditWorkspaceRoles, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditWorkspaceRoles).where(where).orderBy(asc(auditWorkspaceRoles.name)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditWorkspaceRoles).where(where),
  ]);
  res.json(paginated(rows.map((x) => ({ id: x.id, name: x.name, description: x.description, permissions: [], active: x.status === "active", systemDefault: x.isSystem })), Number(count), page, limit));
}));
router.post("/admin/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditRoleBody, req);
  try {
    const [row] = await db.insert(auditWorkspaceRoles).values({ id: data.id, organizationId: actor(req).organizationId, name: data.name, description: data.description, isSystem: data.systemDefault ?? false, status: data.active ? "active" : "inactive" }).returning();
    await auditLog(req, "create", "workspace_role", row.id, undefined, row); res.status(201).json({ ...data, id: row.id });
  } catch (error: any) { if (error?.code === "23505") throw new HttpError(409, "Role name already exists"); throw error; }
}));
router.put("/admin/roles/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditRoleBody, req);
  const [before] = await db.select().from(auditWorkspaceRoles).where(and(active(auditWorkspaceRoles, actor(req).organizationId), eq(auditWorkspaceRoles.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Role not found");
  const [row] = await db.update(auditWorkspaceRoles).set({ name: data.name, description: data.description, status: data.active ? "active" : "inactive", updatedAt: new Date() }).where(eq(auditWorkspaceRoles.id, before.id)).returning();
  await auditLog(req, "update", "workspace_role", row.id, before, row); res.json({ ...data, id: row.id });
}));
router.get("/admin/users", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = and(eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.username)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(users).where(where),
  ]);
  const assignments = rows.length ? await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), inArray(auditUserWorkspaceRoles.userId, rows.map((x) => x.id)), isNull(auditUserWorkspaceRoles.deletedAt))) : [];
  const roles = assignments.length ? await db.select().from(auditWorkspaceRoles).where(inArray(auditWorkspaceRoles.id, assignments.map((x) => x.workspaceRoleId))) : [];
  res.json(paginated(rows.map((x) => ({
    id: x.id, username: x.username, email: x.email, platformRole: "Employee",
    workspaceRoles: roles.filter((role) => assignments.some((a) => a.userId === x.id && a.workspaceRoleId === role.id)).map((role) => ({ id: role.id, name: role.name, description: role.description, permissions: [], active: role.status === "active", systemDefault: role.isSystem })),
    status: x.accessStatus === "active" ? "Active" : x.accessStatus === "deactivated" ? "Deactivated" : "Not Requested", lastAccessAt: x.lastAccessAt,
  })), Number(count), page, limit));
}));
router.post("/admin/users/:userId/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.AssignAuditUserRoleBody, req);
  const [user, role] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt))).then((x) => x[0]),
    db.select().from(auditWorkspaceRoles).where(and(eq(auditWorkspaceRoles.id, data.roleId), active(auditWorkspaceRoles, actor(req).organizationId))).then((x) => x[0]),
  ]);
  if (!user || !role) throw new HttpError(404, !user ? "User not found" : "Role not found");
  const [existing] = await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.userId, user.id), eq(auditUserWorkspaceRoles.workspaceRoleId, role.id), isNull(auditUserWorkspaceRoles.deletedAt)));
  const values = { organizationId: actor(req).organizationId, userId: user.id, workspaceRoleId: role.id, projectIds: data.scopeType === "project" ? data.scopeIds : [], businessUnitIds: data.scopeType === "business_unit" ? data.scopeIds : [], status: "active", updatedAt: new Date() };
  const [row] = existing ? await db.update(auditUserWorkspaceRoles).set(values).where(eq(auditUserWorkspaceRoles.id, existing.id)).returning() : await db.insert(auditUserWorkspaceRoles).values(values).returning();
  await auditLog(req, "assign_role", "user_workspace_role", row.id, existing, row); res.json(row);
}));
router.get("/admin/access-queue", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(applicationAccess.organizationId, actor(req).organizationId), eq(applicationAccess.canOpenAudit, false), isNull(applicationAccess.deletedAt));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(applicationAccess).where(where).orderBy(desc(applicationAccess.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(applicationAccess).where(where),
  ]);
  const orgUsers = await db.select().from(users).where(eq(users.organizationId, actor(req).organizationId));
  res.json(paginated(rows.map((x) => ({ id: x.id, userId: orgUsers.find((u) => u.username === x.username)?.id ?? x.id, requestedRoleId: "", status: "pending", requestedAt: x.createdAt })), Number(count), page, limit));
}));
router.post("/admin/access-queue/:id/decision", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.DecideAuditAccessRequestBody, req);
  const [before] = await db.select().from(applicationAccess).where(and(eq(applicationAccess.id, String(req.params.id)), eq(applicationAccess.organizationId, actor(req).organizationId), isNull(applicationAccess.deletedAt)));
  if (!before) throw new HttpError(404, "Access request not found");
  if (before.canOpenAudit) throw new HttpError(409, "Access request has already been decided");
  const [row] = await db.update(applicationAccess).set({ canOpenAudit: data.decision === "approve", status: data.decision === "approve" ? "active" : "rejected", updatedAt: new Date() }).where(eq(applicationAccess.id, before.id)).returning();
  await auditLog(req, `${data.decision}_access`, "application_access", row.id, before, row); res.json(row);
}));
const delegationDto = (x: AnyRow) => ({
  id: x.id, delegatorId: x.delegatorId, delegateId: x.delegateId,
  scope: typeof x.scope?.scope === "string" ? x.scope.scope : "audit",
  approvalTypes: x.scope?.approvalTypes ?? [], startDate: x.startsAt, endDate: x.endsAt,
  status: x.status === "active" && x.endsAt < new Date() ? "expired" : x.status, revokedAt: x.deletedAt,
});
router.get("/admin/delegations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditDelegations, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditDelegations).where(where).orderBy(desc(auditDelegations.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditDelegations).where(where),
  ]); res.json(paginated(rows.map(delegationDto), Number(count), page, limit));
}));
router.post("/admin/delegations", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditDelegationBody, req);
  if (data.endDate <= data.startDate) throw new HttpError(422, "End date must be after start date");
  const [row] = await db.insert(auditDelegations).values({ id: data.id, organizationId: actor(req).organizationId, delegatorId: data.delegatorId, delegateId: data.delegateId, startsAt: data.startDate, endsAt: data.endDate, scope: { scope: data.scope, approvalTypes: data.approvalTypes ?? [] }, status: data.status }).returning();
  await auditLog(req, "create", "delegation", row.id, undefined, row); res.status(201).json(delegationDto(row));
}));
router.delete("/admin/delegations/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditDelegations).set({ deletedAt: new Date(), status: "revoked", updatedAt: new Date() })
    .where(and(active(auditDelegations, actor(req).organizationId), eq(auditDelegations.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Delegation not found"); await auditLog(req, "revoke", "delegation", row.id, row); res.status(204).end();
}));
const ruleDto = (x: AnyRow) => ({
  id: x.id, triggerType: x.triggerKey, priority: x.priority, level: x.configuration?.level ?? null,
  slaWorkingDays: x.slaWorkingDays, recipientRoles: x.configuration?.recipientRoles ?? [x.recipientRole],
  repeatCadenceDays: x.repeatCadenceDays ?? 1, enabled: x.status === "active",
});
router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const rows = await db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId)).orderBy(asc(auditEscalationRules.priority));
  res.json(paginated(rows.map(ruleDto), rows.length, 1, Math.max(1, rows.length)));
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditEscalationRulesBody, req);
  const before = await db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId));
  await db.update(auditEscalationRules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(active(auditEscalationRules, actor(req).organizationId));
  const rows = data.length ? await db.insert(auditEscalationRules).values(data.map((x) => ({
    id: x.id, organizationId: actor(req).organizationId, triggerKey: x.triggerType, priority: x.priority,
    slaWorkingDays: x.slaWorkingDays, recipientRole: x.recipientRoles[0] ?? "Quality Manager",
    repeatCadenceDays: x.repeatCadenceDays, configuration: { level: x.level, recipientRoles: x.recipientRoles },
    status: x.enabled ? "active" : "inactive",
  }))).returning() : [];
  await auditLog(req, "replace", "escalation_rules", rows[0]?.id ?? actor(req).id, { rules: before }, { rules: rows });
  res.json(paginated(rows.map(ruleDto), rows.length, 1, Math.max(1, rows.length)));
}));
router.get("/admin/audit-log", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const clauses: any[] = [eq(auditAuditLogEntries.organizationId, actor(req).organizationId)];
  if (req.query.actorId) clauses.push(eq(auditAuditLogEntries.actorId, String(req.query.actorId)));
  if (req.query.action) clauses.push(eq(auditAuditLogEntries.action, String(req.query.action)));
  if (req.query.from) clauses.push(gte(auditAuditLogEntries.createdAt, new Date(String(req.query.from))));
  if (req.query.to) clauses.push(lte(auditAuditLogEntries.createdAt, new Date(String(req.query.to))));
  const where = and(...clauses);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditAuditLogEntries).where(where).orderBy(desc(auditAuditLogEntries.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditAuditLogEntries).where(where),
  ]);
  res.json(paginated(rows.map((x) => ({ id: x.id, actorId: x.actorId ?? actor(req).id, delegatedForId: null, action: x.action, entityType: x.entityType, entityId: x.entityId ?? x.id, before: x.before, after: x.after, ipAddress: (x.after as AnyRow)?._requestIp ?? null, occurredAt: x.createdAt })), Number(count), page, limit));
}));
const templateDto = (x: AnyRow) => ({
  id: x.id, key: x.key, subject: x.subject, body: x.bodyTemplate,
  channels: [x.channel], mergeFields: [], enabled: x.enabled,
});
router.get("/admin/notification-templates", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditNotificationTemplates, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditNotificationTemplates).where(where).orderBy(asc(auditNotificationTemplates.name)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditNotificationTemplates).where(where),
  ]); res.json(paginated(rows.map(templateDto), Number(count), page, limit));
}));
router.put("/admin/notification-templates/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditNotificationTemplateBody, req);
  const [before] = await db.select().from(auditNotificationTemplates).where(and(active(auditNotificationTemplates, actor(req).organizationId), eq(auditNotificationTemplates.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Notification template not found");
  const supportedChannel = data.channels.find((x: string) => x === "in_app" || x === "email") ?? "in_app";
  const [row] = await db.update(auditNotificationTemplates).set({ key: data.key, subject: data.subject, bodyTemplate: data.body, channel: supportedChannel, enabled: data.enabled, updatedAt: new Date() }).where(eq(auditNotificationTemplates.id, before.id)).returning();
  await auditLog(req, "update", "notification_template", row.id, before, row); res.json(templateDto(row));
}));

router.get("/notifications", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(active(auditNotifications, actor(req).organizationId), eq(auditNotifications.recipientId, actor(req).id));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditNotifications).where(where).orderBy(desc(auditNotifications.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditNotifications).where(where),
  ]);
  res.json(paginated(rows.map((x) => ({ id: x.id, type: "audit", title: x.title, message: x.body, critical: false, read: Boolean(x.readAt), recordType: null, recordId: null, createdAt: x.createdAt, readAt: x.readAt })), Number(count), page, limit));
}));
router.post("/notifications/:id/read", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditNotifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(active(auditNotifications, actor(req).organizationId), eq(auditNotifications.id, String(req.params.id)), eq(auditNotifications.recipientId, actor(req).id))).returning();
  if (!row) throw new HttpError(404, "Notification not found"); res.status(204).end();
}));

export default router;