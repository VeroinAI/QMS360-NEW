import type { Request } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { auditAuditLogEntries, auditFindings, audits, db, users } from "@workspace/db";
import { getAuthorizedFullProjectScope } from "../middlewares/rbac";
import { actionableFinding, carAuditContext, carContext, carJson } from "./car-register";
import { HttpError } from "./workspace";

export interface CarWordReportData {
  auditor?: string | null;
  date?: string | null;
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
  if (!value) return null;
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
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
  const recipientId = item?.actionTakerId || car?.ownerId;
  const ids = [context.leadId, recipientId, meta.reviewedBy].filter((id): id is string => typeof id === "string" && !!id);
  const people = ids.length ? await db.select({ id: users.id, name: users.fullName, designation: users.designation })
    .from(users).where(and(eq(users.organizationId, org), inArray(users.id, ids))) : [];
  const person = (id?: string | null) => people.find(entry => entry.id === id);
  const [lastResponse] = car ? await db.select({ at: auditAuditLogEntries.createdAt }).from(auditAuditLogEntries).where(and(
    eq(auditAuditLogEntries.organizationId, org), eq(auditAuditLogEntries.entityType, "corrective_action_report"),
    eq(auditAuditLogEntries.entityId, car.id), inArray(auditAuditLogEntries.action, ["update", "submit"]),
  )).orderBy(desc(auditAuditLogEntries.createdAt)).limit(1) : [];
  const riskText = String(item?.riskLevel || finding?.riskLevel || "").toLowerCase().trim();
  const risk = ["high", "medium", "low"].includes(riskText) ? riskText as CarWordReportData["risk"] : null;
  const closed = car?.workflowState === "closed";
  const closedDate = typeof meta.closedAt === "string" ? meta.closedAt.slice(0, 10) : null;
  const dueDate = car?.extensionStatus === "approved" && car.extensionDueDate ? car.extensionDueDate : car?.dueDate;
  return {
    auditor: person(context.leadId)?.name,
    date: carReportDate(car?.createdAt ?? finding?.createdAt),
    // QMS360 does not currently store a formal CAR number; do not invent one.
    carNumber: null,
    department: context.scheduleMeta.departmentProject || finding?.responsibleDepartment,
    recipient: person(recipientId)?.name,
    auditReference: context.audit.referenceNumber,
    area: [item?.auditArea || finding?.responsibleDepartment, item?.clause ? `Clause ${item.clause}` : null].filter(Boolean).join("\n"),
    source: Array.isArray(context.scheduleMeta.auditTypes) ? context.scheduleMeta.auditTypes.join(", ") : null,
    finding: [item?.description || item?.question || finding?.description, item?.auditFinding || item?.result || finding?.classification].filter(Boolean).join("\n"),
    risk, dueDate: carReportDate(dueDate),
    rootCause: car?.rootCause, correction: car?.correction, correctiveAction: car?.correctiveAction,
    designation: person(recipientId)?.designation, actionDate: carReportDate(lastResponse?.at),
    accepted: meta.reviewOutcome === "accept" ? true : ["query", "rework", "reject"].includes(meta.reviewOutcome) ? false : null,
    withinAcd: closed && closedDate && dueDate ? closedDate <= dueDate : null,
    completed: car ? closed : false,
    verifiedBy: meta.reviewedAt ? person(meta.reviewedBy)?.name : null,
    verifiedDate: carReportDate(meta.reviewedAt),
  };
}
