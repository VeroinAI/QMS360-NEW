import { Router } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditAuditLogEntries, auditLogEntries, db, emailEventRules, lessonsAuditLogEntries, users } from "@workspace/db";
import { CreateEmailRuleBody, ReorderEmailRulesBody, SimulateEmailRuleBody, UpdateEmailRuleBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { asyncHandler, HttpError, writeAuditLog } from "../lib/workspace";
import { resolveEmailRule } from "../lib/email-rules";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const knownEvents = [
  "audit.audit.create", "audit.audit.delete", "audit.audit.update", "audit.audit.update_checklist",
  "audit.audit_finding.create", "audit.audit_finding.delete", "audit.audit_finding.update",
  "audit.audit_plan.create", "audit.audit_plan.delete", "audit.audit_plan.send_for_audit", "audit.audit_plan.share", "audit.audit_plan.update",
  "audit.audit_programme.approve", "audit.audit_programme.create", "audit.audit_programme.delete", "audit.audit_programme.reject", "audit.audit_programme.submit",
  "audit.audit_schedule.approve", "audit.audit_schedule.create", "audit.audit_schedule.delete", "audit.audit_schedule.reject", "audit.audit_schedule.submit", "audit.audit_schedule.update",
  "audit.corrective_action_report.cancel_extension", "audit.corrective_action_report.close", "audit.corrective_action_report.create",
  "audit.corrective_action_report.request_extension", "audit.corrective_action_report.submit", "audit.corrective_action_report.update",
  "audit.delegation.create", "audit.delegation.revoke", "audit.escalation_rules.replace",
  "audit.evidence.confirm", "audit.evidence.create", "audit.field_controls.update", "audit.notification_template.update",
  "audit.user_workspace_role.assign_role", "audit.user_workspace_role.remove_role", "audit.workspace_role.create", "audit.workspace_role.update",
  "lessons.ai_settings.update", "lessons.approver_scope.create", "lessons.approver_scope.delete",
  "lessons.delegation.create", "lessons.delegation.revoke", "lessons.escalation_rules.replace",
  "lessons.evidence.confirm", "lessons.evidence.create_intent", "lessons.evidence.create_photo_intent", "lessons.evidence.delete",
  "lessons.field_controls.update", "lessons.lesson_form.approve", "lessons.lesson_form.create", "lessons.lesson_form.delete",
  "lessons.lesson_form.reject", "lessons.lesson_form.submit", "lessons.lesson_form.transfer", "lessons.lesson_form.update",
  "lessons.notification.mark_read", "lessons.notification_template.update", "lessons.role.create", "lessons.role.update",
  "lessons.user_profile.update", "lessons.user_role.assign_role", "lessons.user_role.remove_role",
  "audit.user.update_email", "audit.user.update_platform_role",
  "lessons.user.update_email", "lessons.user.update_platform_role",
  "qaqc.user.update_email", "qaqc.user.update_platform_role",
  "qaqc.ai_settings.update", "qaqc.customer_satisfaction.create", "qaqc.customer_satisfaction.update",
  "qaqc.delegation.create", "qaqc.document_governance.create", "qaqc.document_governance.update",
  "qaqc.escalation_rules.replace", "qaqc.evidence.confirm", "qaqc.evidence.create_evidence_intent", "qaqc.evidence.delete",
  "qaqc.field_controls.update", "qaqc.material_inspection.create", "qaqc.material_inspection.update",
  "qaqc.metric.approve", "qaqc.metric.create", "qaqc.metric.import_create", "qaqc.metric.import_update",
  "qaqc.metric.reject", "qaqc.metric.submit", "qaqc.metric.update", "qaqc.notification_template.update",
  "qaqc.qtbt.create", "qaqc.qtbt.update", "qaqc.quality_brief.ai_draft", "qaqc.quality_brief.approve",
  "qaqc.quality_brief.create", "qaqc.quality_brief.reject", "qaqc.quality_brief.submit", "qaqc.quality_brief.update",
  "qaqc.user_workspace_role.assign_role", "qaqc.user_workspace_role.remove_role", "qaqc.workspace_role.create", "qaqc.workspace_role.update",
];
function bodyValue(value: unknown): string | null { return typeof value === "string" ? value.trim() || null : null; }
function validate(input: any) {
  if (!input || typeof input.name !== "string" || !input.name.trim() || typeof input.eventType !== "string" || !/^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/.test(input.eventType)) throw new HttpError(422, "Invalid rule name or canonical eventType");
  if (!Number.isInteger(input.priority) || input.priority < 0) throw new HttpError(422, "Rule priority must be a non-negative whole number");
  if (!["all_users", "internal_user", "external_email", "workspace_role", "project_members", "project_role", "linked_approver"].includes(input.recipientMode)) throw new HttpError(422, "Select a recipient mode");
  if (input.recipientMode === "linked_approver" && input.eventType !== "lessons.lesson_form.submit") throw new HttpError(422, "Linked approver recipients are only available for Lessons Learned submission");
  if (input.recipientMode === "internal_user" && !input.receiverUserId) throw new HttpError(422, "Select an internal recipient");
  if (input.recipientMode === "external_email" && (!input.receiverName?.trim() || !emailPattern.test(input.receiverEmail ?? ""))) throw new HttpError(422, "Enter a valid external recipient name and email");
  if (["workspace_role", "project_role"].includes(input.recipientMode) && !input.recipientConfig?.roleName?.trim()) throw new HttpError(422, "Enter a workspace role name");
  if (["project_members", "project_role"].includes(input.recipientMode) && !input.recipientConfig?.projectIds?.length) throw new HttpError(422, "Select at least one project");
}
async function ensureUsers(org: string, ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return;
  const rows = await db.select({ id: users.id }).from(users).where(and(
    eq(users.organizationId, org), eq(users.accessStatus, "active"),
    isNull(users.deletedAt), inArray(users.id, wanted),
  ));
  if (rows.length !== wanted.length) throw new HttpError(422, "Receiver user must belong to this organization");
}

router.get("/email-rules", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await db.select().from(emailEventRules).where(and(eq(emailEventRules.organizationId, req.currentUser!.organizationId), isNull(emailEventRules.deletedAt))).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  res.json(rows);
}));
router.post("/email-rules", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = CreateEmailRuleBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, "Invalid email rule");
  validate(parsed.data);
  await ensureUsers(req.currentUser!.organizationId, [parsed.data.createdByUserId, parsed.data.receiverUserId]);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email-rules:${req.currentUser!.organizationId}`}))`);
    const [maximum] = await tx.select({ value: sql<number>`coalesce(max(${emailEventRules.priority}), -1)` })
      .from(emailEventRules).where(and(
        eq(emailEventRules.organizationId, req.currentUser!.organizationId),
        isNull(emailEventRules.deletedAt),
      ));
    const [created] = await tx.insert(emailEventRules).values(({
      organizationId: req.currentUser!.organizationId, name: parsed.data.name.trim(), eventType: parsed.data.eventType,
      enabled: parsed.data.enabled, priority: Number(maximum?.value ?? -1) + 1,
      createdByUserId: bodyValue(parsed.data.createdByUserId), receiverUserId: bodyValue(parsed.data.receiverUserId),
      recipientMode: parsed.data.recipientMode, receiverName: bodyValue(parsed.data.receiverName), receiverEmail: bodyValue(parsed.data.receiverEmail),
      recipientConfig: parsed.data.recipientConfig ?? {},
    }) as any).returning();
    return created!;
  });
  await writeAuditLog(db, "audit", { organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, action: "create", entityType: "email_event_rule", entityId: row!.id, after: row as any });
  res.status(201).json(row);
}));
router.patch("/email-rules/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await db.select().from(emailEventRules).where(and(eq(emailEventRules.id, String(req.params.id)), eq(emailEventRules.organizationId, req.currentUser!.organizationId), isNull(emailEventRules.deletedAt))).then((r) => r[0]);
  if (!existing) throw new HttpError(404, "Email rule not found");
  const parsed = UpdateEmailRuleBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, "Invalid email rule");
  validate(parsed.data);
  await ensureUsers(req.currentUser!.organizationId, [parsed.data.createdByUserId, parsed.data.receiverUserId]);
  const [row] = await db.update(emailEventRules).set({
    name: parsed.data.name.trim(), enabled: parsed.data.enabled, priority: parsed.data.priority,
    eventType: parsed.data.eventType, createdByUserId: bodyValue(parsed.data.createdByUserId),
    recipientMode: parsed.data.recipientMode, receiverUserId: bodyValue(parsed.data.receiverUserId), receiverName: bodyValue(parsed.data.receiverName),
    receiverEmail: bodyValue(parsed.data.receiverEmail), updatedAt: new Date(),
    recipientConfig: parsed.data.recipientConfig ?? {},
  }).where(eq(emailEventRules.id, existing.id)).returning();
  await writeAuditLog(db, "audit", { organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, action: "update", entityType: "email_event_rule", entityId: existing.id, before: existing as any, after: row as any });
  res.json(row);
}));
router.delete("/email-rules/:id", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [row] = await db.update(emailEventRules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(emailEventRules.id, String(req.params.id)), eq(emailEventRules.organizationId, req.currentUser!.organizationId), isNull(emailEventRules.deletedAt))).returning();
  if (!row) throw new HttpError(404, "Email rule not found");
  await writeAuditLog(db, "audit", { organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, action: "delete", entityType: "email_event_rule", entityId: row.id, after: row as any });
  res.status(204).end();
}));
router.post("/email-rules/reorder", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = ReorderEmailRulesBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, "Invalid rule order");
  const ids = parsed.data.ids.map(String);
  if (new Set(ids).size !== ids.length) throw new HttpError(422, "Rule order contains duplicate IDs");
  const existing = await db.select({ id: emailEventRules.id }).from(emailEventRules).where(and(
    eq(emailEventRules.organizationId, req.currentUser!.organizationId), isNull(emailEventRules.deletedAt),
  ));
  if (existing.length !== ids.length || existing.some((row) => !ids.includes(row.id))) {
    throw new HttpError(422, "Rule order must include every active rule exactly once");
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email-rules:${req.currentUser!.organizationId}`}))`);
    for (const [priority, id] of ids.entries()) {
      await tx.update(emailEventRules).set({ priority, updatedAt: new Date() }).where(and(
        eq(emailEventRules.id, id), eq(emailEventRules.organizationId, req.currentUser!.organizationId),
      ));
    }
  });
  const rows = await db.select().from(emailEventRules).where(and(eq(emailEventRules.organizationId, req.currentUser!.organizationId), isNull(emailEventRules.deletedAt))).orderBy(asc(emailEventRules.priority), asc(emailEventRules.createdAt));
  res.json(rows);
}));
router.get("/email-rules/options/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await db.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(and(eq(users.organizationId, req.currentUser!.organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt))).orderBy(users.fullName);
  res.json(rows);
}));
router.get("/email-rules/catalog", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const values = new Set(knownEvents);
  for (const [app, table] of [["qaqc", auditLogEntries], ["lessons", lessonsAuditLogEntries], ["audit", auditAuditLogEntries] ] as const) {
    const rows = await db.select({ entityType: table.entityType, action: table.action }).from(table).where(eq(table.organizationId, req.currentUser!.organizationId)).groupBy(table.entityType, table.action);
    rows.forEach((r) => values.add(`${app}.${r.entityType}.${r.action}`));
  }
  res.json([...values].sort().map((value) => ({
    value,
    label: value.split(".").map((part) => part.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())).join(" · "),
  })));
}));
router.post("/email-rules/simulate", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const parsed = SimulateEmailRuleBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, "eventType is required");
  const parts = parsed.data.eventType.split(".");
  if (parts.length !== 3) throw new HttpError(422, "eventType must be app.entityType.action");
  const result = await resolveEmailRule(db, { organizationId: req.currentUser!.organizationId, app: parts[0]!, entityType: parts[1]!, action: parts[2]!, actorId: parsed.data.createdByUserId });
  res.json({
    matched: Boolean(result.rule), rule: result.rule,
    recipients: result.recipients.map((recipient) => ({ userId: null, name: recipient.name ?? null, email: recipient.email })),
  });
}));
export default router;