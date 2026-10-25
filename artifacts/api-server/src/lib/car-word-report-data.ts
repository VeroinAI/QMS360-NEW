import type { Request } from "express";
import { formatDate } from "@workspace/spreadsheet-dates";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditAuditLogEntries, auditFindings, auditSchedules, audits, db, users } from "@workspace/db";
import { getAuthorizedFullProjectScope } from "../middlewares/rbac";
import { actionableFinding, carAuditContext, carContext, carJson } from "./car-register";
import { carDueDate, findingDateValue } from "./car-dates";
import { HttpError } from "./workspace";
import { getLovValues } from "./lov";
import { findingCreationEvidence } from "./audit-photo-finding-metadata";
import { carCalendarDate, carSubmissionDate, carVerification } from "./car-word-report-facts";
import { readCarSignature, type CarSignatureEvidence } from "./car-signature-evidence";

export interface CarWordReportData {
  auditor?: string | null;
  date?: string | null;
  originatorDate?: string | null;
  recipientDate?: string | null;
  originatorSignature?: Uint8Array;
  recipientSignature?: Uint8Array;
  carNumber?: string | null;
  department?: string | null;
  recipient?: string | null;
  auditReference?: string | null;
  area?: string | null;
  source?: string | null;
  finding?: string | null;
  risk?: "high" | "medium" | "low" | null;
  dueDate?: string | null;
  rootCause?: string | null;
  correction?: string | null;
  correctiveAction?: string | null;
  designation?: string | null;
  actionDate?: string | null;
  accepted?: boolean | null;
  withinAcd?: boolean | null;
  completed?: boolean | null;
  verifiedBy?: string | null;
  verifiedDate?: string | null;
}

export function carReportDate(value?: string | Date | null): string | null {
  const iso = carCalendarDate(value);
  return iso ? formatDate(iso) : null;
}

/** A read-only export: never start a CAR or alter response/review history. */
export async function carWordReportData(req: Request, input: { auditId: string; itemId: string; carId?: string }): Promise<CarWordReportData> {
  const org = req.currentUser!.organizationId;
  let car: Awaited<ReturnType<typeof carContext>>["car"] | undefined;
  let finding: Awaited<ReturnType<typeof carContext>>["finding"] | undefined;
  let item: Record<string, any> | undefined;
  let context: Awaited<ReturnType<typeof carAuditContext>>;
  if (input.carId) {
    const linked = await carContext(req, input.carId, true);
    const activeItem = linked.item && actionableFinding(linked.item) ? linked.item : undefined;
    if (linked.audit.id !== input.auditId || (activeItem?.id ?? linked.finding.id) !== input.itemId) {
      throw new HttpError(404, "CAR does not belong to this finding");
    }
    context = linked;
    car = linked.car;
    finding = linked.finding;
    item = activeItem;
  } else {
    const [audit] = await db.select().from(audits).where(and(
      eq(audits.organizationId, org), eq(audits.id, input.auditId), isNull(audits.deletedAt),
    ));
    if (!audit) throw new HttpError(404, "Audit not found");
    context = await carAuditContext(req, audit);
    item = Array.isArray(audit.checklistState) ? audit.checklistState.find((entry: any) => entry.id === input.itemId) : undefined;
    if (!item) {
      [finding] = await db.select().from(auditFindings).where(and(
        eq(auditFindings.organizationId, org), eq(auditFindings.auditId, audit.id),
        eq(auditFindings.id, input.itemId), isNull(auditFindings.deletedAt),
      ));
      if (finding) item = { id: finding.id, description: finding.description,
        auditFinding: finding.classification, auditArea: finding.responsibleDepartment };
    }
    if (!item || !actionableFinding(item)) throw new HttpError(404, "Finding not found");
    const full = await getAuthorizedFullProjectScope(req, "audit");
    if (!full.unrestricted && !(audit.projectId && full.projectIds.includes(audit.projectId))
      && item.actionTakerId !== req.currentUser!.id && context.leadId !== req.currentUser!.id
      && !context.plan?.teamMemberIds.includes(req.currentUser!.id)) {
      throw new HttpError(403, "This finding is outside your own-record scope");
    }
  }
  const meta = carJson(car?.effectivenessNotes);
  const sourceId = meta.sourceChecklistItemId || (finding?.evidence as any)?.sourceChecklistItemId;
  const checklistId = sourceId || (!finding ? item?.id : undefined);
  const creationEvents = await db.select().from(auditAuditLogEntries).where(and(
    eq(auditAuditLogEntries.organizationId, org),
    eq(auditAuditLogEntries.entityType, checklistId ? "audit" : "audit_finding"),
    eq(auditAuditLogEntries.entityId, checklistId ? context.audit.id : finding!.id),
    inArray(auditAuditLogEntries.action, checklistId
      ? ["add_finding_item", "update_checklist", "add_checklist_item", "edit_checklist_item", "import_checklist_items"]
      : ["create"]),
  ));
  const creation = checklistId ? findingCreationEvidence(creationEvents).get(checklistId)
    : creationEvents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const originatorRecordId = checklistId || finding?.id || "";
  const savedOriginator = carJson(context.audit.status).carOriginatorSignatures?.[originatorRecordId] as CarSignatureEvidence | undefined;
  const originatorEvidence = savedOriginator?.organizationId === org && savedOriginator.recordId === originatorRecordId ? savedOriginator : undefined;
  const savedRecipient = meta.carRecipientSignature as CarSignatureEvidence | undefined;
  const recipientEvidence = savedRecipient?.organizationId === org && savedRecipient.recordId === car?.id ? savedRecipient : undefined;
  const originatorId = originatorEvidence?.userId || creation?.actorId;
  const recipientId = recipientEvidence?.userId || item?.actionTakerId || car?.ownerId;
  const ids = [originatorId, context.leadId, recipientId, meta.reviewedBy].filter((id): id is string => typeof id === "string" && !!id);
  const people = ids.length ? await db.select({ id: users.id, name: users.fullName, designation: users.designation })
    .from(users).where(and(eq(users.organizationId, org), inArray(users.id, ids))) : [];
  const person = (id?: string | null) => people.find(entry => entry.id === id);
  const submissions = car ? await db.select({ createdAt: auditAuditLogEntries.createdAt, action: auditAuditLogEntries.action }).from(auditAuditLogEntries).where(and(
    eq(auditAuditLogEntries.organizationId, org), eq(auditAuditLogEntries.entityType, "corrective_action_report"),
    eq(auditAuditLogEntries.entityId, car.id), inArray(auditAuditLogEntries.action, ["submit", "resubmit"]),
  )) : [];
  const signature = async (evidence: CarSignatureEvidence | undefined, recordId: string) => {
    try { return await readCarSignature(evidence, org, recordId); }
    catch { req.log?.warn({ recordId }, "CAR report signature evidence unavailable"); return undefined; }
  };
  const [originatorSignature, recipientSignature] = await Promise.all([
    signature(originatorEvidence, originatorRecordId),
    signature(recipientEvidence, car?.id || ""),
  ]);
  const riskText = String(item?.riskLevel || finding?.riskLevel || "").toLowerCase().trim();
  const risk = ["high", "medium", "low"].includes(riskText) ? riskText as CarWordReportData["risk"] : null;
  const dueDate = car?.extensionStatus === "approved" && car.extensionDueDate ? car.extensionDueDate
    : carDueDate(item?.auditFinding || item?.result || finding?.classification, findingDateValue(item, finding), car?.dueDate);
  const areaValue = item?.auditArea || finding?.responsibleDepartment;
  const areaOptions = areaValue ? await getLovValues(db, org, "Audit Area") : [];
  const areaLabel = areaOptions.find(option => option.value === areaValue)?.label
    ?? areaOptions.find(option => option.label === areaValue)?.label;
  const parentId = context.scheduleMeta.parentId;
  const [programme] = typeof parentId === "string" && parentId ? await db.select({ title: auditSchedules.title })
    .from(auditSchedules).where(and(
      eq(auditSchedules.organizationId, org), eq(auditSchedules.id, parentId), isNull(auditSchedules.deletedAt),
    )).limit(1) : [];
  return {
    auditor: person(originatorId)?.name,
    date: carReportDate(car?.createdAt ?? finding?.createdAt),
    originatorDate: carReportDate(originatorEvidence?.capturedAt ?? creation?.createdAt ?? (!checklistId ? finding?.createdAt : null)),
    recipientDate: carReportDate(carSubmissionDate(meta, submissions)),
    originatorSignature, recipientSignature,
    carNumber: typeof meta.carNumber === "string" ? meta.carNumber : null,
    department: context.scheduleMeta.departmentProject || finding?.responsibleDepartment,
    recipient: person(recipientId)?.name,
    auditReference: context.scheduleMeta.qaqcReference || context.planMeta.qaqcReference || null,
    area: areaLabel || null,
    source: parentId ? programme?.title ?? null : context.schedule?.title ?? null,
    finding: [item?.description || item?.question || finding?.description, item?.auditFinding || item?.result || finding?.classification].filter(Boolean).join("\n"),
    risk, dueDate: carReportDate(dueDate),
    rootCause: car?.rootCause, correction: car?.correction, correctiveAction: car?.correctiveAction,
    designation: person(recipientId)?.designation, actionDate: carReportDate(carSubmissionDate(meta, submissions)),
    ...carVerification(car, meta, dueDate),
    verifiedBy: meta.reviewedAt ? person(meta.reviewedBy)?.name : null,
    verifiedDate: carReportDate(meta.reviewedAt),
  };
}
