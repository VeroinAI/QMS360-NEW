import { formatDateInTimeZone, formatPresentationData } from "@workspace/spreadsheet-dates";
import { visibleAdminUsers } from "../lib/admin-user-discovery";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import * as Api from "@workspace/api-zod";
import { allocateReferenceNumber, hasNumberingPattern } from "../lib/numbering";
import { scheduleActivityEntry } from "../lib/audit-schedule-activity";
import { auditPlanDateFields, validateAuditPlanDates } from "@workspace/field-controls";
import {
  applicationAccess,
  auditAuditLogEntries,
  auditDelegations,
  auditEscalationInstances,
  auditEscalationRules,
  auditEvidenceFiles,
  auditFindings,
  auditNotificationTemplates,
  auditNotifications,
  auditPlans,
  auditPermissions,
  auditSchedules,
  auditWorkspaceRolePermissions,
  auditUserWorkspaceRoles,
  auditWorkspaceRoles,
  audits,
  correctiveActionReports,
  db,
  masterDataGroups,
  masterDataValues,
  organizationSettings,
  platformRoles,
  projects,
  users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { assertCanManageAssignmentScope, assertProjectAccess, canManageAssignmentScope, getAppAdminScope, getAuthorizedProjectScope, getAuthorizedFullProjectScope, requireAppAccess, requireAppAdmin, requirePermission, type EffectiveProjectScope } from "../middlewares/rbac";
import { assertProjectInOrg, assertProjectScopeInOrg } from "../lib/tenancy";
import { assertLovValue } from "../lib/lov";
import { assertFieldAccess } from "../lib/field-access";
import { getObject, storeObject } from "../lib/objectStorage";
import { assertFieldControls, assertKnownFieldControlKeys, readFieldControls, writeFieldControls, type FieldControlsMatrix } from "../lib/field-controls";
import { confirmEvidence, createEvidenceIntent, listEvidence } from "../lib/evidence";
import { asyncHandler, HttpError, listNotifications, notify, paginated, pagination, staffedRoleNames, writeAuditLog } from "../lib/workspace";
import { accessRequestIdentity, activeUserIdentityByUsername } from "../lib/access-request-identity";
import { decideApplicationAccess, loadPendingApplicationRequestPage } from "../lib/application-access-requests";
import { formatAuditNumber, formatQaqcReference, getScheduleNumbering, lockScheduleNumbering, type ScheduleNumbering } from "../lib/audit-schedule-numbering";
import { auditApprovalEmailEnabled, auditScheduleSendBackCcIds, queueAuditApprovalEmail } from "../lib/email-rules";
import { renderAuditScheduleApprovalPdf, type AuditScheduleApprovalPdfInput } from "../lib/audit-schedule-approval-pdf";
import { removeEmailPdfAttachment, storeEmailPdfAttachment } from "../lib/email-attachments";
import { auditPlanReportData } from "../lib/audit-plan-report-data";
import { renderAuditPlanPdf } from "../lib/audit-plan-pdf";
import { auditIsComplete, buildConsolidatedAuditReport } from "../lib/audit-consolidated-report";
import { AUDIT_PPTX_MIME, renderConsolidatedAuditPptx } from "../lib/audit-consolidated-pptx";
import { renderConsolidatedAuditPdf } from "../lib/audit-consolidated-pdf";
import { auditReportDetailsErrors, type AuditReportDetailsData } from "@workspace/field-controls";
import { auditModulePermissionCatalog, datedActivities, auditPlanDateErrors, plannedDate, auditPlanReplayMatches, type DatedActivity } from "@workspace/field-controls";
import { activeAuditCapabilities } from "../lib/audit-capabilities";
import { normalizeActivityAssignments, type ActivityRoleAssignment } from "../lib/audit-activity-assignments";
import { auditModuleReadMatches, auditModulePermissionMatches } from "@workspace/field-controls";
import { actionableFinding, carAuditContext, carContext, carJson, carRegister, carLeadMarker } from "../lib/car-register";
import { carWordReportData } from "../lib/car-word-report-data";
import { CAR_WORD_MIME, renderCarWordReport } from "../lib/car-word-report";

const router = Router();
const requireAuditAdmin = requireAppAdmin("audit");
router.use(requireAuth);
router.use(requireAppAccess("audit"));
router.get("/capabilities", asyncHandler(async (req, res) => res.json(await activeAuditCapabilities(req))));
router.use("/dashboard", requirePermission("audit", "dashboard", "select"));
router.use("/reports", requirePermission("audit", "reports", "select"), auditExportGuard("reports"));
const auditModules: Array<[string, string]> = [
  ["/programmes", "schedules"], ["/schedules", "schedules"], ["/plans", "plans"], ["/audits", "audits"],
  ["/findings", "findings"], ["/cars", "cars"], ["/car-register", "cars"],
];
for (const [path, module] of auditModules) {
  router.use(path, (req, res, next) => {
    if (path === "/cars" && req.method === "POST" && /^\/[^/]+\/review\/?$/.test(req.path)) {
      return asyncHandler(async (req, _res, next) => {
        const readScope = await getAuthorizedProjectScope(req, "audit", { module: "cars", action: "select" });
        if (!readScope.unrestricted && !readScope.projectIds.length && !readScope.processAuditsAllowed) {
          throw new HttpError(403, "CAR read access is required to review a response");
        }
        req.permissionProjectScope = readScope;
        req.permissionFullProjectScope = await getAuthorizedFullProjectScope(req, "audit", { module: "cars", action: "select" });
        next();
      })(req, res, next);
    }
    // This single mutation uses the Audit Program Manager marker, not create/edit.
    if (path === "/programmes" && req.method === "PATCH" && /\/programmes\/[^/]+\/team-leads\/?(?:\?|$)/.test(req.originalUrl)) return next();
    const programmeCreate = path === "/programmes" && req.method === "POST" && req.path === "/";
    // The Audit role editor stores "Create / edit schedules" as data_entry.
    // Honor it only on the schedule create/update endpoints, not programme,
    // approval, feasibility or delete mutations that also live under schedules.
    const scheduleWrite = path === "/schedules" && (
      (req.method === "POST" && req.path === "/")
      || (req.method === "PUT" && /^\/[^/]+\/?$/.test(req.path))
    );
    return requirePermission("audit", module, req.method === "GET" ? "select" : "full", {
      allowAuditScheduleDataEntry: scheduleWrite,
      allowAuditProgrammeCreate: programmeCreate,
    })(req, res, () => auditExportGuard(module)(req, res, next));
  });
}
function auditExportGuard(module: string) {
  return asyncHandler(async (req, _res, next) => {
    const isExport = req.method === "GET" && (
      req.path.endsWith("/report.pdf") || req.path.endsWith("/report.docx") || req.path.endsWith("/report/pdf") || req.path.endsWith("/report/pptx") || (module === "plans" && /^\/[^/]+\/report\/?$/.test(req.path))
      || String(req.query.format ?? "").toLowerCase() === "csv"
      || req.accepts(["json", "text/csv"]) === "text/csv"
    );
    if (!isExport || req.permissionAdminBypass) return next();
    const exportScope = await getAuthorizedProjectScope(req, "audit", { module, action: "select", operation: "export" });
    const intersect = (left: EffectiveProjectScope, right: EffectiveProjectScope) =>
      left.unrestricted ? right : right.unrestricted ? left
        : { unrestricted: false, projectIds: left.projectIds.filter(id => right.projectIds.includes(id)),
          processAuditsAllowed: left.processAuditsAllowed === true && right.processAuditsAllowed === true };
    const readScope = req.permissionProjectScope ?? { unrestricted: false, projectIds: [] };
    const scope = intersect(readScope, exportScope);
    if (!scope.unrestricted && !scope.projectIds.length && !scope.processAuditsAllowed) throw new HttpError(403, "Export is not permitted for your role in this scope");
    req.permissionProjectScope = scope;
    req.permissionFullProjectScope = intersect(req.permissionFullProjectScope ?? { unrestricted: false, projectIds: [] }, exportScope);
    next();
  });
}
const auditEvidenceModules: Record<string, string> = {
  audit_schedule: "schedules",
  audit: "audits", audit_execution: "audits",
  audit_finding: "findings", finding: "findings",
  corrective_action_report: "cars", car: "cars",
};
router.use("/evidence", asyncHandler(async (req, res, next) => {
  let recordType = typeof req.body?.recordType === "string" ? req.body.recordType
    : typeof req.query.recordType === "string" ? req.query.recordType : null;
  if (!recordType) {
    const evidenceId = req.path.split("/").filter(Boolean)[0];
    const [stored] = evidenceId ? await db.select({ recordType: auditEvidenceFiles.recordType }).from(auditEvidenceFiles).where(and(
      eq(auditEvidenceFiles.id, evidenceId), eq(auditEvidenceFiles.organizationId, req.currentUser!.organizationId), isNull(auditEvidenceFiles.deletedAt),
    )).limit(1) : [];
    recordType = stored?.recordType ?? null;
  }
  const module = recordType ? auditEvidenceModules[recordType] : null;
  if (!module) throw new HttpError(422, "Unsupported audit evidence record type");
  await requirePermission("audit", module, req.method === "GET" ? "select" : "full", {
    allowAuditScheduleDataEntry: recordType === "audit_schedule" && (
      (req.method === "POST" && req.path === "/")
      || (req.method === "PUT" && /^\/[^/]+\/confirm\/?$/.test(req.path))
    ),
  })(req, res, next);
}));
router.use(asyncHandler(async (req, _res, next) => {
  if (req.method !== "GET" && typeof req.body?.projectId === "string") {
    await assertProjectInOrg(db, actor(req).organizationId, req.body.projectId);
    await assertProjectAccess(req, req.body.projectId);
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
const auditLog = (req: Request, action: string, entityType: string, entityId: string, before?: AnyRow, after?: AnyRow, database: typeof db = db) =>
  writeAuditLog(database, "audit", {
    organizationId: actor(req).organizationId, actorId: actor(req).id, action, entityType, entityId,
    before, after: ["audit_programme", "audit_schedule", "evidence"].includes(entityType)
      ? { ...after, _auditContext: {
        actorName: actor(req).fullName, requestId: String(req.id ?? ""),
        reason: typeof req.body?.comments === "string" ? req.body.comments
          : typeof req.body?.feedback === "string" ? req.body.feedback : null,
      } } : after, ipAddress: req.ip,
  }, { dispatch: database === db && !(["audit_programme", "audit_schedule"].includes(entityType) && ["submit", "resubmit", "approve"].includes(action)) });
async function assertAuditUserManagementScope(req: Request, userId: string) {
  if (req.permissionAdminBypass || userId === actor(req).id) return;
  const assignments = await db.select({
    projectIds: auditUserWorkspaceRoles.projectIds,
    businessUnitIds: auditUserWorkspaceRoles.businessUnitIds,
  }).from(auditUserWorkspaceRoles).where(and(
    eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId),
    eq(auditUserWorkspaceRoles.userId, userId),
    isNull(auditUserWorkspaceRoles.deletedAt),
  ));
  if (!assignments.some(assignment => canManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds))) {
    throw new HttpError(403, "You do not have access to manage this user's Audit profile");
  }
}

const MAX_SIGNATURE_DIMENSION = 4096;
const MAX_SIGNATURE_PIXELS = 16_000_000;
function assertImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_SIGNATURE_DIMENSION || height > MAX_SIGNATURE_DIMENSION
    || width * height > MAX_SIGNATURE_PIXELS) {
    throw new HttpError(422, "Signature image dimensions are invalid or too large");
  }
}
function readWebpDimensions(bytes: Buffer) {
  if (bytes.length < 26 || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new HttpError(422, "Signature image bytes do not match the declared MIME type");
  }
  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  let validFrame = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new HttpError(422, "Signature image is malformed");
    if (type === "VP8 " && size >= 10 && bytes[start + 3] === 0x9d
      && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      dimensions = { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
      validFrame = true;
    } else if (type === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
      const b1 = bytes[start + 1]!, b2 = bytes[start + 2]!, b3 = bytes[start + 3]!, b4 = bytes[start + 4]!;
      dimensions = { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
      validFrame = true;
    }
    offset = end + (size & 1);
  }
  if (offset !== bytes.length || !validFrame || !dimensions) throw new HttpError(422, "Signature image is malformed");
  assertImageDimensions(dimensions.width, dimensions.height);
}
async function validateSignatureImage(bytes: Buffer, mimeType: string) {
  try {
    if (mimeType === "image/webp") {
      readWebpDimensions(bytes);
      return;
    }
    const document = await PDFDocument.create();
    const image = mimeType === "image/png" ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    assertImageDimensions(image.width, image.height);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "Signature must be a valid PNG, JPEG or WebP image");
  }
}
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
  res.send([keys.map(escape).join(","), ...rows.map((row) => {
    const formatted = formatPresentationData(row);
    return keys.map((key) => escape(typeof formatted[key] === "object" ? JSON.stringify(formatted[key]) : formatted[key])).join(",");
  })].join("\n"));
};
const maybeCsv = (req: Request, res: Response, name: string, rows: AnyRow[]) => {
  if (String(req.query.format ?? "").toLowerCase() === "csv" || req.accepts(["json", "text/csv"]) === "text/csv") {
    csv(res, name, rows);
    return true;
  }
  return false;
};

type ScheduleMeta = {
  activityRoleAssignments?: ActivityRoleAssignment[];
  programme?: boolean; parentId?: string | null; fromDate?: string; toDate?: string;
  teamLeadIds?: string[];
  approvalRoles?: Array<{ id: string; name: string }>; approvalIndex?: number;
  autoPromotedChildIds?: string[];
  submissionReference?: string; submissionFrom?: string; submissionTo?: string;
  submissionDate?: string;
  submissionSubject?: string; submissionMailBody?: string;
  submissionUserId?: string; approvalParticipantIds?: string[];
  projectIds?: string[]; auditTypes?: string[]; plannedStartDate?: string;
  plannedEndDate?: string; reviewComments?: string | null;
  auditCategory?: string; departmentProject?: string; location?: string;
  gpsLat?: number | null; gpsLng?: number | null;
  processProductOwner?: string; qaqcReference?: string; auditNumber?: string;
  auditNumberScope?: string; auditNumberYear?: number; auditNumberSequence?: number;
  auditNumberHistory?: Array<{ scope: string; year: number; sequence: number }>;
  qaqcReferenceYear?: number; qaqcReferenceSequence?: number;
  qaqcScope?: string; qaqcClauses?: string; remarks?: string | null;
  l1Name?: string; l1ReviewStatus?: string; l1ReviewComments?: string | null; l1Attachments?: string[];
  l2Name?: string; l2ReviewStatus?: string; l2ReviewComments?: string | null; l2Attachments?: string[];
  memoDescription?: string; memoCirculation?: string;
  feasibilityDecision?: "cancelled" | "reschedule" | null;
  feasibilityFeedback?: string | null;
  feasibilityRecordedAt?: string | null;
};
const PROCESS_AUDIT_TYPE = "Quality Internal Process Audit";
const processPlansByRequest = new WeakMap<Request, Promise<string[]>>();
async function processPlanCondition(req: Request, planId: AnyPgColumn) {
  let ids = processPlansByRequest.get(req);
  if (!ids) {
    ids = (async () => {
      const schedules = await db.select({ id: auditSchedules.id, status: auditSchedules.status })
        .from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
      // Use the same safe legacy JSON parser as detail authorization. Never cast
      // arbitrary historical status text to JSON in a database WHERE clause.
      const scheduleIds = schedules.filter(isProcessAuditSchedule).map(row => row.id);
      if (!scheduleIds.length) return [];
      const plans = await db.select({ id: auditPlans.id }).from(auditPlans).where(and(
        active(auditPlans, actor(req).organizationId), inArray(auditPlans.auditScheduleId, scheduleIds),
      ));
      return plans.map(row => row.id);
    })();
    processPlansByRequest.set(req, ids);
  }
  return inArray(planId, await ids);
}
async function auditProjectCondition(req: Request, scope: EffectiveProjectScope) {
  if (scope.unrestricted) return undefined;
  return or(inArray(audits.projectId, scope.projectIds),
    scope.processAuditsAllowed ? and(isNull(audits.projectId), await processPlanCondition(req, audits.auditPlanId)) : undefined);
}
const PRODUCT_AUDIT_TYPE = "Quality Internal Product Audit";
const isProcessAuditSchedule = (row: AnyRow) => scheduleMeta(row).auditTypes?.includes(PROCESS_AUDIT_TYPE) ?? false;
const scheduleMeta = (row: AnyRow): ScheduleMeta => parseJson(row.status, {});
const isProgramme = (row: AnyRow) => Boolean(scheduleMeta(row).programme);
async function isProcessScheduleId(organizationId: string, scheduleId: string | null | undefined) {
  if (!scheduleId) return false;
  const [schedule] = await db.select({ status: auditSchedules.status }).from(auditSchedules).where(and(
    active(auditSchedules, organizationId), eq(auditSchedules.id, scheduleId),
  ));
  return schedule ? isProcessAuditSchedule(schedule) : false;
}
async function isProcessPlanId(organizationId: string, planId: string | null | undefined) {
  if (!planId) return false;
  const [plan] = await db.select({ scheduleId: auditPlans.auditScheduleId }).from(auditPlans).where(and(
    active(auditPlans, organizationId), eq(auditPlans.id, planId),
  ));
  return isProcessScheduleId(organizationId, plan?.scheduleId);
}
async function assertChildSchedule(row: AnyRow | undefined): Promise<AnyRow> {
  if (!row) throw new HttpError(404, "Audit schedule not found");
  if (isProgramme(row)) throw new HttpError(404, "Audit programme is not a child schedule");
  return row;
}
async function assertValidParent(organizationId: string, parentId: unknown) {
  if (parentId == null || parentId === "") return null;
  if (parentId === "legacy") throw new HttpError(422, "Legacy schedules cannot be assigned to a programme");
  const [parent] = await db.select().from(auditSchedules).where(and(
    active(auditSchedules, organizationId), eq(auditSchedules.id, String(parentId)),
  ));
  if (!parent || !isProgramme(parent)) throw new HttpError(422, "parentId must identify an active audit programme");
  return parent.id;
}
async function scheduleInScope(req: Request, row: AnyRow): Promise<boolean> {
  if (isProgramme(row)) {
    if (req.permissionAdminBypass || row.ownerId === actor(req).id) return true;
    return (await programmeChildren(req, row.id)).length > 0;
  }
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (scope.unrestricted) return true;
  const ids = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
  if (ids.length === 0 && isProcessAuditSchedule(row)) return true;
  return ids.length > 0 && ids.every((id) => scope.projectIds.includes(id));
}
async function assertAuditProject(req: Request, projectId: string | null | undefined) {
  if (req.permissionAdminBypass) return;
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!projectId) {
    if (!scope.unrestricted) throw new HttpError(403, "You do not have access to a projectless Audit record");
    return;
  }
  if (!scope.unrestricted && !scope.projectIds.includes(projectId)) throw new HttpError(403, "You do not have access to this project");
}

async function assertAuditRecordAccess(req: Request, recordType: string, recordId: string) {
  let projectId: string | null | undefined;
  if (recordType === "audit_schedule") {
    const [row] = await db.select().from(auditSchedules)
      .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, recordId)));
    await assertChildSchedule(row);
    if (!await scheduleInScope(req, row)) throw new HttpError(403, "You do not have access to this project");
    return;
  } else if (recordType === "audit" || recordType === "audit_execution") {
    const [row] = await db.select({ projectId: audits.projectId, planId: audits.auditPlanId }).from(audits)
      .where(and(active(audits, actor(req).organizationId), eq(audits.id, recordId)));
    projectId = row?.projectId;
    // Internal Process audits are department-scoped, not project-scoped. Match
    // the parent-chain check already used for /audits/:id detail routes.
    if (row && !projectId && await isProcessPlanId(actor(req).organizationId, row.planId)) return;
  } else if (recordType === "audit_finding" || recordType === "finding") {
    const [row] = await db.select({ projectId: audits.projectId }).from(auditFindings)
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(auditFindings.id, recordId), active(auditFindings, actor(req).organizationId), isNull(audits.deletedAt)));
    projectId = row?.projectId;
  } else if (recordType === "corrective_action_report" || recordType === "car") {
    const [row] = await db.select({ projectId: audits.projectId, planId: audits.auditPlanId }).from(correctiveActionReports)
      .innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id))
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(
        eq(correctiveActionReports.id, recordId),
        active(correctiveActionReports, actor(req).organizationId),
        eq(auditFindings.organizationId, actor(req).organizationId),
        isNull(auditFindings.deletedAt),
        eq(audits.organizationId, actor(req).organizationId),
        isNull(audits.deletedAt),
      ));
    projectId = row?.projectId;
    if (!projectId && row?.planId && await isProcessPlanId(actor(req).organizationId, row.planId)) {
      // The detail route has already passed the router-wide parent-chain scope guard.
      // That guard explicitly permits scoped process-audit records without project IDs.
      if (req.path === `/cars/${recordId}`) return;
      const scope = await getAuthorizedProjectScope(req, "audit");
      if (scope.unrestricted || scope.projectIds.length > 0 || scope.processAuditsAllowed) return;
      throw new HttpError(403, "You do not have access to this project");
    }
  } else {
    throw new HttpError(422, "Unsupported audit evidence record type");
  }
  if (!projectId) throw new HttpError(404, "Audit evidence record not found");
  await assertAuditProject(req, projectId);
}

// Resolve the project through audit's parent chain before every detail,
// workflow, evidence, and export operation. This keeps authorization intact
// even where the child table does not store a project column.
router.use(asyncHandler(async (req, _res, next) => {
  // This read-only endpoint checks kind, tenancy and scope against retained
  // rows itself, allowing authorized access to a deleted child's history.
  if (req.method === "GET" && /^\/schedules\/[^/]+\/activity$/.test(req.path)) return next();
  const match = /^\/(schedules|plans|audits|findings|cars)(?:\/([^/]+))?/i.exec(req.path);
  let projectIds: string[] = [];
  let recordFound = false;
  let allowProjectless = false;
  const id = match?.[2];
  const routeType = match?.[1]?.toLowerCase();
  if (routeType === "schedules" && id) {
    const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, id)));
    if (row) {
      if (isProgramme(row)) throw new HttpError(404, "Audit programme is not a child schedule");
      recordFound = true; projectIds = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
      allowProjectless = isProcessAuditSchedule(row);
    }
  } else if (routeType === "plans" && id) {
    const [row] = await db.select({ projectId: auditPlans.projectId, scheduleId: auditPlans.auditScheduleId }).from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, id)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; else allowProjectless = await isProcessScheduleId(actor(req).organizationId, row.scheduleId); }
  } else if (routeType === "audits" && id) {
    const [row] = await db.select({ projectId: audits.projectId, planId: audits.auditPlanId }).from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, id)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; else allowProjectless = await isProcessPlanId(actor(req).organizationId, row.planId); }
  } else if (routeType === "findings" && id) {
    const [row] = await db.select({ projectId: audits.projectId, planId: audits.auditPlanId }).from(auditFindings)
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(eq(auditFindings.id, id), eq(audits.organizationId, actor(req).organizationId), isNull(auditFindings.deletedAt)));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; else allowProjectless = await isProcessPlanId(actor(req).organizationId, row.planId); }
  } else if (routeType === "cars" && id) {
    const [row] = await db.select({ projectId: audits.projectId, planId: audits.auditPlanId }).from(correctiveActionReports)
      .innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id))
      .innerJoin(audits, eq(auditFindings.auditId, audits.id))
      .where(and(
        eq(correctiveActionReports.id, id),
        eq(correctiveActionReports.organizationId, actor(req).organizationId),
        isNull(correctiveActionReports.deletedAt),
        eq(auditFindings.organizationId, actor(req).organizationId),
        isNull(auditFindings.deletedAt),
        eq(audits.organizationId, actor(req).organizationId),
        isNull(audits.deletedAt),
      ));
    if (row) { recordFound = true; if (row.projectId) projectIds = [row.projectId]; else allowProjectless = await isProcessPlanId(actor(req).organizationId, row.planId); }
  }
  if (recordFound) {
    const scope = await getAuthorizedProjectScope(req, "audit");
    if (!scope.unrestricted && ((!projectIds.length && !allowProjectless) || projectIds.some((projectId) => !scope.projectIds.includes(projectId)))) {
      throw new HttpError(403, "You do not have access to this project");
    }
  }
  next();
}));
const scheduleDto = (row: AnyRow, canReview = false, hasPlan = false, teamLeadIds: string[] | null = null) => {
  const meta = scheduleMeta(row);
  const currentApprovalRole = row.workflowState === "submitted"
    ? (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0]?.name ?? null
    : null;
  return {
    id: row.id, parentId: meta.parentId ?? null, teamLeadIds, year: row.year, title: row.title, projectIds: meta.projectIds ?? (row.projectId ? [row.projectId] : []),
    activityRoleAssignments: meta.activityRoleAssignments ?? [],
    auditTypes: meta.auditTypes ?? [], plannedStartDate: new Date(meta.plannedStartDate ?? `${row.year}-01-01`),
    plannedEndDate: new Date(meta.plannedEndDate ?? `${row.year}-12-31`), ownerId: row.ownerId ?? undefined,
    workflowState: ({ draft: "Draft", submitted: "Submitted", approved: "Approved", sent_back: "Sent Back" } as AnyRow)[row.workflowState] ?? "Draft",
    reviewComments: meta.reviewComments ?? null,
    auditCategory: meta.auditCategory ?? "", departmentProject: meta.departmentProject ?? "",
    location: meta.location ?? "", processProductOwner: meta.processProductOwner ?? "",
    gpsLat: meta.gpsLat ?? null, gpsLng: meta.gpsLng ?? null,
    qaqcReference: meta.qaqcReference ?? "", auditNumber: meta.auditNumber ?? "",
    qaqcScope: meta.qaqcScope ?? "System and Process audits against ISO 9001:2015",
    qaqcClauses: meta.qaqcClauses ?? "ISO 9001 — All clauses", remarks: meta.remarks ?? null,
    l1Name: meta.l1Name ?? "", l1ReviewStatus: meta.l1ReviewStatus ?? "Pending",
    l1ReviewComments: meta.l1ReviewComments ?? null, l1Attachments: meta.l1Attachments ?? [],
    l2Name: meta.l2Name ?? "", l2ReviewStatus: meta.l2ReviewStatus ?? "Pending",
    l2ReviewComments: meta.l2ReviewComments ?? null, l2Attachments: meta.l2Attachments ?? [],
    memoDescription: meta.memoDescription ?? "", memoCirculation: meta.memoCirculation ?? "",
    feasibilityDecision: meta.feasibilityDecision ?? null,
    feasibilityFeedback: meta.feasibilityFeedback ?? null,
    feasibilityRecordedAt: meta.feasibilityRecordedAt ?? null,
    currentApprovalRole, approvalRoles: (meta.approvalRoles ?? []).map(role => role.name), canReview, hasPlan,
  };
};
const scheduleValues = (data: AnyRow) => ({
  id: data.id, year: data.year, title: data.title, projectId: data.projectIds[0] ?? null,
  ownerId: data.ownerId || null,
  workflowState: ({ Draft: "draft", Submitted: "submitted", Approved: "approved", "Sent Back": "sent_back", Deleted: "deleted" } as AnyRow)[data.workflowState],
  status: JSON.stringify({
    parentId: data.parentId ?? null,
    activityRoleAssignments: data.activityRoleAssignments ?? [],
    projectIds: data.projectIds, auditTypes: data.auditTypes ?? [], plannedStartDate: dateOnly(data.plannedStartDate),
    plannedEndDate: dateOnly(data.plannedEndDate), reviewComments: data.reviewComments ?? null,
    auditCategory: data.auditCategory, departmentProject: data.departmentProject, location: data.location,
    gpsLat: data.gpsLat ?? null, gpsLng: data.gpsLng ?? null,
    processProductOwner: data.processProductOwner, qaqcReference: data.qaqcReference, auditNumber: data.auditNumber,
    feasibilityDecision: data.feasibilityDecision ?? null,
    feasibilityFeedback: data.feasibilityFeedback ?? null,
    feasibilityRecordedAt: data.feasibilityRecordedAt ?? null,
    qaqcScope: data.qaqcScope, qaqcClauses: data.qaqcClauses, remarks: data.remarks ?? null,
    l1Name: data.l1Name, l1ReviewStatus: data.l1ReviewStatus, l1ReviewComments: data.l1ReviewComments ?? null,
    l1Attachments: data.l1Attachments ?? [], l2Name: data.l2Name, l2ReviewStatus: data.l2ReviewStatus,
    l2ReviewComments: data.l2ReviewComments ?? null, l2Attachments: data.l2Attachments ?? [],
    memoDescription: data.memoDescription, memoCirculation: data.memoCirculation,
  }),
});
const isMatchingScheduleCreate = (row: AnyRow, values: ReturnType<typeof scheduleValues>) =>
  row.year === values.year
  && row.title === values.title
  && row.projectId === values.projectId
  && (row.ownerId ?? null) === (values.ownerId ?? null)
  && row.workflowState === values.workflowState
  && row.status === values.status;

/** Validate schedule fields against audit-scope master data; blank values are allowed (field controls govern requiredness). */
async function assertScheduleLovs(organizationId: string, data: AnyRow, legacy?: ScheduleMeta) {
  const ownerName = typeof data.processProductOwner === "string" ? data.processProductOwner.trim() : "";
  if (ownerName && ownerName !== legacy?.processProductOwner?.trim() &&
    !(await auditUsersWithMarker(organizationId, "product_process_owner")).some(user => user.fullName === ownerName)) {
    throw new HttpError(422, "Select an active Audit user with Product / Process Owner authorization");
  }
  data.processProductOwner = ownerName;
  const checks: Array<[string, unknown, string | null | undefined]> = [];
  if ((data.auditTypes ?? []).includes(PROCESS_AUDIT_TYPE)) {
    checks.push(["departments", data.departmentProject, legacy?.departmentProject]);
  }
  for (const [group, value, legacyValue] of checks) {
    if (typeof value === "string" && value.trim()) {
      await assertLovValue(db, organizationId, group, value, { allowLegacy: legacyValue });
    }
  }
}

/** Enforce category/type metadata only after at least one active category defines a mapping. */
async function assertScheduleCategoryTypes(
  organizationId: string,
  category: string,
  auditTypes: string[],
  previous?: ScheduleMeta,
) {
  const previousTypes = previous?.auditTypes ?? [];
  const sortedPreviousTypes = [...previousTypes].sort();
  const unchangedTypes = auditTypes.length === previousTypes.length
    && [...auditTypes].sort().every((value, index) => value === sortedPreviousTypes[index]);
  if (previous?.auditCategory === category && unchangedTypes) return;

  const categoryRows = await db.select({
    value: masterDataValues.value,
    metadata: masterDataValues.metadata,
  }).from(masterDataValues)
    .innerJoin(masterDataGroups, eq(masterDataGroups.id, masterDataValues.groupId))
    .where(and(
      eq(masterDataGroups.organizationId, organizationId),
      eq(masterDataGroups.code, "audit_categories"),
      eq(masterDataGroups.status, "active"),
      isNull(masterDataGroups.deletedAt),
      eq(masterDataValues.organizationId, organizationId),
      eq(masterDataValues.active, true),
      eq(masterDataValues.status, "active"),
      isNull(masterDataValues.deletedAt),
    ));
  const mappings = new Map(categoryRows.map(row => {
    const configured = row.metadata.auditTypeValues;
    const values = Array.isArray(configured)
      ? configured.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    return [row.value, values];
  }));
  if (![...mappings.values()].some(values => values.length > 0)) return;

  const allowedTypes = mappings.get(category) ?? [];
  const incompatible = auditTypes.filter(value => !allowedTypes.includes(value));
  if (incompatible.length) {
    throw new HttpError(422, `Audit category "${category}" is not configured for selected audit type(s): ${incompatible.join(", ")}`);
  }
}

/** Business rule: the To date may not be before the From date. Inputs may be ISO strings or zod-coerced Dates. */
function assertScheduleDates(data: AnyRow) {
  const from = data.plannedStartDate ? new Date(data.plannedStartDate) : null;
  const to = data.plannedEndDate ? new Date(data.plannedEndDate) : null;
  if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to.getTime() < from.getTime()) {
    throw new HttpError(422, "To Date must be on or after From Date");
  }
}

async function assertScheduleParentDates(organizationId: string, parentId: unknown, data: AnyRow) {
  if (!parentId || parentId === "legacy") return;
  const parent = await assertValidParent(organizationId, parentId);
  if (!parent) return;
  const [row] = await db.select().from(auditSchedules).where(and(
    active(auditSchedules, organizationId), eq(auditSchedules.id, parent),
  ));
  if (!row) return;
  const meta = scheduleMeta(row);
  const start = dateOnly(data.plannedStartDate);
  const end = dateOnly(data.plannedEndDate);
  const parentStart = meta.fromDate?.slice(0, 10);
  const parentEnd = meta.toDate?.slice(0, 10);
  if (start && parentStart && start < parentStart) {
    throw new HttpError(422, `From Date must be on or after the Audit Schedule start date (${parentStart})`);
  }
  if (end && parentEnd && end > parentEnd) {
    throw new HttpError(422, `To Date must be on or before the Audit Schedule end date (${parentEnd})`);
  }
}

const programmeDto = (row: AnyRow, childCount = 0) => {
  const meta = scheduleMeta(row);
  const roles = meta.approvalRoles ?? [];
  return {
    id: row.id, title: row.title, teamLeadIds: meta.teamLeadIds ?? [], fromDate: meta.fromDate ?? `${row.year}-01-01`,
    toDate: meta.toDate ?? `${row.year}-12-31`,
    workflowState: ({ draft: "Draft", submitted: "Submitted", approved: "Approved", sent_back: "Sent Back" } as AnyRow)[row.workflowState] ?? "Draft",
    childCount, ownerId: row.ownerId ?? null,
    currentApprovalRole: row.workflowState === "submitted" ? roles[meta.approvalIndex ?? 0]?.name ?? null : null,
    approvalRoles: roles.map(role => role.name),
    submissionReference: meta.submissionReference ?? null,
    submissionFrom: meta.submissionFrom ?? null,
    submissionTo: meta.submissionTo ?? null,
    submissionSubject: meta.submissionSubject ?? null,
    submissionMailBody: meta.submissionMailBody ?? null,
  };
};

function programmeSubmissionMemo(meta: ScheduleMeta) {
  const headings = [
    meta.submissionReference && `Reference: ${meta.submissionReference}`,
    meta.submissionFrom && `From: ${meta.submissionFrom}`,
    meta.submissionTo && `To: ${meta.submissionTo}`,
    meta.submissionSubject && `Subject: ${meta.submissionSubject}`,
  ].filter((line): line is string => Boolean(line));
  return [...headings, "", meta.submissionMailBody ?? ""].join("\n");
}

async function programmeChildren(req: Request, parentId: string): Promise<AnyRow[]> {
  const rows = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
  const candidates = rows.filter(row => {
    const meta = scheduleMeta(row);
    return !meta.programme && (parentId === "legacy" ? !meta.parentId : meta.parentId === parentId);
  });
  const [parent] = parentId === "legacy" ? [] : rows.filter(row => row.id === parentId && isProgramme(row));
  if (parent && (req.permissionAdminBypass || parent.ownerId === actor(req).id)) return candidates;
  return (await Promise.all(candidates.map(async row => (await scheduleInScope(req, row)) ? row : null))).filter(Boolean) as AnyRow[];
}

async function assertProgrammeMutationAccess(req: Request, parent: AnyRow, childRows?: AnyRow[]) {
  if (req.permissionAdminBypass) return;
  const children = childRows ?? (await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)))
    .filter(row => !isProgramme(row) && scheduleMeta(row).parentId === parent.id);
  const visible = await Promise.all(children.map(row => scheduleInScope(req, row)));
  if (visible.some(inScope => !inScope)) throw new HttpError(403, "You do not have access to every child audit in this programme");
}

async function programmeManagementChildren(req: Request, parent: AnyRow) {
  const rows = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
  return rows.filter(row => !isProgramme(row) && scheduleMeta(row).parentId === parent.id);
}

async function hasProgrammeManagerMarker(req: Request, children: AnyRow[]) {
  const assignments = await db.select({
    projectIds: auditUserWorkspaceRoles.projectIds,
    businessUnitIds: auditUserWorkspaceRoles.businessUnitIds,
  }).from(auditUserWorkspaceRoles)
    .innerJoin(auditWorkspaceRoles, and(
      eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId),
      eq(auditWorkspaceRoles.organizationId, actor(req).organizationId),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
    ))
    .innerJoin(auditWorkspaceRolePermissions, and(
      eq(auditWorkspaceRolePermissions.workspaceRoleId, auditWorkspaceRoles.id),
      eq(auditWorkspaceRolePermissions.organizationId, actor(req).organizationId),
      isNull(auditWorkspaceRolePermissions.deletedAt),
    ))
    .innerJoin(auditPermissions, and(
      eq(auditPermissions.id, auditWorkspaceRolePermissions.permissionId),
      eq(auditPermissions.organizationId, actor(req).organizationId),
      eq(auditPermissions.key, "audit_program_manager"), isNull(auditPermissions.deletedAt),
    ))
    .where(and(
      eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId),
      eq(auditUserWorkspaceRoles.userId, actor(req).id),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
    ));
  if (!assignments.length) return false;
  if (assignments.some(row => !row.projectIds?.length && !row.businessUnitIds?.length)) return true;
  const allowed = new Set(assignments.flatMap(row => row.projectIds ?? []));
  return children.every(child => {
    const ids = scheduleMeta(child).projectIds ?? (child.projectId ? [child.projectId] : []);
    return ids.length > 0 && ids.every(id => allowed.has(id));
  });
}

async function canManageProgrammeLeads(req: Request, row: AnyRow, children: AnyRow[]) {
  if (row.workflowState !== "approved" || !await hasProgrammeManagerMarker(req, children)) return false;
  if (req.permissionAdminBypass) return true;
  return (await Promise.all(children.map(child => scheduleInScope(req, child)))).every(Boolean);
}

// Publish applies schema differences but not data migrations. Convert pre-existing
// L1/L2 approval roles once so their next submission uses a stored level.
async function backfillLegacyApprovalLevels(organizationId: string) {
  await db.execute(sql`
    UPDATE app3_audit.workspace_roles AS role
    SET role_authorization_level = substring(role.name from '\\m[Ll]([0-9]{1,9})\\M')::integer
    WHERE role.organization_id = ${organizationId}
      AND role.role_authorization_level IS NULL
      AND role.name ~ '\\m[Ll][0-9]{1,9}\\M'
      AND substring(role.name from '\\m[Ll]([0-9]{1,9})\\M')::bigint BETWEEN 1 AND 2147483647
      AND EXISTS (
        SELECT 1 FROM app3_audit.workspace_role_permissions AS rp
        JOIN app3_audit.permissions AS permission ON permission.id = rp.permission_id
        WHERE rp.workspace_role_id = role.id AND rp.deleted_at IS NULL
          AND permission.deleted_at IS NULL AND rp.grant = 'full'
          AND permission.key IN ('approve_reject', 'schedules.approve_reject', 'schedules')
      )
  `);
}

async function approvalRoleChain(organizationId: string) {
  await backfillLegacyApprovalLevels(organizationId);
  const rows = await db.select({
    id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name, level: auditWorkspaceRoles.roleAuthorizationLevel,
  }).from(auditWorkspaceRoles)
    .innerJoin(auditWorkspaceRolePermissions, and(
      eq(auditWorkspaceRolePermissions.workspaceRoleId, auditWorkspaceRoles.id),
      isNull(auditWorkspaceRolePermissions.deletedAt),
    ))
    .innerJoin(auditPermissions, and(
      eq(auditPermissions.id, auditWorkspaceRolePermissions.permissionId),
      isNull(auditPermissions.deletedAt),
    ))
    .where(and(
      eq(auditWorkspaceRoles.organizationId, organizationId), eq(auditWorkspaceRoles.status, "active"),
      isNull(auditWorkspaceRoles.deletedAt), eq(auditWorkspaceRolePermissions.organizationId, organizationId),
      or(eq(auditPermissions.key, "schedules.approve_reject"), eq(auditPermissions.key, "approve_reject"), eq(auditPermissions.key, "schedules"), eq(auditPermissions.key, "audit.schedules.approve_reject")),
      eq(auditWorkspaceRolePermissions.grant, "full"),
    ));
  const unique = [...new Map(rows.map(row => [row.id, row])).values()]
    .filter(role => role.level !== null && role.level > 0);
  return unique.sort((a, b) => a.level! - b.level! || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

async function roleUserIds(organizationId: string, roleId: string) {
  const rows = await db.select({ id: users.id }).from(auditUserWorkspaceRoles)
    .innerJoin(users, eq(users.id, auditUserWorkspaceRoles.userId))
    .where(and(
      eq(auditUserWorkspaceRoles.organizationId, organizationId), eq(auditUserWorkspaceRoles.workspaceRoleId, roleId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
  return rows.map(row => row.id);
}

async function roleUserNames(organizationId: string, roleId: string) {
  const rows = await db.select({ fullName: users.fullName }).from(auditUserWorkspaceRoles)
    .innerJoin(users, eq(users.id, auditUserWorkspaceRoles.userId))
    .where(and(
      eq(auditUserWorkspaceRoles.organizationId, organizationId), eq(auditUserWorkspaceRoles.workspaceRoleId, roleId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
      eq(users.accessStatus, "active"), isNull(users.deletedAt),
    ));
  return [...new Set(rows.map(row => row.fullName))];
}

async function canReviewApproval(req: Request, row: AnyRow) {
  if (row.workflowState !== "submitted") return false;
  const meta = scheduleMeta(row);
  const role = (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0];
  return Boolean(role && (await roleUserIds(actor(req).organizationId, role.id)).includes(actor(req).id));
}

type MyActionKind = "programme" | "schedule" | "plan" | "audit" | "car";
type MyActionItem = {
  kind: MyActionKind; id: string; title: string; action: string;
  status: string; href: string; dueDate: string | null;
};

const moduleSelectScope = (req: Request, module: string) =>
  getAuthorizedProjectScope(req, "audit", { module, action: "select" });
const moduleFullScope = (req: Request, module: string, operation?: "review") =>
  getAuthorizedProjectScope(req, "audit", { module, action: "full", operation });
const scopeHasSelectAccess = (scope: Awaited<ReturnType<typeof moduleSelectScope>>) =>
  scope.unrestricted || scope.projectIds.length > 0 || scope.processAuditsAllowed === true;
const hasActionPermission = (
  selectScope: Awaited<ReturnType<typeof moduleSelectScope>>,
  fullScope: Awaited<ReturnType<typeof moduleFullScope>>,
) => scopeHasSelectAccess(selectScope) && scopeHasSelectAccess(fullScope);
function myActionProjectInScope(projectId: string | null | undefined,
  selectScope: Awaited<ReturnType<typeof moduleSelectScope>>,
  fullScope: Awaited<ReturnType<typeof moduleFullScope>>,
  effectiveScope: Awaited<ReturnType<typeof moduleSelectScope>>,
  allowProjectless = false) {
  if (!scopeHasSelectAccess(selectScope) || !scopeHasSelectAccess(fullScope) || !scopeHasSelectAccess(effectiveScope)) return false;
  if (!projectId) return allowProjectless;
  return (selectScope.unrestricted || selectScope.projectIds.includes(projectId))
    && (fullScope.unrestricted || fullScope.projectIds.includes(projectId))
    && (effectiveScope.unrestricted || effectiveScope.projectIds.includes(projectId));
}
const myActionDate = (value: unknown) => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

async function programmeResponse(req: Request, row: AnyRow, childCount: number) {
  const meta = scheduleMeta(row);
  const currentRole = row.workflowState === "submitted"
    ? (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0]
    : null;
  const selectedIds = meta.teamLeadIds ?? [];
  const selectedUsers = selectedIds.length ? await db.select({ id: users.id, fullName: users.fullName })
    .from(users).where(and(eq(users.organizationId, actor(req).organizationId), inArray(users.id, selectedIds))) : [];
  const namesById = new Map(selectedUsers.map(user => [user.id, user.fullName]));
  return {
    ...programmeDto(row, childCount),
    teamLeadNames: selectedIds.map(id => namesById.get(id) ?? `User unavailable (${id.slice(0, 8)})`),
    currentApproverNames: currentRole ? await roleUserNames(actor(req).organizationId, currentRole.id) : [],
    canReview: await canReviewApproval(req, row),
    canSubmit: ["draft", "sent_back"].includes(row.workflowState) && (row.ownerId === actor(req).id || req.permissionAdminBypass),
    canManageTeamLeads: row.workflowState === "approved" && await canManageProgrammeLeads(req, row, await programmeManagementChildren(req, row)),
  };
}

async function scheduleResponse(req: Request, row: AnyRow, hasPlan = false, parent?: AnyRow) {
  const parentId = scheduleMeta(row).parentId;
  if (parentId && !parent) {
    [parent] = await db.select({ status: auditSchedules.status }).from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, parentId),
    )).limit(1);
  }
  return scheduleDto(row, await canReviewApproval(req, row), hasPlan, parent && isProgramme(parent) ? scheduleMeta(parent).teamLeadIds ?? null : null);
}

async function auditUsersWithMarker(organizationId: string, permissionKey: "audit_team_lead" | "product_process_owner") {
  const rows = await db.select({
    id: users.id, fullName: users.fullName, designation: users.designation,
    ...(permissionKey === "audit_team_lead" ? { email: users.email } : {}),
  }).from(users)
    .innerJoin(applicationAccess, and(
      eq(applicationAccess.username, users.username), eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.canOpenAudit, true), isNull(applicationAccess.deletedAt),
    ))
    .innerJoin(auditUserWorkspaceRoles, and(
      eq(auditUserWorkspaceRoles.userId, users.id), eq(auditUserWorkspaceRoles.organizationId, organizationId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
    ))
    .innerJoin(auditWorkspaceRoles, and(
      eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId), eq(auditWorkspaceRoles.organizationId, organizationId),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
    ))
    .innerJoin(auditWorkspaceRolePermissions, and(
      eq(auditWorkspaceRolePermissions.workspaceRoleId, auditWorkspaceRoles.id),
      eq(auditWorkspaceRolePermissions.organizationId, organizationId),
      isNull(auditWorkspaceRolePermissions.deletedAt),
    ))
    .innerJoin(auditPermissions, and(
      eq(auditPermissions.id, auditWorkspaceRolePermissions.permissionId),
      eq(auditPermissions.organizationId, organizationId),
      eq(auditPermissions.key, permissionKey), isNull(auditPermissions.deletedAt),
    ))
    .where(and(eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

async function eligibleMeetingAttendees(organizationId: string) {
  return db.selectDistinct({ id: users.id, fullName: users.fullName, designation: users.designation }).from(users)
    .innerJoin(applicationAccess, and(
      eq(applicationAccess.username, users.username), eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.canOpenAudit, true), isNull(applicationAccess.deletedAt),
    ))
    .innerJoin(auditUserWorkspaceRoles, and(
      eq(auditUserWorkspaceRoles.userId, users.id), eq(auditUserWorkspaceRoles.organizationId, organizationId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
    ))
    .innerJoin(auditWorkspaceRoles, and(
      eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId),
      eq(auditWorkspaceRoles.organizationId, organizationId),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
    ))
    .where(and(eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
}

const auditTeamLeadUsers = (organizationId: string) => auditUsersWithMarker(organizationId, "audit_team_lead");

router.get("/team-leads", requirePermission("audit", "schedules", "select"), asyncHandler(async (req, res) => {
  res.json(await auditTeamLeadUsers(actor(req).organizationId));
}));
router.get("/process-product-owners", requirePermission("audit", "schedules", "select"), asyncHandler(async (req, res) => {
  res.json(await auditUsersWithMarker(actor(req).organizationId, "product_process_owner"));
}));
router.get("/programmes", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const rows = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)).orderBy(desc(auditSchedules.year), desc(auditSchedules.updatedAt));
  const programmes = rows.filter(row => scheduleMeta(row).programme);
  const legacyCandidates = rows.filter(row => !isProgramme(row) && !scheduleMeta(row).parentId);
  const legacy = (await Promise.all(legacyCandidates.map(async row => (await scheduleInScope(req, row)) ? row : null))).filter(Boolean) as AnyRow[];
  const visibleProgrammes = (await Promise.all(programmes.map(async row => (await scheduleInScope(req, row)) ? row : null))).filter(Boolean) as AnyRow[];
  const items = await Promise.all(visibleProgrammes.map(async row => programmeResponse(req, row, (await programmeChildren(req, row.id)).length)));
  if (legacy.length) items.push({ id: "legacy", title: "Existing audit schedules", teamLeadIds: [], teamLeadNames: [], fromDate: `${new Date().getFullYear()}-01-01`, toDate: `${new Date().getFullYear()}-12-31`, workflowState: "Draft", childCount: legacy.length, ownerId: null, currentApprovalRole: null, currentApproverNames: [], approvalRoles: [], canReview: false, canSubmit: false, canManageTeamLeads: false, submissionReference: null, submissionFrom: null, submissionTo: null, submissionSubject: null, submissionMailBody: null });
  const offset = (page - 1) * limit;
  res.json(paginated(items.slice(offset, offset + limit), items.length, page, limit));
}));

router.post("/programmes", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditProgrammeBody, req);
  if (new Date(data.toDate).getTime() < new Date(data.fromDate).getTime()) throw new HttpError(422, "To Date must be on or after From Date");
  const selectedIds = [...new Set(data.teamLeadIds as string[])];
  const eligibleIds = new Set((await auditTeamLeadUsers(actor(req).organizationId)).map(user => user.id));
  if (selectedIds.some(id => !eligibleIds.has(id))) throw new HttpError(422, "Select active users assigned an Audit Team Lead role");
  const id = data.id ?? randomUUID();
  const [row] = await db.insert(auditSchedules).values({
    id, organizationId: actor(req).organizationId, year: new Date(data.fromDate).getUTCFullYear(),
    title: data.title.trim(), ownerId: actor(req).id, workflowState: "draft",
    status: JSON.stringify({ programme: true, fromDate: data.fromDate, toDate: data.toDate, teamLeadIds: selectedIds }),
  }).returning();
  await auditLog(req, "create", "audit_programme", row.id, undefined, row);
  res.status(201).json(await programmeResponse(req, row, 0));
}));

async function scheduleActivity(req: Request, res: Response, programme: boolean) {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(422, "Invalid schedule ID");
  const parsed = (programme ? Api.ListAuditProgrammeActivityQueryParams : Api.ListAuditScheduleActivityQueryParams).safeParse(req.query);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.page) || !Number.isSafeInteger(parsed.data.limit)) {
    throw new HttpError(422, "Invalid audit log pagination");
  }
  const organizationId = actor(req).organizationId;
  // Include soft-deleted records so their retained history remains readable by authorized users.
  const [record] = await db.select().from(auditSchedules).where(and(
    eq(auditSchedules.organizationId, organizationId), eq(auditSchedules.id, id),
  ));
  if (!record || isProgramme(record) !== programme) throw new HttpError(404, "Audit schedule not found");
  if (!(await scheduleInScope(req, record))) throw new HttpError(403, "You do not have access to this audit schedule");
  const candidates = programme ? await db.select().from(auditSchedules).where(and(
    eq(auditSchedules.organizationId, organizationId),
    sql`${auditSchedules.status} LIKE ${`%${id}%`}`,
  )) : [record];
  const visible = (await Promise.all(candidates.filter(row => !isProgramme(row)
    && (!programme || scheduleMeta(row).parentId === id))
    .map(async row => await scheduleInScope(req, row) ? row : null))).filter(Boolean) as AnyRow[];
  const auditIds = visible.map(row => row.id);
  const recordIds = [id, ...auditIds];
  const where = and(eq(auditAuditLogEntries.organizationId, organizationId), or(
    and(eq(auditAuditLogEntries.entityType, programme ? "audit_programme" : "audit_schedule"), eq(auditAuditLogEntries.entityId, id)),
    auditIds.length ? and(eq(auditAuditLogEntries.entityType, "audit_schedule"), inArray(auditAuditLogEntries.entityId, auditIds)) : undefined,
    and(eq(auditAuditLogEntries.entityType, "evidence"), or(
      and(sql`${auditAuditLogEntries.after}->>'recordType' = 'audit_schedule'`,
        inArray(sql<string>`${auditAuditLogEntries.after}->>'recordId'`, recordIds)),
      and(sql`${auditAuditLogEntries.before}->>'recordType' = 'audit_schedule'`,
        inArray(sql<string>`${auditAuditLogEntries.before}->>'recordId'`, recordIds)),
    )),
  ));
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditAuditLogEntries).where(where).orderBy(desc(auditAuditLogEntries.createdAt), desc(auditAuditLogEntries.id)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditAuditLogEntries).where(where),
  ]);
  const actorIds = [...new Set(rows.flatMap(row => row.actorId ? [row.actorId] : []))];
  const people = actorIds.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.id, actorIds))) : [];
  const names = new Map(people.map(person => [person.id, person.fullName]));
  const titles = new Map([record, ...visible].map(row => [row.id, row.title]));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(paginated(rows.map(row => scheduleActivityEntry(row, row.actorId ? names.get(row.actorId) : undefined, titles.get(row.entityId ?? ""))), count, page, limit));
}
router.get("/programmes/:id/activity", asyncHandler(async (req, res) => scheduleActivity(req, res, true)));
router.get("/schedules/:id/activity", asyncHandler(async (req, res) => scheduleActivity(req, res, false)));
router.get("/programmes/:id", asyncHandler(async (req, res) => {
  if (String(req.params.id) === "legacy") {
    const children = await programmeChildren(req, "legacy");
    if (!children.length) throw new HttpError(404, "Audit programme not found");
    res.json({ id: "legacy", title: "Existing audit schedules", teamLeadIds: [], teamLeadNames: [], fromDate: `${new Date().getFullYear()}-01-01`, toDate: `${new Date().getFullYear()}-12-31`, workflowState: "Draft", childCount: children.length, ownerId: null, currentApprovalRole: null, currentApproverNames: [], approvalRoles: [], canReview: false, canSubmit: false, canManageTeamLeads: false, submissionReference: null, submissionFrom: null, submissionTo: null, submissionSubject: null, submissionMailBody: null });
    return;
  }
  const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!row || !scheduleMeta(row).programme) throw new HttpError(404, "Audit programme not found");
  if (!await scheduleInScope(req, row)) throw new HttpError(403, "You do not have access to this programme");
  res.json(await programmeResponse(req, row, (await programmeChildren(req, row.id)).length));
}));

router.patch("/programmes/:id/team-leads", asyncHandler(async (req, res) => {
  const data = body<{ teamLeadIds: string[] }>(Api.UpdateAuditProgrammeTeamLeadsBody, req);
  if (!data.teamLeadIds.length || new Set(data.teamLeadIds).size !== data.teamLeadIds.length) {
    throw new HttpError(422, "Select at least one distinct Audit Team Lead");
  }
  const eligibleIds = new Set((await auditTeamLeadUsers(actor(req).organizationId)).map(user => user.id));
  const id = String(req.params.id);
  const updated = await db.transaction(async tx => {
    const [before] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, id),
    )).for("update");
    if (!before || !isProgramme(before)) throw new HttpError(404, "Audit schedule not found");
    if (before.workflowState !== "approved") throw new HttpError(409, "Only approved Audit Schedules can have their Team Leads changed");
    const children = await programmeManagementChildren(req, before);
    if (!await canManageProgrammeLeads(req, before, children)) throw new HttpError(403, "Audit Program Manager permission and access to all child audits required");
    await assertProgrammeMutationAccess(req, before, children);
    const previous = scheduleMeta(before).teamLeadIds ?? [];
    if (data.teamLeadIds.some(userId => !previous.includes(userId) && !eligibleIds.has(userId))) {
      throw new HttpError(422, "New Team Leads must be active users assigned an Audit Team Lead role");
    }
    const removed = previous.filter(userId => !data.teamLeadIds.includes(userId));
    if (removed.length && children.length) {
      const plans = await tx.select().from(auditPlans)
        .where(and(active(auditPlans, actor(req).organizationId), inArray(auditPlans.auditScheduleId, children.map(child => child.id))));
      if (plans.some(plan => removed.includes(planMeta(plan).leadAuditorId ?? plan.teamMemberIds[0] ?? ""))) {
        throw new HttpError(409, "A selected Team Lead is already assigned to an active Audit Plan");
      }
    }
    const [row] = await tx.update(auditSchedules).set({
      status: JSON.stringify({ ...scheduleMeta(before), teamLeadIds: data.teamLeadIds }), updatedAt: new Date(),
    }).where(eq(auditSchedules.id, id)).returning();
    return { before, row, childCount: children.length };
  });
  await auditLog(req, "update_team_leads", "audit_programme", id, updated.before, updated.row);
  res.json(await programmeResponse(req, updated.row, updated.childCount));
}));

router.get("/programmes/:id/signatories", asyncHandler(async (req, res) => {
  const [programme] = await db.select().from(auditSchedules).where(and(
    active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id)),
  ));
  if (!programme || !isProgramme(programme)) throw new HttpError(404, "Audit programme not found");
  if (!await scheduleInScope(req, programme)) throw new HttpError(403, "You do not have access to this programme");
  await assertProgrammeMutationAccess(req, programme);

  const history = await db.select().from(auditAuditLogEntries).where(and(
    eq(auditAuditLogEntries.organizationId, actor(req).organizationId),
    eq(auditAuditLogEntries.entityType, "audit_programme"),
    eq(auditAuditLogEntries.entityId, programme.id),
  )).orderBy(asc(auditAuditLogEntries.createdAt), asc(auditAuditLogEntries.id));
  let latestSubmitIndex = -1;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index]!.action === "submit") latestSubmitIndex = index;
  }

  const cycle = latestSubmitIndex < 0 ? [] : history.slice(latestSubmitIndex);
  const submissionMeta = parseJson<ScheduleMeta>(
    (cycle[0]?.after as AnyRow | null)?.status as string | undefined, {},
  );
  const approvalRoles = submissionMeta.approvalRoles ?? [];
  const approvals = cycle.filter(entry => entry.action === "approve" && entry.actorId);
  const cycleSentBack = cycle.some(entry => entry.action === "send_back");
  const intermediateApprovals = cycleSentBack ? [] : approvals.filter(entry => {
    const before = entry.before as AnyRow | null;
    const meta = parseJson<ScheduleMeta>(before?.status, {});
    const index = meta.approvalIndex;
    return Number.isInteger(index) && index! >= 0 && index! < approvalRoles.length - 1;
  });
  const finalApproval = programme.workflowState === "approved" && !cycleSentBack
    ? approvals.find(entry => {
      const meta = parseJson<ScheduleMeta>((entry.before as AnyRow | null)?.status, {});
      return meta.approvalIndex === approvalRoles.length - 1 && approvalRoles.length > 0;
    })
    : undefined;

  const signerIds = [...new Set([
    programme.ownerId,
    ...intermediateApprovals.map(entry => entry.actorId!),
    ...(finalApproval?.actorId ? [finalApproval.actorId] : []),
  ].filter((id): id is string => Boolean(id)))];
  const signerRows = signerIds.length ? await db.select({
    id: users.id, fullName: users.fullName, designation: users.designation, signaturePath: users.signaturePath,
  }).from(users).where(and(
    eq(users.organizationId, actor(req).organizationId), inArray(users.id, signerIds),
  )) : [];
  const signerById = new Map(signerRows.map(user => [user.id, user]));
  const activeAssignments = signerIds.length ? await db.select({
    userId: auditUserWorkspaceRoles.userId, roleName: auditWorkspaceRoles.name,
  }).from(auditUserWorkspaceRoles).innerJoin(auditWorkspaceRoles, and(
    eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId),
    eq(auditWorkspaceRoles.organizationId, actor(req).organizationId),
    eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
  )).where(and(
    eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId),
    inArray(auditUserWorkspaceRoles.userId, signerIds),
    eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
  )).orderBy(asc(auditWorkspaceRoles.name)) : [];
  const roleByUser = new Map<string, string>();
  for (const assignment of activeAssignments) {
    if (!roleByUser.has(assignment.userId)) roleByUser.set(assignment.userId, assignment.roleName);
  }
  const signatureDataUrl = async (userId: string) => {
    const path = signerById.get(userId)?.signaturePath;
    if (!path) return null;
    const object = await getObject(path.startsWith("gcs:") ? path.slice(4) : path);
    const mimeType = object.headers.get("content-type");
    if (!mimeType?.startsWith("image/")) throw new HttpError(500, "Stored signature has an invalid content type");
    return `data:${mimeType};base64,${Buffer.from(await object.arrayBuffer()).toString("base64")}`;
  };
  const makeSignatory = async (userId: string, role: string): Promise<AnyRow | null> => {
    const user = signerById.get(userId);
    if (!user) return null;
    return {
      userId: user.id, name: user.fullName, designation: user.designation,
      role, signatureDataUrl: await signatureDataUrl(userId),
    };
  };
  const preparedBy = programme.ownerId
    ? await makeSignatory(programme.ownerId, roleByUser.get(programme.ownerId) ?? "Prepared by")
    : null;
  const reviewedBy = (await Promise.all(intermediateApprovals.map(async entry => {
    const before = entry.before as AnyRow | null;
    const meta = parseJson<ScheduleMeta>(before?.status, {});
    const role = Number.isInteger(meta.approvalIndex) ? approvalRoles[meta.approvalIndex!]?.name : undefined;
    return makeSignatory(entry.actorId!, role ?? "Reviewed by");
  }))).filter(Boolean);
  const approvedBy = finalApproval?.actorId
    ? await makeSignatory(finalApproval.actorId, approvalRoles[approvalRoles.length - 1]?.name ?? "Approved by")
    : null;
  res.json({ preparedBy, reviewedBy, approvedBy });
}));

/** Build the signatory strip for the approval that is about to become final.
 * The final review is not yet in the audit log, so include the current reviewer. */
async function finalProgrammePdfSignatories(
  organizationId: string, programme: AnyRow, finalReviewerId: string,
): Promise<NonNullable<AuditScheduleApprovalPdfInput["signatories"]>> {
  const meta = scheduleMeta(programme);
  const roles = meta.approvalRoles ?? [];
  const history = await db.select({
    action: auditAuditLogEntries.action,
    actorId: auditAuditLogEntries.actorId,
    before: auditAuditLogEntries.before,
  }).from(auditAuditLogEntries).where(and(
    eq(auditAuditLogEntries.organizationId, organizationId),
    eq(auditAuditLogEntries.entityType, "audit_programme"),
    eq(auditAuditLogEntries.entityId, programme.id),
  )).orderBy(asc(auditAuditLogEntries.createdAt), asc(auditAuditLogEntries.id));
  let latestSubmit = -1;
  for (const [index, entry] of history.entries()) {
    if (entry.action === "submit") latestSubmit = index;
  }
  const reviews = history.slice(latestSubmit + 1).filter(entry => entry.action === "approve" && entry.actorId)
    .map(entry => ({
      id: entry.actorId!,
      index: parseJson<ScheduleMeta>((entry.before as AnyRow | null)?.status, {}).approvalIndex ?? -1,
    })).filter(entry => entry.index >= 0 && entry.index < roles.length - 1);
  const ids = [...new Set([
    programme.ownerId, ...reviews.map(review => review.id), finalReviewerId,
  ].filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await db.select({
    id: users.id, name: users.fullName, designation: users.designation, signaturePath: users.signaturePath,
  }).from(users).where(and(eq(users.organizationId, organizationId), inArray(users.id, ids))) : [];
  const byId = new Map(people.map(person => [person.id, person]));
  const [ownerRole] = programme.ownerId ? await db.select({ name: auditWorkspaceRoles.name })
    .from(auditUserWorkspaceRoles).innerJoin(auditWorkspaceRoles, and(
      eq(auditWorkspaceRoles.id, auditUserWorkspaceRoles.workspaceRoleId),
      eq(auditWorkspaceRoles.organizationId, organizationId),
      eq(auditWorkspaceRoles.status, "active"), isNull(auditWorkspaceRoles.deletedAt),
    )).where(and(
      eq(auditUserWorkspaceRoles.organizationId, organizationId),
      eq(auditUserWorkspaceRoles.userId, programme.ownerId),
      eq(auditUserWorkspaceRoles.status, "active"), isNull(auditUserWorkspaceRoles.deletedAt),
    )).orderBy(asc(auditWorkspaceRoles.name)).limit(1) : [];
  const make = async (id: string, role: string) => {
    const person = byId.get(id);
    if (!person) return null;
    let signatureDataUrl: string | null = null;
    if (person.signaturePath) {
      const object = await getObject(person.signaturePath.startsWith("gcs:")
        ? person.signaturePath.slice(4) : person.signaturePath);
      const mime = object.headers.get("content-type");
      if (mime === "image/png" || mime === "image/jpeg") {
        signatureDataUrl = `data:${mime};base64,${Buffer.from(await object.arrayBuffer()).toString("base64")}`;
      } else if (mime === "image/webp") {
        const jpeg = await sharp(Buffer.from(await object.arrayBuffer()))
          .flatten({ background: "#fff" })
          .resize(180, 59, { fit: "contain", background: "#fff" })
          .jpeg({ quality: 92 }).toBuffer();
        signatureDataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      } else {
        throw new HttpError(500, "Stored signature has an invalid content type");
      }
    }
    return { name: person.name, designation: person.designation, role, signatureDataUrl };
  };
  return {
    preparedBy: programme.ownerId ? await make(programme.ownerId, ownerRole?.name ?? "Prepared by") : null,
    reviewedBy: (await Promise.all(reviews.map(review =>
      make(review.id, roles[review.index]?.name ?? "Reviewed by"))))
      .filter((person): person is NonNullable<typeof person> => person !== null),
    approvedBy: await make(finalReviewerId, roles.at(-1)?.name ?? "Approved by"),
  };
}

router.delete("/programmes/:id", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditSchedules).where(and(
    active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id)),
  ));
  if (!before || !isProgramme(before)) throw new HttpError(404, "Audit programme not found");
  if (before.workflowState === "approved") throw new HttpError(409, "Approved audit schedules cannot be deleted");
  await assertProgrammeMutationAccess(req, before);
  const candidates = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
  const hasChildren = candidates.some(candidate => !isProgramme(candidate) && scheduleMeta(candidate).parentId === before.id);
  if (hasChildren) throw new HttpError(409, "Audit schedules with child audits cannot be deleted");
  const [row] = await db.update(auditSchedules).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.id))).returning();
  if (!row) throw new HttpError(404, "Audit programme not found");
  await auditLog(req, "delete", "audit_programme", row.id, before, row);
  res.status(204).end();
}));

router.post("/programmes/:id/submit", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.SubmitAuditProgrammeBody, req);
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before || !scheduleMeta(before).programme) throw new HttpError(404, "Audit programme not found");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Programme is not eligible for submission");
  const roles = await approvalRoleChain(actor(req).organizationId);
  if (!roles.length) throw new HttpError(422, "No active Audit approval roles are configured");
  const unstaffed = (await Promise.all(roles.map(async role => (await roleUserIds(actor(req).organizationId, role.id)).length ? null : role.name))).filter(Boolean);
  if (unstaffed.length) throw new HttpError(422, `Approval role has no active users: ${unstaffed.join(", ")}`);
  const firstApprovers = await roleUserIds(actor(req).organizationId, roles[0].id);
  const { row, childCount } = await db.transaction(async tx => {
    // Lock numbering before the parent, matching the order in child creation.
    const { config } = await lockScheduleNumbering(tx, actor(req).organizationId);
    const [current] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.id),
    )).for("update");
    if (!current || current.workflowState !== before.workflowState || current.status !== before.status) {
      throw new HttpError(409, "Programme changed while it was being submitted");
    }
    if (!["draft", "sent_back"].includes(current.workflowState)) throw new HttpError(409, "Programme is not eligible for submission");
    const schedules = await tx.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
    const children = schedules.filter(candidate => !isProgramme(candidate) && scheduleMeta(candidate).parentId === current.id);
    if (!children.length) throw new HttpError(422, "Add at least one audit before submitting this programme");
    await assertProgrammeMutationAccess(req, current, children);
    if (children.length > config.qaqcReference.end) throw new HttpError(409, "QA/QC Reference range is too small for this Audit Schedule");
    const sorted = [...children].sort((a, b) =>
      String(scheduleMeta(a).plannedStartDate ?? "").localeCompare(String(scheduleMeta(b).plannedStartDate ?? ""))
      || a.id.localeCompare(b.id));
    for (const [index, child] of sorted.entries()) {
      const fromDate = scheduleMeta(child).plannedStartDate;
      if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new HttpError(422, "All audits need a valid From Date before submission");
      const [renumbered] = await tx.update(auditSchedules).set({
        status: JSON.stringify({
          ...scheduleMeta(child),
          qaqcReference: formatQaqcReference(config.qaqcReference, fromDate, index + 1),
          qaqcReferenceYear: Number(fromDate.slice(0, 4)), qaqcReferenceSequence: index + 1,
        }), updatedAt: new Date(),
      }).where(eq(auditSchedules.id, child.id)).returning();
      if (renumbered && scheduleMeta(child).qaqcReference !== scheduleMeta(renumbered).qaqcReference) {
        await auditLog(req, "assign_reference", "audit_schedule", child.id, child, renumbered, tx as unknown as typeof db);
      }
    }
    const meta = scheduleMeta(current);
    const draftIds = children.filter(child => child.workflowState === "draft").map(child => child.id);
    const promoted = draftIds.length ? await tx.update(auditSchedules).set({
      workflowState: "submitted", updatedAt: new Date(),
    }).where(and(
      eq(auditSchedules.organizationId, actor(req).organizationId),
      inArray(auditSchedules.id, draftIds),
      eq(auditSchedules.workflowState, "draft"),
    )).returning() : [];
    for (const child of promoted) await auditLog(req, "programme_submit", "audit_schedule", child.id,
      { ...child, workflowState: "draft" }, child, tx as unknown as typeof db);
    const promotedIds = promoted.map(child => child.id);
    const [updated] = await tx.update(auditSchedules).set({
      workflowState: "submitted",
      status: JSON.stringify({
        ...meta,
        approvalRoles: roles,
        approvalIndex: 0,
        autoPromotedChildIds: promotedIds,
        reviewComments: null,
        submissionReference: data.reference?.trim() ?? "",
        submissionFrom: data.from?.trim() ?? "",
        submissionTo: data.to?.trim() ?? "",
        submissionDate: new Date().toISOString(),
        submissionSubject: data.subject.trim(),
        submissionMailBody: data.mailBody.trim(),
        submissionUserId: actor(req).id,
        approvalParticipantIds: [],
      }),
      updatedAt: new Date(),
    }).where(and(
      eq(auditSchedules.id, current.id),
      eq(auditSchedules.workflowState, current.workflowState),
      eq(auditSchedules.status, current.status),
    )).returning();
    if (!updated) throw new HttpError(409, "Programme changed while it was being submitted");
    await queueAuditApprovalEmail(tx as unknown as typeof db, {
      organizationId: actor(req).organizationId, actorId: actor(req).id,
      entityType: "audit_programme", entityId: updated.id, action: "submit",
      record: updated, templateValues: { next_approval_level: roles[0].level },
      recipientIds: firstApprovers, subject: data.subject.trim(),
      text: `${programmeSubmissionMemo(scheduleMeta(updated))}\n\nAudit Schedule "${updated.title}" is awaiting your approval at level ${roles[0].level}. Open QMS360 QMS Audit to review it.`,
    });
    // Preserve the canonical submit event consumed by approval-cycle/PDF history;
    // the activity projection labels a Sent Back -> Submitted transition Resubmitted.
    await auditLog(req, "submit",
      "audit_programme", updated.id, current, updated, tx as unknown as typeof db);
    return { row: updated, childCount: children.length };
  });
  const recipients = await roleUserIds(actor(req).organizationId, roles[0].id);
  await Promise.all(recipients.filter(id => id !== actor(req).id).map(userId => notify(db, "audit", { organizationId: actor(req).organizationId, userId, type: "programme_submitted", title: "Audit programme awaiting approval", body: row.title, entityType: "audit_programme", entityId: row.id })));
  res.json(await programmeResponse(req, row, childCount));
}));

router.post("/programmes/:id/review", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.ReviewAuditProgrammeBody, req);
  if (data.decision === "send_back" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  if (!before || !scheduleMeta(before).programme) throw new HttpError(404, "Audit programme not found");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted programmes may be reviewed");
  const meta = scheduleMeta(before); const role = (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0];
  await assertProgrammeMutationAccess(req, before);
  const allowed = role ? (await roleUserIds(actor(req).organizationId, role.id)).includes(actor(req).id) : false;
  if (!allowed) {
    const wasApprovalParticipant = (await Promise.all((meta.approvalRoles ?? []).map(candidate => roleUserIds(actor(req).organizationId, candidate.id))))
      .some(ids => ids.includes(actor(req).id));
    if (wasApprovalParticipant) throw new HttpError(409, "Programme approval advanced before this review was applied");
  }
  if (!allowed) throw new HttpError(403, "Only the current approval role may review this programme");
  const nextIndex = (meta.approvalIndex ?? 0) + 1; const complete = data.decision === "approve" && nextIndex >= (meta.approvalRoles ?? []).length;
  const participants = [...new Set([meta.submissionUserId ?? before.ownerId, ...(meta.approvalParticipantIds ?? []), actor(req).id].filter((id): id is string => Boolean(id)))];
  const finalEmailEnabled = complete && await auditApprovalEmailEnabled(db, {
    organizationId: actor(req).organizationId, actorId: actor(req).id, entityType: "audit_programme",
  });
  const childrenForPdf = finalEmailEnabled ? await programmeChildren(req, before.id) : [];
  const pdfAttachment = finalEmailEnabled ? await storeEmailPdfAttachment(
    actor(req).organizationId, before.id,
    await renderAuditScheduleApprovalPdf({
      title: before.title, reference: meta.submissionReference, from: meta.submissionFrom, to: meta.submissionTo,
      approvalDate: new Date().toISOString(),
      subject: meta.submissionSubject ?? before.title, memo: meta.submissionMailBody ?? "",
      signatories: await finalProgrammePdfSignatories(actor(req).organizationId, before, actor(req).id),
      rows: childrenForPdf.map(child => {
        const detail = scheduleMeta(child);
        return {
          title: child.title, fromDate: detail.plannedStartDate ?? "", toDate: detail.plannedEndDate ?? "",
          auditCategory: detail.auditCategory ?? "", departmentProject: detail.departmentProject ?? "",
          ownerName: detail.processProductOwner ?? "", auditNumber: detail.auditNumber ?? "",
          qaqcReference: detail.qaqcReference ?? "", scope: detail.qaqcScope ?? "",
          clauses: detail.qaqcClauses ?? "", remarks: detail.remarks ?? "",
        };
      }),
    }),
  ) : undefined;
  let finalPdfQueued = false;
  const row = await db.transaction(async tx => {
    const [current] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.id),
    )).for("update");
    if (!current || current.workflowState !== before.workflowState || current.status !== before.status) {
      throw new HttpError(409, "Programme changed while it was being reviewed");
    }
    const [updated] = await tx.update(auditSchedules).set({
      workflowState: data.decision === "send_back" ? "sent_back" : complete ? "approved" : "submitted",
      status: JSON.stringify({
        ...meta,
        approvalIndex: data.decision === "send_back" ? 0 : nextIndex,
        autoPromotedChildIds: data.decision === "send_back" ? [] : meta.autoPromotedChildIds ?? [],
        reviewComments: data.comments ?? null,
        approvalParticipantIds: data.decision === "approve" ? participants.filter(id => id !== (meta.submissionUserId ?? before.ownerId)) : meta.approvalParticipantIds ?? [],
      }),
      updatedAt: new Date(),
    }).where(eq(auditSchedules.id, before.id)).returning();
    if (!updated) throw new HttpError(409, "Programme changed while it was being reviewed");
    if (data.decision === "send_back") {
      const autoPromotedIds = meta.autoPromotedChildIds ?? [];
      if (autoPromotedIds.length) {
        const returned = await tx.update(auditSchedules).set({ workflowState: "draft", updatedAt: new Date() })
          .where(and(
            eq(auditSchedules.organizationId, actor(req).organizationId),
            inArray(auditSchedules.id, autoPromotedIds),
            eq(auditSchedules.workflowState, "submitted"),
            isNull(auditSchedules.deletedAt),
          )).returning();
        for (const child of returned) await auditLog(req, "programme_send_back", "audit_schedule", child.id,
          { ...child, workflowState: "submitted" }, child, tx as unknown as typeof db);
      }
    }
    if (complete) {
      const candidates = await tx.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId));
      const childIds = candidates
        .filter(candidate => !isProgramme(candidate) && scheduleMeta(candidate).parentId === before.id)
        .map(candidate => candidate.id);
      if (childIds.length) {
        const approved = await tx.update(auditSchedules).set({ workflowState: "approved", updatedAt: new Date() })
          .where(and(eq(auditSchedules.organizationId, actor(req).organizationId), inArray(auditSchedules.id, childIds))).returning();
        for (const child of approved) {
          const prior = candidates.find(candidate => candidate.id === child.id);
          if (prior?.workflowState !== "approved") await auditLog(req, "programme_approve", "audit_schedule", child.id,
            prior, child, tx as unknown as typeof db);
        }
      }
    }
    if (data.decision === "approve") {
      const nextRole = (meta.approvalRoles ?? [])[nextIndex];
      const queuedEmail = await queueAuditApprovalEmail(tx as unknown as typeof db, {
        organizationId: actor(req).organizationId, actorId: actor(req).id,
        entityType: "audit_programme", entityId: updated.id,
        action: complete ? "approved_final" : "approve",
        record: updated, templateValues: { approval_level: role?.name, next_approval_level: nextRole?.name },
        recipientIds: complete ? participants : await roleUserIds(actor(req).organizationId, nextRole.id),
        subject: complete ? `Approved: ${meta.submissionSubject ?? updated.title}` : meta.submissionSubject ?? `Approval requested: ${updated.title}`,
        text: complete
          ? `Audit Schedule "${updated.title}" has received final approval. The attached PDF begins with the submitted memo and includes the Audit Schedule Gantt chart.`
          : `${programmeSubmissionMemo(meta)}\n\nAudit Schedule "${updated.title}" is awaiting your approval at the next level. Open QMS360 QMS Audit to review it.`,
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      });
      if (complete && queuedEmail.queued > 0) finalPdfQueued = true;
    }
    if (data.decision === "send_back" && before.ownerId) {
      await queueAuditApprovalEmail(tx as unknown as typeof db, {
        organizationId: actor(req).organizationId, actorId: actor(req).id,
        entityType: "audit_programme", entityId: updated.id, action: "send_back",
        record: updated, templateValues: { approval_level: role?.name, review_comments: data.comments.trim() },
        recipientIds: [before.ownerId],
        ccRecipientIds: auditScheduleSendBackCcIds(before.ownerId, meta.approvalParticipantIds ?? [], actor(req).id),
        subject: `Sent back: ${meta.submissionSubject ?? updated.title}`,
        text: `Audit Schedule "${updated.title}" was sent back for revision.\n\nReviewer comments: ${data.comments.trim()}\n\nOpen QMS360 QMS Audit to revise and resubmit the Schedule.`,
      });
    }
    await auditLog(req, data.decision, "audit_programme", updated.id, current, updated, tx as unknown as typeof db);
    return updated;
  }).catch(async error => {
    if (pdfAttachment) {
      try { await removeEmailPdfAttachment(actor(req).organizationId, pdfAttachment.objectPath); }
      catch (cleanupError) { req.log.error({ cleanupError }, "Failed to clean up unqueued approval PDF"); }
    }
    throw error;
  });
  if (pdfAttachment && !finalPdfQueued) {
    try { await removeEmailPdfAttachment(actor(req).organizationId, pdfAttachment.objectPath); }
    catch (cleanupError) { req.log.error({ cleanupError }, "Failed to clean up unsent approval PDF"); }
  }
  if (data.decision === "send_back" && row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "programme_decision", title: "Audit programme sent back", body: data.comments, entityType: "audit_programme", entityId: row.id });
  if (data.decision === "approve" && complete && row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "programme_decision", title: "Audit programme approved", body: row.title, entityType: "audit_programme", entityId: row.id });
  if (data.decision === "approve" && !complete) {
    const next = (meta.approvalRoles ?? [])[nextIndex]; const recipients = await roleUserIds(actor(req).organizationId, next.id);
    await Promise.all(recipients.map(userId => notify(db, "audit", { organizationId: actor(req).organizationId, userId, type: "programme_submitted", title: "Audit programme awaiting approval", body: row.title, entityType: "audit_programme", entityId: row.id })));
  }
  res.json(await programmeResponse(req, row, (await programmeChildren(req, row.id)).length));
}));

router.get("/schedules", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const where = active(auditSchedules, actor(req).organizationId);
  const allItems = await db.select().from(auditSchedules).where(where).orderBy(desc(auditSchedules.year), desc(auditSchedules.updatedAt));
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : null;
  const filtered = allItems.filter(row => {
    const meta = scheduleMeta(row);
    if (meta.programme) return false;
    return parentId === "legacy" ? !meta.parentId : parentId ? meta.parentId === parentId : true;
  });
  const scoped = (await Promise.all(filtered.map(async (row) => (await scheduleInScope(req, row)) ? row : null))).filter(Boolean) as AnyRow[];
  const planRows = await db.select({ scheduleId: auditPlans.auditScheduleId }).from(auditPlans)
    .where(active(auditPlans, actor(req).organizationId));
  const plannedScheduleIds = new Set(planRows.map(plan => plan.scheduleId).filter(Boolean));
  const parents = new Map(allItems.filter(isProgramme).map(row => [row.id, row]));
  const offset = (page - 1) * limit;
  res.json(paginated(await Promise.all(scoped.slice(offset, offset + limit).map(row =>
    scheduleResponse(req, row, plannedScheduleIds.has(row.id), parents.get(scheduleMeta(row).parentId ?? "")))), scoped.length, page, limit));
}));
router.post("/schedules", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditScheduleBody, req);
  data.activityRoleAssignments = await validateActivityRoleAssignments(actor(req).organizationId, data.activityRoleAssignments ?? []);
  await assertValidParent(actor(req).organizationId, data.parentId);
  const requestedProjectIds = data.projectIds?.length ? data.projectIds : [data.projectId].filter(Boolean);
  let projectIds = requestedProjectIds.length
    ? await assertProjectScopeInOrg(db, actor(req).organizationId, requestedProjectIds)
    : [];
  data.projectIds = projectIds;
  const scope = await getAuthorizedProjectScope(req, "audit");
  const processAudit = (data.auditTypes ?? []).includes(PROCESS_AUDIT_TYPE);
  const productAudit = (data.auditTypes ?? []).includes(PRODUCT_AUDIT_TYPE);
  if (processAudit && !String(data.departmentProject ?? "").trim()) throw new HttpError(422, "A department is required for a Quality Internal Process Audit schedule");
  if (processAudit) {
    projectIds = [];
    data.projectIds = [];
  }
  if (productAudit && !projectIds.length) throw new HttpError(422, "A project is required for a Quality Internal Product Audit schedule");
  if (!scope.unrestricted && !projectIds.length && !processAudit) throw new HttpError(422, "At least one project is required for a project-scoped Audit schedule");
  if (!scope.unrestricted && projectIds.some((id) => !scope.projectIds.includes(id))) throw new HttpError(403, "You do not have access to every selected project");
  await assertFieldAccess(req, "audit", "schedule", { mode: "create" });
  await assertFieldControls(req, "audit", "schedule", { mode: "create" });
  await Promise.all((data.auditTypes ?? []).map((value: string) =>
    assertLovValue(db, actor(req).organizationId, "audit_types", value)));
  await assertLovValue(db, actor(req).organizationId, "audit_categories", data.auditCategory);
  await assertScheduleCategoryTypes(actor(req).organizationId, data.auditCategory, data.auditTypes ?? []);
  assertScheduleDates(data);
  await assertScheduleParentDates(actor(req).organizationId, data.parentId, data);
  await assertScheduleLovs(actor(req).organizationId, data);
  const requestedValues = scheduleValues(data);
  const result = await db.transaction(async tx => {
    const { config } = await lockScheduleNumbering(tx, actor(req).organizationId);
    const [existingId] = await tx.select().from(auditSchedules).where(eq(auditSchedules.id, requestedValues.id)).limit(1);
    // Retry with the same identifier must not consume a number or replace the first allocation.
    if (existingId) {
      const previousMeta = scheduleMeta(existingId);
      const requestedMeta = scheduleMeta({ status: requestedValues.status });
      const comparable = { ...requestedMeta, auditNumber: previousMeta.auditNumber, qaqcReference: previousMeta.qaqcReference,
        auditNumberScope: previousMeta.auditNumberScope, auditNumberYear: previousMeta.auditNumberYear, auditNumberSequence: previousMeta.auditNumberSequence };
      if (existingId.organizationId !== actor(req).organizationId || !isMatchingScheduleCreate(existingId, {
        ...requestedValues, status: JSON.stringify(comparable),
      })) throw new HttpError(409, "A schedule with this form identifier already exists.");
      if (existingId.deletedAt) {
        const [plan] = await tx.select({ id: auditPlans.id }).from(auditPlans).where(and(
          active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, existingId.id),
        )).limit(1);
        if (plan) throw new HttpError(409, "A deleted audit with an active plan cannot be reloaded");
        const [restored] = await tx.update(auditSchedules).set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(auditSchedules.id, existingId.id)).returning();
        return { row: restored, created: true, restored: true };
      }
      return { row: existingId, created: false, restored: false };
    }
    let workflowState = requestedValues.workflowState;
    let approvedParent = false;
    if (data.parentId) {
      const [parent] = await tx.select().from(auditSchedules).where(and(
        active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(data.parentId)),
      )).for("update");
      if (!parent || !isProgramme(parent)) throw new HttpError(422, "parentId must identify an active audit programme");
      if (parent.workflowState === "submitted") throw new HttpError(409, "Audits cannot be added to a submitted programme");
      if (parent.workflowState === "approved") {
        workflowState = "approved";
        approvedParent = true;
      }
    }
    const scopeKey = projectIds[0] ? `project:${projectIds[0]}` : `department:${String(data.departmentProject ?? "").trim().toLocaleLowerCase()}`;
    const schedulesForOrg = await tx.select({ status: auditSchedules.status }).from(auditSchedules)
      .where(eq(auditSchedules.organizationId, actor(req).organizationId));
    const used = schedulesForOrg.map(candidate => scheduleMeta(candidate)).flatMap(meta => [
      ...(meta.auditNumberScope === scopeKey ? [Number(meta.auditNumberSequence) || 0] : []),
      ...(meta.auditNumberHistory ?? []).filter(entry => entry.scope === scopeKey).map(entry => entry.sequence),
    ]);
    const sequence = Math.max(config.auditNumber.start - 1, ...used) + 1;
    if (sequence > config.auditNumber.end) throw new HttpError(409, "Audit Number range is exhausted for this department/project");
    const values = {
      ...requestedValues, workflowState,
      status: JSON.stringify({
        ...scheduleMeta({ status: requestedValues.status }),
        qaqcReference: "", auditNumber: formatAuditNumber(config.auditNumber, sequence),
        auditNumberScope: scopeKey, auditNumberSequence: sequence,
      }),
    };
    const [created] = await tx.insert(auditSchedules)
      .values({ organizationId: actor(req).organizationId, ...values })
      .onConflictDoNothing({ target: auditSchedules.id })
      .returning();
    if (created) {
      if (approvedParent) {
        const siblings = (await tx.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)))
          .filter(candidate => candidate.id !== created.id && scheduleMeta(candidate).parentId === data.parentId);
        const referenceSequence = Math.max(siblings.length,
          ...siblings.map(candidate => scheduleMeta(candidate).qaqcReferenceSequence ?? 0)) + 1;
        if (referenceSequence > config.qaqcReference.end)
          throw new HttpError(409, "QA/QC Reference range is exhausted for this Audit Schedule");
        const fromDate = scheduleMeta(created).plannedStartDate;
        if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate))
          throw new HttpError(422, "A valid From Date is required for a QA/QC Reference");
        const [numbered] = await tx.update(auditSchedules).set({
          status: JSON.stringify({
            ...scheduleMeta(created),
            qaqcReference: formatQaqcReference(config.qaqcReference, fromDate, referenceSequence),
            qaqcReferenceYear: Number(fromDate.slice(0, 4)), qaqcReferenceSequence: referenceSequence,
          }),
        }).where(eq(auditSchedules.id, created.id)).returning();
        return { row: numbered, created: true, restored: false };
      }
      return { row: created, created: true, restored: false };
    }
    const [existing] = await tx.select().from(auditSchedules).where(eq(auditSchedules.id, values.id)).limit(1);
    if (existing?.organizationId === actor(req).organizationId && isMatchingScheduleCreate(existing, values)) {
      if (existing.deletedAt) {
        // Spreadsheet rows keep a deterministic ID for safe retries. Re-importing
        // an unchanged row after deletion should revive it, not collide with its tombstone.
        const [plan] = await tx.select({ id: auditPlans.id }).from(auditPlans).where(and(
          active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, existing.id),
        )).limit(1);
        if (plan) throw new HttpError(409, "A deleted audit with an active plan cannot be reloaded");
        const [restored] = await tx.update(auditSchedules).set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(auditSchedules.id, existing.id), eq(auditSchedules.organizationId, actor(req).organizationId)))
          .returning();
        return { row: restored, created: true, restored: true };
      }
      return { row: existing, created: false, restored: false };
    }
    throw new HttpError(409, "A schedule with this form identifier already exists. Refresh the schedule list before creating another schedule.");
  });
  if (result.created) await auditLog(req, result.restored ? "restore" : "create", "audit_schedule", result.row.id, undefined, result.row);
  res.status(201).json(await scheduleResponse(req, result.row));
}));
router.get("/schedules/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  await assertChildSchedule(row);
  if (!await scheduleInScope(req, row)) throw new HttpError(403, "You do not have access to this schedule");
  const [plan] = await db.select({ id: auditPlans.id }).from(auditPlans).where(and(
    active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, row.id),
  )).limit(1);
  res.json(await scheduleResponse(req, row, Boolean(plan)));
}));
router.put("/schedules/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditScheduleBody, req);
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  await assertChildSchedule(before);
  data.activityRoleAssignments = await validateActivityRoleAssignments(actor(req).organizationId,
    data.activityRoleAssignments ?? scheduleMeta(before).activityRoleAssignments ?? []);
  data.parentId = data.parentId ?? scheduleMeta(before).parentId ?? null;
  await assertValidParent(actor(req).organizationId, data.parentId);
  const requestedProjectIds = data.projectIds?.length ? data.projectIds : [data.projectId].filter(Boolean);
  let projectIds = requestedProjectIds.length
    ? await assertProjectScopeInOrg(db, actor(req).organizationId, requestedProjectIds)
    : [];
  data.projectIds = projectIds;
  const scope = await getAuthorizedProjectScope(req, "audit");
  const processAudit = (data.auditTypes ?? []).includes(PROCESS_AUDIT_TYPE);
  const productAudit = (data.auditTypes ?? []).includes(PRODUCT_AUDIT_TYPE);
  if (processAudit && !String(data.departmentProject ?? "").trim()) throw new HttpError(422, "A department is required for a Quality Internal Process Audit schedule");
  if (processAudit) {
    projectIds = [];
    data.projectIds = [];
  }
  if (productAudit && !projectIds.length) throw new HttpError(422, "A project is required for a Quality Internal Product Audit schedule");
  if (!scope.unrestricted && !projectIds.length && !processAudit) throw new HttpError(422, "At least one project is required for a project-scoped Audit schedule");
  if (!scope.unrestricted && projectIds.some((id) => !scope.projectIds.includes(id))) throw new HttpError(403, "You do not have access to every selected project");
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Only draft or sent-back schedules may be edited");
  await assertFieldAccess(req, "audit", "schedule", { mode: "update", current: scheduleDto(before) });
  await assertFieldControls(req, "audit", "schedule", { mode: "update", current: scheduleDto(before) });
  await Promise.all((data.auditTypes ?? []).map((value: string) =>
    assertLovValue(db, actor(req).organizationId, "audit_types", value, { allowLegacy: scheduleMeta(before).auditTypes })));
  await assertLovValue(db, actor(req).organizationId, "audit_categories", data.auditCategory, { allowLegacy: [scheduleMeta(before).auditCategory ?? ""] });
  await assertScheduleCategoryTypes(actor(req).organizationId, data.auditCategory, data.auditTypes ?? [], scheduleMeta(before));
  assertScheduleDates(data);
  await assertScheduleParentDates(actor(req).organizationId, data.parentId, data);
  await assertScheduleLovs(actor(req).organizationId, data, scheduleMeta(before));
  const newScope = projectIds[0] ? `project:${projectIds[0]}` : `department:${String(data.departmentProject ?? "").trim().toLocaleLowerCase()}`;
  const values = scheduleValues(data);
  const [row] = await db.transaction(async tx => {
    const { config } = await lockScheduleNumbering(tx, actor(req).organizationId);
    const [current] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.id),
    )).for("update");
    if (!current || current.status !== before.status || current.workflowState !== before.workflowState)
      throw new HttpError(409, "Schedule changed while it was being edited");
    await assertLinkedPlanDates(tx, req, current, data);
    const originalMeta = scheduleMeta(current);
    let numberMeta = {
      auditNumber: originalMeta.auditNumber ?? "",
      auditNumberScope: originalMeta.auditNumberScope,
      auditNumberYear: originalMeta.auditNumberYear,
      auditNumberSequence: originalMeta.auditNumberSequence,
      auditNumberHistory: originalMeta.auditNumberHistory ?? [],
    };
    if (originalMeta.auditNumberScope && originalMeta.auditNumberScope !== newScope) {
      const candidates = await tx.select({ status: auditSchedules.status }).from(auditSchedules)
        .where(eq(auditSchedules.organizationId, actor(req).organizationId));
      const used = candidates.map(candidate => scheduleMeta(candidate)).flatMap(meta => [
        ...(meta.auditNumberScope === newScope ? [Number(meta.auditNumberSequence) || 0] : []),
        ...(meta.auditNumberHistory ?? []).filter(entry => entry.scope === newScope).map(entry => entry.sequence),
      ]);
      const sequence = Math.max(config.auditNumber.start - 1, ...used) + 1;
      if (sequence > config.auditNumber.end) throw new HttpError(409, "Audit Number range is exhausted for this department/project");
      numberMeta = { auditNumber: formatAuditNumber(config.auditNumber, sequence),
        auditNumberScope: newScope, auditNumberYear: undefined, auditNumberSequence: sequence,
        auditNumberHistory: [
          ...(originalMeta.auditNumberHistory ?? []),
          { scope: originalMeta.auditNumberScope, year: originalMeta.auditNumberYear ?? 0,
            sequence: originalMeta.auditNumberSequence ?? 0 },
        ] };
    }
    values.status = JSON.stringify({
      ...scheduleMeta({ status: values.status }),
      qaqcReference: originalMeta.qaqcReference ?? "", ...numberMeta,
      qaqcReferenceYear: originalMeta.qaqcReferenceYear, qaqcReferenceSequence: originalMeta.qaqcReferenceSequence,
    });
    return tx.update(auditSchedules).set({ ...values, id: undefined, updatedAt: new Date() })
      .where(eq(auditSchedules.id, current.id)).returning();
  });
  await auditLog(req, "update", "audit_schedule", row.id, before, row);
  res.json(await scheduleResponse(req, row));
}));
router.delete("/schedules/:id", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  await assertChildSchedule(before);
  if (before.workflowState === "approved") throw new HttpError(409, "Approved child audits cannot be deleted");
  if (!await scheduleInScope(req, before)) throw new HttpError(403, "You do not have access to this schedule");
  const [row] = await db.update(auditSchedules).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit schedule not found");
  await auditLog(req, "delete", "audit_schedule", row.id, row);
  res.status(204).end();
}));
router.post("/schedules/:id/submit", asyncHandler(async (req, res) => {
  const submission = body<AnyRow>(Api.SubmitAuditScheduleBody, req);
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  await assertChildSchedule(before);
  if (!["draft", "sent_back"].includes(before.workflowState)) throw new HttpError(409, "Schedule is not eligible for submission");
  if (!await scheduleInScope(req, before)) throw new HttpError(403, "You do not have access to this schedule");
  const roles = await approvalRoleChain(actor(req).organizationId);
  if (!roles.length) throw new HttpError(422, "No active sequential Audit approval roles are configured. Assign an Approval Level to an active role with Approve / reject authorization.");
  const unstaffed = (await Promise.all(roles.map(async role => (await roleUserIds(actor(req).organizationId, role.id)).length ? null : role.name))).filter(Boolean);
  if (unstaffed.length) throw new HttpError(422, `Approval role has no active users: ${unstaffed.join(", ")}`);
  const firstApprovers = await roleUserIds(actor(req).organizationId, roles[0].id);
  const row = await db.transaction(async tx => {
    const { config } = await lockScheduleNumbering(tx, actor(req).organizationId);
    const [current] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.id),
    )).for("update");
    if (!current || current.workflowState !== before.workflowState || current.status !== before.status)
      throw new HttpError(409, "Schedule changed while it was being submitted");
    const meta = scheduleMeta(current);
    const fromDate = meta.plannedStartDate;
    if (!meta.parentId && (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)))
      throw new HttpError(422, "A valid From Date is required for a QA/QC Reference");
    const [updated] = await tx.update(auditSchedules).set({
      workflowState: "submitted",
      status: JSON.stringify({
        ...meta,
        qaqcReference: meta.parentId ? meta.qaqcReference : formatQaqcReference(config.qaqcReference, fromDate!, 1),
        qaqcReferenceYear: meta.parentId ? meta.qaqcReferenceYear : Number(fromDate!.slice(0, 4)),
        qaqcReferenceSequence: meta.parentId ? meta.qaqcReferenceSequence : (meta.qaqcReferenceSequence ?? 1),
        approvalRoles: roles, approvalIndex: 0, reviewComments: null,
        submissionUserId: actor(req).id, approvalParticipantIds: [],
        submissionSubject: submission.subject.trim(), submissionMailBody: submission.mailBody.trim(),
      }),
      updatedAt: new Date(),
    }).where(eq(auditSchedules.id, current.id)).returning();
    if (updated) await queueAuditApprovalEmail(tx as unknown as typeof db, {
      organizationId: actor(req).organizationId, actorId: actor(req).id,
      entityType: "audit_schedule", entityId: updated.id, action: "submit",
      record: updated, templateValues: { next_approval_level: roles[0].level },
      recipientIds: firstApprovers, subject: submission.subject.trim(),
      text: `${submission.mailBody.trim()}\n\nAudit "${updated.title}" is awaiting your approval at level ${roles[0].level}. Open QMS360 QMS Audit to review it.`,
    });
    return updated;
  });
  if (!row) throw new HttpError(409, "Schedule changed while it was being submitted");
  const recipients = await roleUserIds(actor(req).organizationId, roles[0].id);
  await Promise.all(recipients.filter(id => id !== actor(req).id).map(userId => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId, type: "schedule_submitted",
    title: "Audit schedule awaiting review", body: `${row.title} has been submitted.`, entityType: "audit_schedule", entityId: row.id,
  })));
  await auditLog(req, "submit", "audit_schedule", row.id, before, row);
  res.json(await scheduleResponse(req, row));
}));
router.post("/schedules/:id/review", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.ReviewAuditScheduleBody, req);
  if (data.decision === "send_back" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when sending back");
  const [before] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, String(req.params.id))));
  await assertChildSchedule(before);
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted schedules may be reviewed");
  if (!await scheduleInScope(req, before)) throw new HttpError(403, "You do not have access to this schedule");
  const meta = scheduleMeta(before);
  const role = (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0];
  const allowed = role ? (await roleUserIds(actor(req).organizationId, role.id)).includes(actor(req).id) : false;
  if (!allowed) {
    const wasApprovalParticipant = (await Promise.all((meta.approvalRoles ?? []).map(candidate => roleUserIds(actor(req).organizationId, candidate.id))))
      .some(ids => ids.includes(actor(req).id));
    if (wasApprovalParticipant) throw new HttpError(409, "Schedule approval advanced before this review was applied");
  }
  if (!allowed) throw new HttpError(403, "Only the current approval role may review this schedule");
  const nextIndex = (meta.approvalIndex ?? 0) + 1;
  const complete = data.decision === "approve" && nextIndex >= (meta.approvalRoles ?? []).length;
  const participants = [...new Set([meta.submissionUserId ?? before.ownerId, ...(meta.approvalParticipantIds ?? []), actor(req).id].filter((id): id is string => Boolean(id)))];
  const detail = scheduleMeta(before);
  const finalEmailEnabled = complete && await auditApprovalEmailEnabled(db, {
    organizationId: actor(req).organizationId, actorId: actor(req).id, entityType: "audit_schedule",
  });
  const pdfAttachment = finalEmailEnabled ? await storeEmailPdfAttachment(
    actor(req).organizationId, before.id,
    await renderAuditScheduleApprovalPdf({
      title: before.title, subject: detail.submissionSubject ?? before.title, memo: detail.submissionMailBody ?? "",
      approvalDate: new Date().toISOString(),
      rows: [{
        title: before.title, fromDate: detail.plannedStartDate ?? "", toDate: detail.plannedEndDate ?? "",
        auditCategory: detail.auditCategory ?? "", departmentProject: detail.departmentProject ?? "",
        ownerName: detail.processProductOwner ?? "", auditNumber: detail.auditNumber ?? "",
        qaqcReference: detail.qaqcReference ?? "", scope: detail.qaqcScope ?? "",
        clauses: detail.qaqcClauses ?? "", remarks: detail.remarks ?? "",
      }],
    }),
  ) : undefined;
  let finalPdfQueued = false;
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(auditSchedules).set({
      workflowState: data.decision === "send_back" ? "sent_back" : complete ? "approved" : "submitted",
      status: JSON.stringify({
        ...meta, approvalIndex: data.decision === "send_back" ? 0 : nextIndex,
        reviewComments: data.comments ?? null,
        approvalParticipantIds: data.decision === "approve" ? participants.filter(id => id !== (meta.submissionUserId ?? before.ownerId)) : meta.approvalParticipantIds ?? [],
      }),
      updatedAt: new Date(),
    }).where(and(eq(auditSchedules.id, before.id), eq(auditSchedules.workflowState, before.workflowState), eq(auditSchedules.status, before.status))).returning();
    if (updated && data.decision === "approve") {
      const nextRole = (meta.approvalRoles ?? [])[nextIndex];
      const queuedEmail = await queueAuditApprovalEmail(tx as unknown as typeof db, {
        organizationId: actor(req).organizationId, actorId: actor(req).id,
        entityType: "audit_schedule", entityId: updated.id, action: complete ? "approved_final" : "approve",
        record: updated, templateValues: { approval_level: role?.name, next_approval_level: nextRole?.name },
        recipientIds: complete ? participants : await roleUserIds(actor(req).organizationId, nextRole.id),
        subject: complete ? `Approved: ${meta.submissionSubject ?? updated.title}` : meta.submissionSubject ?? `Approval requested: ${updated.title}`,
        text: complete
          ? `Audit "${updated.title}" has received final approval. The attached PDF begins with the submitted memo and includes the Gantt chart.`
          : `${meta.submissionMailBody ?? ""}\n\nAudit "${updated.title}" is awaiting your approval at the next level. Open QMS360 QMS Audit to review it.`,
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      });
      if (complete && queuedEmail.queued > 0) finalPdfQueued = true;
    }
    if (updated && data.decision === "send_back" && before.ownerId) {
      await queueAuditApprovalEmail(tx as unknown as typeof db, {
        organizationId: actor(req).organizationId, actorId: actor(req).id,
        entityType: "audit_schedule", entityId: updated.id, action: "send_back",
        record: updated, templateValues: { approval_level: role?.name, review_comments: data.comments.trim() },
        recipientIds: [before.ownerId],
        ccRecipientIds: auditScheduleSendBackCcIds(before.ownerId, meta.approvalParticipantIds ?? [], actor(req).id),
        subject: `Sent back: ${meta.submissionSubject ?? updated.title}`,
        text: `Audit "${updated.title}" was sent back for revision.\n\nReviewer comments: ${data.comments.trim()}\n\nOpen QMS360 QMS Audit to revise and resubmit it.`,
      });
    }
    return updated;
  }).catch(async error => {
    if (pdfAttachment) {
      try { await removeEmailPdfAttachment(actor(req).organizationId, pdfAttachment.objectPath); }
      catch (cleanupError) { req.log.error({ cleanupError }, "Failed to clean up unqueued approval PDF"); }
    }
    throw error;
  });
  if (pdfAttachment && !finalPdfQueued) {
    try { await removeEmailPdfAttachment(actor(req).organizationId, pdfAttachment.objectPath); }
    catch (cleanupError) { req.log.error({ cleanupError }, "Failed to clean up unsent approval PDF"); }
  }
  if (!row) throw new HttpError(409, "Schedule changed while it was being reviewed");
  if ((data.decision === "send_back" || complete) && before.ownerId) await notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: before.ownerId, type: "schedule_decision",
    title: `Audit schedule ${data.decision === "send_back" ? "sent back" : "approved"}`,
    body: data.comments || row.title, entityType: "audit_schedule", entityId: row.id,
  });
  if (data.decision === "approve" && !complete) {
    const next = (meta.approvalRoles ?? [])[nextIndex];
    const recipients = await roleUserIds(actor(req).organizationId, next.id);
    await Promise.all(recipients.map(userId => notify(db, "audit", {
      organizationId: actor(req).organizationId, userId, type: "schedule_submitted",
      title: "Audit schedule awaiting review", body: row.title, entityType: "audit_schedule", entityId: row.id,
    })));
  }
  await auditLog(req, data.decision, "audit_schedule", row.id, before, row);
  res.json(await scheduleResponse(req, row));
}));

const PLAN_LANGUAGE = "Verbal: English\nWriting: English";
type PlanActivity = DatedActivity & { id: string; section: string; remarks: string; auditeeId: string; roleIds?: string[]; auditeeIds?: string[] };
type PlanMeta = {
  objectives?: string | null; leadAuditorId?: string; processOwnerIds?: string[]; feasibilityNotes?: string | null;
  auditFeasible?: boolean; auditTitle?: string; auditeeId?: string; auditeeRoleIds?: string[]; qaqcScope?: string; auditTypes?: string[];
  auditLanguage?: string; qaqcReference?: string; description?: string | null; startDateTime?: string;
  endDateTime?: string; openingMeetingDateTime?: string; closingMeetingDateTime?: string; activitySection?: string;
  activityRemarks?: string; activityAuditeeId?: string; activityDateTime?: string; auditPlanCirculation?: string;
  activities?: PlanActivity[];
  circulationRoleIds?: string[];
};
const planMeta = (row: AnyRow): PlanMeta => parseJson(row.status, {});
function assertPlanDates(data: AnyRow, schedule: AnyRow, activities: DatedActivity[] = data.activities ?? []) {
  const errors = auditPlanDateErrors(data, scheduleMeta(schedule), activities);
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors).join("; "));
}
async function assertLinkedPlanDates(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], req: Request, schedule: AnyRow, data: AnyRow) {
  const old = scheduleMeta(schedule);
  const bounds = { plannedStartDate: dateOnly(data.plannedStartDate), plannedEndDate: dateOnly(data.plannedEndDate) };
  if (old.plannedStartDate === bounds.plannedStartDate && old.plannedEndDate === bounds.plannedEndDate) return;
  const plans = await tx.select().from(auditPlans).where(and(
    active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, schedule.id),
  ));
  for (const plan of plans) {
    const dto = planDto(plan);
    const errors = auditPlanDateErrors(dto, bounds, dto.activities);
    if (Object.keys(errors).length) throw new HttpError(409,
      `Audit date range cannot change because linked Audit Plan "${dto.auditTitle}" would be invalid: ${Object.values(errors).join("; ")}`);
  }
}
const planDto = (row: AnyRow) => {
  const meta = planMeta(row);
   const fallbackDateTime = "";
  const auditTypes = meta.auditTypes ?? parseJson(row.criteria, row.criteria ? [row.criteria] : []);
  return {
    id: row.id, scheduleId: row.auditScheduleId!, auditFeasible: meta.auditFeasible ?? true,
    auditTitle: meta.auditTitle ?? row.scope ?? "Audit Plan", leadAuditorId: meta.leadAuditorId ?? row.teamMemberIds[0] ?? "",
    teamMemberIds: row.teamMemberIds, auditeeId: meta.auditeeId ?? meta.processOwnerIds?.[0] ?? "",
    auditeeRoleIds: meta.auditeeRoleIds ?? [],
    circulationRoleIds: meta.circulationRoleIds,
    qaqcScope: meta.qaqcScope ?? row.scope ?? "", auditTypes, auditLanguage: meta.auditLanguage ?? PLAN_LANGUAGE,
    qaqcReference: meta.qaqcReference ?? "", description: meta.description ?? meta.objectives ?? null,
    startDateTime: meta.startDateTime ?? fallbackDateTime, endDateTime: meta.endDateTime ?? fallbackDateTime,
    openingMeetingDateTime: meta.openingMeetingDateTime ?? fallbackDateTime, closingMeetingDateTime: meta.closingMeetingDateTime ?? fallbackDateTime,
    activitySection: meta.activitySection ?? row.location ?? "General Requirement",
    activityRemarks: meta.activityRemarks ?? meta.feasibilityNotes ?? "", activityAuditeeId: meta.activityAuditeeId ?? meta.auditeeId ?? meta.processOwnerIds?.[0] ?? "",
    activities: datedActivities(meta.activities?.length ? meta.activities : [{
      id: `legacy-${row.id}`, section: meta.activitySection ?? row.location ?? "General Requirement",
      remarks: meta.activityRemarks ?? meta.feasibilityNotes ?? "",
      auditeeId: meta.activityAuditeeId ?? meta.auditeeId ?? meta.processOwnerIds?.[0] ?? "",
    }], meta.activityDateTime),
    activityDateTime: meta.activityDateTime ?? "", auditPlanCirculation: meta.auditPlanCirculation ?? "",
    scope: row.scope ?? "", objectives: meta.objectives ?? null,
    criteria: auditTypes, auditDate: row.auditDate ? new Date(row.auditDate) : new Date(0),
    location: row.location ?? "",
    processOwnerIds: meta.processOwnerIds ?? [], feasibilityNotes: meta.feasibilityNotes ?? null,
    status: ({ draft: "Draft", shared: "Shared", active: "Active", completed: "Completed" } as AnyRow)[row.workflowState] ?? "Draft",
  };
};
const planValues = (data: AnyRow) => ({
  id: data.id, auditScheduleId: data.scheduleId, scope: data.qaqcScope ?? data.scope,
  criteria: JSON.stringify(data.auditTypes ?? data.criteria ?? []),
   auditDate: plannedDate(data.startDateTime ?? data.auditDate)!, location: data.location,
  teamMemberIds: data.teamMemberIds,
  workflowState: String(data.status).toLowerCase(),
  status: JSON.stringify({
    objectives: data.objectives ?? null, leadAuditorId: data.leadAuditorId, processOwnerIds: data.processOwnerIds ?? [],
    feasibilityNotes: data.feasibilityNotes ?? null, auditFeasible: data.auditFeasible, auditTitle: data.auditTitle,
    auditeeId: data.auditeeId, auditeeRoleIds: data.auditeeRoleIds ?? [], qaqcScope: data.qaqcScope, auditTypes: data.auditTypes, auditLanguage: data.auditLanguage,
    qaqcReference: data.qaqcReference, description: data.description ?? null, startDateTime: data.startDateTime,
    endDateTime: data.endDateTime, openingMeetingDateTime: data.openingMeetingDateTime,
    closingMeetingDateTime: data.closingMeetingDateTime, activitySection: data.activitySection,
    activityRemarks: data.activityRemarks, activityAuditeeId: data.activityAuditeeId,
    activities: data.activities,
    activityDateTime: data.activities?.[0]?.plannedStartDateTime, auditPlanCirculation: data.auditPlanCirculation,
    circulationRoleIds: data.circulationRoleIds,
  }),
});
async function auditPlanUsers(organizationId: string) {
  const rows = await db.select({ id: users.id, fullName: users.fullName, designation: users.designation }).from(users)
    .innerJoin(applicationAccess, and(
      eq(applicationAccess.username, users.username), eq(applicationAccess.organizationId, organizationId),
      eq(applicationAccess.canOpenAudit, true), isNull(applicationAccess.deletedAt),
    ))
    .where(and(eq(users.organizationId, organizationId), eq(users.accessStatus, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.fullName));
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}
async function activityRoleOptions(organizationId: string) {
  return db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name }).from(auditWorkspaceRoles)
    .where(and(active(auditWorkspaceRoles, organizationId), eq(auditWorkspaceRoles.status, "active")))
    .orderBy(asc(auditWorkspaceRoles.name));
}
async function validateActivityRoleAssignments(organizationId: string, assignments: ActivityRoleAssignment[]) {
  if (!assignments.length) return [];
  const [roles, people] = await Promise.all([activityRoleOptions(organizationId), auditPlanUsers(organizationId)]);
  return normalizeActivityAssignments(assignments, new Set(roles.map(role => role.id)), new Set(people.map(user => user.id)));
}
async function normalizeAuditPlan(req: Request, data: AnyRow, schedule: AnyRow) {
  const scheduleData = scheduleDto(schedule);
  const dateErrors = validateAuditPlanDates(Object.fromEntries(auditPlanDateFields.map(({ key }) =>
    [key, typeof req.body?.[key] === "string" ? req.body[key] : data[key]])),
  scheduleMeta(schedule).plannedStartDate, scheduleMeta(schedule).plannedEndDate);
  if (Object.keys(dateErrors).length) throw new HttpError(422, Object.values(dateErrors).join("\n"));
  const activities: PlanActivity[] = Array.isArray(data.activities) && data.activities.length
    ? data.activities
    : [{ id: `legacy-${data.id}`, section: data.activitySection, remarks: data.activityRemarks, auditeeId: data.activityAuditeeId }];
  for (const activity of activities) {
    if (activity.auditeeIds !== undefined) {
      activity.auditeeIds = [...new Set(activity.auditeeIds)];
      activity.auditeeId = activity.auditeeIds[0] ?? "";
    }
    if (activity.roleIds !== undefined) activity.roleIds = [...new Set(activity.roleIds)];
  }
  const activityRoles = new Set((activities.some(activity => activity.roleIds?.length)
    ? await activityRoleOptions(actor(req).organizationId) : []).map(role => role.id));
  if (activities.some(activity => activity.roleIds?.some(id => !activityRoles.has(id)))) {
    throw new HttpError(422, "Select active QMS Audit roles for each activity");
  }
  const required = [
    "auditTitle", "leadAuditorId", "qaqcScope", "auditLanguage", "qaqcReference",
    "startDateTime", "endDateTime", "openingMeetingDateTime", "closingMeetingDateTime",
    "auditPlanCirculation",
  ];
  const auditeeRoleIds = [...new Set((data.auditeeRoleIds ?? []).filter(Boolean))] as string[];
  if (typeof data.auditFeasible !== "boolean" || required.some((key) => !String(data[key] ?? "").trim()) || !data.teamMemberIds?.length || !data.auditTypes?.length || !auditeeRoleIds.length) {
    throw new HttpError(422, "Complete all mandatory Audit Plan fields");
  }
  if (activities.some(activity => !activity.id || !activity.section?.trim() || !activity.remarks?.trim() || !activity.auditeeId)) {
    throw new HttpError(422, "Complete Activities / Section, Remarks and Auditee for every activity row");
  }
  const normalizedActivitySections = activities.map(activity => activity.section.trim().toLocaleLowerCase());
  if (new Set(normalizedActivitySections).size !== normalizedActivitySections.length) {
    throw new HttpError(422, "Each Activities / Section value can be selected only once");
  }
  await Promise.all(activities.map(activity =>
    assertLovValue(db, actor(req).organizationId, "activities", activity.section)));
  assertPlanDates(data, schedule, activities);
  const options = await auditPlanUsers(actor(req).organizationId);
  const usersById = new Map(options.map((option) => [option.id, option]));
  const participantIds = [...new Set([data.leadAuditorId, ...data.teamMemberIds, ...activities.flatMap(activity => activity.auditeeIds ?? [activity.auditeeId])])];
  if (participantIds.some((id) => !usersById.has(id))) throw new HttpError(422, "Select active QMS Audit users for all Master fields");
  const parentId = scheduleMeta(schedule).parentId;
  if (parentId) {
    const [parent] = await db.select({ status: auditSchedules.status }).from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, parentId),
    )).limit(1);
    if (!parent || !isProgramme(parent)) throw new HttpError(422, "The parent Audit Schedule is unavailable");
    const selectedLeads = scheduleMeta(parent).teamLeadIds;
    if (selectedLeads && !selectedLeads.includes(data.leadAuditorId)) {
      throw new HttpError(422, "Lead / Internal Auditor must be one of the Audit Team Leads selected when the schedule was created");
    }
  }
  const selectedRoles = await db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name })
    .from(auditWorkspaceRoles)
    .where(and(active(auditWorkspaceRoles, actor(req).organizationId), inArray(auditWorkspaceRoles.id, auditeeRoleIds)));
  if (selectedRoles.length !== auditeeRoleIds.length) throw new HttpError(422, "Select active QMS Audit roles for Auditee");
  const auditeeUserIds = [...new Set((await Promise.all(auditeeRoleIds.map(roleId => roleUserIds(actor(req).organizationId, roleId)))).flat())];
  const circulationRoleIds = data.circulationRoleIds === undefined
    ? undefined : [...new Set(data.circulationRoleIds)] as string[];
  let circulationRoleNames: string[] | undefined;
  if (circulationRoleIds !== undefined) {
    if (!circulationRoleIds.length || circulationRoleIds.some(id => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) {
      throw new HttpError(422, "Select at least one active QMS Audit workspace role for Audit Plan Circulation");
    }
    const roles = await db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name })
      .from(auditWorkspaceRoles).where(and(
        active(auditWorkspaceRoles, actor(req).organizationId),
        inArray(auditWorkspaceRoles.id, circulationRoleIds),
        eq(auditWorkspaceRoles.status, "active"),
      ));
    if (roles.length !== circulationRoleIds.length) {
      throw new HttpError(422, "Select active QMS Audit workspace roles for Audit Plan Circulation");
    }
    const byId = new Map(roles.map(role => [role.id, role.name]));
    circulationRoleNames = circulationRoleIds.map(id => byId.get(id)!);
  }
  const circulationIds = [...new Set([data.leadAuditorId, ...data.teamMemberIds])];
  return {
    ...data,
    auditeeId: activities[0].auditeeId,
    auditeeRoleIds,
    circulationRoleIds,
    activities: activities.map(({ legacyDateTimeDerived: _derived, ...activity }) => activity),
    activitySection: activities[0].section,
    activityRemarks: activities[0].remarks,
    activityAuditeeId: activities[0].auditeeId,
    auditTitle: scheduleData.title,
    qaqcScope: scheduleData.qaqcScope,
    auditTypes: scheduleData.auditTypes,
    auditLanguage: PLAN_LANGUAGE,
    qaqcReference: scheduleData.qaqcReference,
    auditPlanCirculation: circulationRoleNames?.join(", ") ?? [
      ...circulationIds.map((id) => usersById.get(id)!.fullName),
      ...selectedRoles.map(role => role.name),
    ].join(", "),
    processOwnerIds: auditeeUserIds,
    location: scheduleData.location,
  };
}
router.get("/schedule-activity-options", asyncHandler(async (req, res) => {
  const capabilities = await activeAuditCapabilities(req);
  if (!capabilities.administrator && !capabilities.keys.some(key =>
    auditModuleReadMatches(key, "schedules") || auditModulePermissionMatches(key, "schedules", "create_edit"))) {
    throw new HttpError(403, "Audit Schedule access is required to select activity roles and users");
  }
  const organizationId = actor(req).organizationId;
  const [people, roles] = await Promise.all([auditPlanUsers(organizationId), activityRoleOptions(organizationId)]);
  res.json(Api.GetAuditScheduleActivityOptionsResponse.parse({ users: people, roles }));
}));
router.get("/plan-options", requirePermission("audit", "plans", "select"), asyncHandler(async (req, res) => {
  res.json({ users: await auditPlanUsers(actor(req).organizationId) });
}));
router.get("/plan-notification-roles", requirePermission("audit", "plans", "select"), asyncHandler(async (req, res) => {
  const rows = await db.select().from(auditWorkspaceRoles)
    .where(active(auditWorkspaceRoles, actor(req).organizationId))
    .orderBy(asc(auditWorkspaceRoles.name));
  res.json(await Promise.all(rows.map(auditRoleResponse)));
}));
router.post("/schedules/:id/feasibility", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.RecordAuditScheduleFeasibilityBody, req);
  const feedback = String(data.feedback ?? "").trim();
  if (!feedback) throw new HttpError(422, "Remarks / Feedback is required");
  const fromDate = data.decision === "reschedule" ? dateOnly(data.fromDate) : null;
  const toDate = data.decision === "reschedule" ? dateOnly(data.toDate) : null;
  if (data.decision === "reschedule") {
    if (!fromDate || !toDate) throw new HttpError(422, "From Date and To Date are required to reschedule an audit");
    assertScheduleDates({ plannedStartDate: fromDate, plannedEndDate: toDate });
  }
  const scheduleId = String(req.params.id);
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor(req).organizationId}), hashtext(${scheduleId}))`);
    const [schedule] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, scheduleId),
    )).for("update");
    await assertChildSchedule(schedule);
    if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
    const [schedulePlan] = await tx.select({ id: auditPlans.id }).from(auditPlans).where(and(
      active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, scheduleId),
    )).limit(1);
    if (schedulePlan) throw new HttpError(409, "An Audit Plan already exists for this Audit Schedule");
    const meta = scheduleMeta(schedule);
    if (data.decision === "reschedule") {
      await assertScheduleParentDates(actor(req).organizationId, meta.parentId, { plannedStartDate: fromDate, plannedEndDate: toDate });
    }
    const [row] = await tx.update(auditSchedules).set({
      status: JSON.stringify({
        ...meta,
        ...(data.decision === "reschedule" ? { plannedStartDate: fromDate, plannedEndDate: toDate } : {}),
        feasibilityDecision: data.decision,
        feasibilityFeedback: feedback,
        feasibilityRecordedAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    }).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, scheduleId))).returning();
    return row;
  });
  await auditLog(req, data.decision === "cancelled" ? "cancel_audit" : "reschedule_audit", "audit_schedule", updated.id, undefined, updated);
  res.json(await scheduleResponse(req, updated, false));
}));
router.get("/plans", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(auditPlans, actor(req).organizationId), scope.unrestricted ? undefined :
    or(inArray(auditPlans.projectId, scope.projectIds), req.dronaProjectIds !== undefined
      ? scope.processAuditsAllowed ? and(isNull(auditPlans.projectId), await processPlanCondition(req, auditPlans.id)) : undefined
      : isNull(auditPlans.projectId)));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditPlans).where(where).orderBy(desc(auditPlans.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditPlans).where(where),
  ]);
  res.json(paginated(rows.map(planDto), Number(count), page, limit));
}));
router.post("/plans", asyncHandler(async (req, res) => {
  let data = body<AnyRow>(Api.CreateAuditPlanBody, req);
  await assertFieldAccess(req, "audit", "plan", { mode: "create" });
  await assertFieldControls(req, "audit", "plan", { mode: "create" });
  const [existing] = await db.select().from(auditPlans).where(and(
    active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.id),
  ));
  if (existing) {
    const [schedule] = await db.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, existing.auditScheduleId!),
    ));
    await assertChildSchedule(schedule);
    if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
    assertPlanDates(data, schedule);
    assertPlanDates(planDto(existing), schedule);
    if (!auditPlanReplayMatches(data, planDto(existing))) {
      throw new HttpError(409, "Audit Plan already saved with different planned data. Your correction was not saved. Review the saved plan and apply the correction to its draft.");
    }
    res.status(200).json(planDto(existing));
    return;
  }
  const [schedule] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, data.scheduleId)));
  await assertChildSchedule(schedule);
  if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
  const row = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor(req).organizationId}), hashtext(${schedule.id}))`);
    const [lockedSchedule] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, schedule.id),
    )).for("update");
    await assertChildSchedule(lockedSchedule);
    if (!await scheduleInScope(req, lockedSchedule)) throw new HttpError(403, "You do not have access to this schedule");
    const parentId = scheduleMeta(lockedSchedule).parentId;
    if (!parentId) {
      throw new HttpError(422, "Select an audit belonging to a New Schedule to create an Audit Plan");
    }
    if (parentId) {
      const [parent] = await tx.select().from(auditSchedules).where(and(
        active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, parentId),
      )).for("update");
      if (!parent || !isProgramme(parent)) {
        throw new HttpError(422, "The audit must belong to an active Audit Schedule created through New Schedule");
      }
      if (parent?.workflowState === "submitted") {
        throw new HttpError(409, "Audit Plans cannot be created for audits in a submitted programme");
      }
    }
    if (scheduleMeta(lockedSchedule).feasibilityDecision === "cancelled") {
      throw new HttpError(409, "This audit was cancelled and cannot be planned");
    }
    const [schedulePlan] = await tx.select({ id: auditPlans.id }).from(auditPlans).where(and(
      active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, schedule.id),
    )).limit(1);
    if (schedulePlan) throw new HttpError(409, "An Audit Plan already exists for this Audit Schedule");
    data = await normalizeAuditPlan(req, data, lockedSchedule);
    const [created] = await tx.insert(auditPlans).values({
      organizationId: actor(req).organizationId, projectId: lockedSchedule.projectId, ...planValues(data),
    }).returning();
    return created;
  });
  await auditLog(req, "create", "audit_plan", row.id, undefined, row); res.status(201).json(planDto(row));
}));
router.get("/plans/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit plan not found"); res.json(planDto(row));
}));
router.get("/plans/:id/report", asyncHandler(async (req, res) => {
  const { id } = Api.ExportAuditPlanReportParams.parse(req.params);
  const timeZone = req.get("X-Report-Time-Zone") || "UTC";
  try { new Intl.DateTimeFormat("en-GB", { timeZone }); }
  catch { throw new HttpError(400, "Invalid report timezone"); }
  const orgId = actor(req).organizationId;
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, orgId), eq(auditPlans.id, id)));
  if (!plan) throw new HttpError(404, "Audit plan not found");
  const meta = planMeta(plan);
  const [schedule] = plan.auditScheduleId ? await db.select().from(auditSchedules)
    .where(and(active(auditSchedules, orgId), eq(auditSchedules.id, plan.auditScheduleId))) : [];
  const [project] = plan.projectId ? await db.select().from(projects)
    .where(and(active(projects, orgId), eq(projects.id, plan.projectId))) : [];
  const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  const userIds = [...new Set([meta.leadAuditorId, ...plan.teamMemberIds, meta.auditeeId,
    ...(meta.processOwnerIds ?? []), meta.activityAuditeeId, ...(meta.activities ?? []).flatMap(row => row.auditeeIds ?? [row.auditeeId])].filter(uuid))];
  const roleIds = (meta.auditeeRoleIds ?? []).filter(uuid);
  const [people, roles] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.fullName }).from(users).where(and(active(users, orgId), inArray(users.id, userIds))) : [],
    roleIds.length ? db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name }).from(auditWorkspaceRoles)
      .where(and(active(auditWorkspaceRoles, orgId), inArray(auditWorkspaceRoles.id, roleIds))) : [],
  ]);
  const data = auditPlanReportData(plan, meta, schedule ? scheduleMeta(schedule) : {}, project,
    new Map(people.map(p => [p.id, p.name])), new Map(roles.map(r => [r.id, r.name])), timeZone);
  const bytes = await renderAuditPlanPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="audit-plan-${plan.id}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(Buffer.from(bytes));
}));
router.put("/plans/:id", asyncHandler(async (req, res) => {
  let data = body<AnyRow>(Api.UpdateAuditPlanBody, req);
  const [before] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit plan not found");
  if (before.workflowState !== "draft") throw new HttpError(409, "Only draft plans can be edited");
  if (data.circulationRoleIds === undefined && planMeta(before).circulationRoleIds !== undefined) {
    data = { ...data, circulationRoleIds: planMeta(before).circulationRoleIds };
  }
  const [schedule] = await db.select().from(auditSchedules).where(and(active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, data.scheduleId)));
  await assertChildSchedule(schedule);
  if (!await scheduleInScope(req, schedule)) throw new HttpError(403, "You do not have access to this schedule");
  const linkedAudits = await db.select({ projectId: audits.projectId }).from(audits).where(and(
    active(audits, actor(req).organizationId), eq(audits.auditPlanId, before.id),
  ));
  if (linkedAudits.some((audit) => audit.projectId !== schedule.projectId)) {
    throw new HttpError(409, "This plan cannot move to another project while audits are linked to it");
  }
  await assertFieldAccess(req, "audit", "plan", { mode: "update", current: planDto(before) });
  await assertFieldControls(req, "audit", "plan", { mode: "update", current: planDto(before) });
  const row = await db.transaction(async tx => {
    const [lockedSchedule] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, schedule.id),
    )).for("update");
    await assertChildSchedule(lockedSchedule);
    if (!await scheduleInScope(req, lockedSchedule)) throw new HttpError(403, "You do not have access to this schedule");
    const [occupied] = await tx.select({ id: auditPlans.id }).from(auditPlans).where(and(
      active(auditPlans, actor(req).organizationId), eq(auditPlans.auditScheduleId, schedule.id),
      sql`${auditPlans.id} <> ${before.id}`,
    ));
    if (occupied) throw new HttpError(409, "An Audit Plan already exists for this Audit Schedule");
    data = await normalizeAuditPlan(req, data, lockedSchedule);
    const [updated] = await tx.update(auditPlans).set({ ...planValues(data), id: undefined, projectId: lockedSchedule.projectId, updatedAt: new Date() })
      .where(and(eq(auditPlans.id, before.id), eq(auditPlans.workflowState, "draft"), eq(auditPlans.status, before.status))).returning();
    if (!updated) throw new HttpError(409, "Audit Plan changed while it was being edited");
    return updated;
  });
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
  const row = await db.transaction(async tx => {
    const [schedule] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, before.auditScheduleId!),
    )).for("update");
    await assertChildSchedule(schedule);
    assertPlanDates(planDto(before), schedule);
    const [updated] = await tx.update(auditPlans).set({ workflowState: "shared", updatedAt: new Date() })
      .where(and(eq(auditPlans.id, before.id), eq(auditPlans.workflowState, "draft"), eq(auditPlans.status, before.status))).returning();
    if (!updated) throw new HttpError(409, "Audit Plan changed while it was being shared");
    return updated;
  });
  await Promise.all((planMeta(row).processOwnerIds ?? []).map((id) => notify(db, "audit", {
    organizationId: actor(req).organizationId, userId: id, type: "plan_shared", title: "Audit plan shared",
    body: row.scope ?? "An audit plan has been shared with you.", entityType: "audit_plan", entityId: row.id,
  })));
  await auditLog(req, "share", "audit_plan", row.id, before, row); res.status(202).json(planDto(row));
}));

type AuditMeta = { title?: string; openingMeeting?: AnyRow; closingMeeting?: AnyRow; startedAt?: string | null; closedAt?: string | null; additionalDocuments?: AnyRow; reportDetails?: AuditReportDetailsData; completedById?: string };
const auditMeta = (row: AnyRow): AuditMeta => parseJson(row.status, {});
const legacyDocumentRemarks = (rows: unknown): string => Array.isArray(rows)
  ? rows.filter((entry: AnyRow) => typeof entry.remarks === "string" && entry.remarks.trim())
    .map((entry: AnyRow) => `${entry.label}: ${entry.remarks}`).join("\n")
  : "";
const documentRemarks = (documents: AnyRow | undefined, section: "designStatus" | "procurementStatus"): string => {
  const key = section === "designStatus" ? "designRemarks" : "procurementRemarks";
  return typeof documents?.[key] === "string" ? documents[key] : legacyDocumentRemarks(documents?.[section]);
};
const auditDto = (row: AnyRow, canEdit = false) => {
  const meta = auditMeta(row);
  return {
    id: row.id, planId: row.auditPlanId!, projectId: row.projectId!, title: meta.title ?? row.referenceNumber,
    canEdit,
    status: auditIsComplete(row.workflowState) ? "Complete" : ({ planned: "Planned", "in progress": "In Progress", "report draft": "Report Draft", "car follow-up": "CAR Follow-up", scheduled: "Planned" } as AnyRow)[row.workflowState.toLowerCase()] ?? "Planned",
    reportDetails: meta.reportDetails ?? { values: {}, rows: {} },
    openingMeeting: meta.openingMeeting ? { ...meta.openingMeeting, heldAt: new Date(meta.openingMeeting.heldAt) } : undefined,
    closingMeeting: meta.closingMeeting ? { ...meta.closingMeeting, heldAt: new Date(meta.closingMeeting.heldAt) } : undefined,
    checklist: Array.isArray(row.checklistState) ? row.checklistState : [],
    additionalDocuments: {
      organizationChartId: meta.additionalDocuments?.organizationChartId ?? null,
      organizationChartFileName: meta.additionalDocuments?.organizationChartFileName ?? null,
      designStatus: meta.additionalDocuments?.designStatus ?? [],
      designRemarks: documentRemarks(meta.additionalDocuments, "designStatus"),
      procurementStatus: meta.additionalDocuments?.procurementStatus ?? [],
      procurementRemarks: documentRemarks(meta.additionalDocuments, "procurementStatus"),
      goodPractices: Array.isArray(meta.additionalDocuments?.goodPractices) ? meta.additionalDocuments.goodPractices : [],
    },
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
router.post("/plans/:id/send-for-audit", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.SendAuditPlanForExecutionBody, req);
  const planId = String(req.params.id);
  const organizationId = actor(req).organizationId;
  const roleIds = [...new Set(data.roleIds as string[])];
  const selectedRoles = await db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name })
    .from(auditWorkspaceRoles)
    .where(and(active(auditWorkspaceRoles, organizationId), inArray(auditWorkspaceRoles.id, roleIds)));
  if (selectedRoles.length !== roleIds.length) throw new HttpError(400, "One or more selected roles are not available");
  const informedRoleIds = selectedRoles.map(role => role.id);
  const informedRoleNames = selectedRoles.map(role => role.name);
  const [plan] = await db.select().from(auditPlans).where(and(
    active(auditPlans, organizationId), eq(auditPlans.id, planId),
  ));
  if (!plan) throw new HttpError(404, "Audit plan not found");
  await assertAuditProject(req, plan.projectId);
  await assertFieldAccess(req, "audit", "audit-execution", { mode: "create" });

  let created = false;
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${planId}))`);
    const [schedule] = await tx.select().from(auditSchedules).where(and(
      active(auditSchedules, organizationId), eq(auditSchedules.id, plan.auditScheduleId!),
    )).for("update");
    const [lockedPlan] = await tx.select().from(auditPlans).where(and(
      active(auditPlans, organizationId), eq(auditPlans.id, planId),
    )).for("update");
    if (!lockedPlan) throw new HttpError(404, "Audit plan not found");

    const [existing] = await tx.select().from(audits).where(and(
      active(audits, organizationId), eq(audits.auditPlanId, planId),
    )).orderBy(desc(audits.updatedAt)).limit(1);
    const workflowState = lockedPlan.workflowState.toLowerCase();
    if (existing) {
      if (["draft", "ready"].includes(workflowState)) {
        await tx.update(auditPlans).set({
          workflowState: "shared",
          status: JSON.stringify({ ...planMeta(lockedPlan), informedRoleIds, informedRoleNames }),
          updatedAt: new Date(),
        }).where(eq(auditPlans.id, lockedPlan.id));
        const [refreshed] = await tx.update(audits).set({ updatedAt: new Date() }).where(eq(audits.id, existing.id)).returning();
        return refreshed;
      }
      return existing;
    }
    if (!informedRoleIds.length) throw new HttpError(400, "Select at least one role to inform");
    await assertChildSchedule(schedule);
    if (lockedPlan.auditScheduleId !== schedule.id) throw new HttpError(409, "Audit Plan changed while it was being sent. Retry.");
    assertPlanDates(planDto(lockedPlan), schedule);

    if (!["draft", "ready", "shared"].includes(workflowState)) {
      throw new HttpError(409, "Only draft or shared plans can be sent for audit");
    }

    const meta = planMeta(lockedPlan);
    const usePattern = await hasNumberingPattern(organizationId, "audit");
    let audit: typeof audits.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !audit; attempt++) {
      const referenceNumber = usePattern
        ? await allocateReferenceNumber(organizationId, "audit")
        : meta.auditTitle ?? lockedPlan.scope ?? `Audit-${lockedPlan.id.slice(0, 8)}`;
      try {
        [audit] = await tx.insert(audits).values({
          organizationId,
          auditPlanId: lockedPlan.id,
          projectId: lockedPlan.projectId,
          referenceNumber,
          referenceGenerated: usePattern,
          workflowState: "planned",
          checklistState: {},
          status: JSON.stringify({
            title: meta.auditTitle ?? lockedPlan.scope ?? referenceNumber,
            startedAt: null,
            closedAt: null,
            informedRoleIds,
            informedRoleNames,
          }),
        }).returning();
      } catch (error: any) {
        if (error?.code === "23505" && usePattern && String(error?.message ?? "").includes("audit_reference_active_idx")) continue;
        if (error?.code === "23505") throw new HttpError(409, "An active audit with this title already exists");
        throw error;
      }
    }
    if (!audit) throw new HttpError(409, "Unable to allocate a unique audit reference number");
    if (["draft", "ready"].includes(workflowState)) {
      await tx.update(auditPlans).set({
        workflowState: "shared",
        status: JSON.stringify({ ...meta, informedRoleIds, informedRoleNames }),
        updatedAt: new Date(),
      }).where(eq(auditPlans.id, lockedPlan.id));
    }
    created = true;
    return audit;
  });

  if (created) {
    const recipientIds = [...new Set((await Promise.all(informedRoleIds.map(roleId => roleUserIds(organizationId, roleId)))).flat())];
    await Promise.all(recipientIds.map((id) => notify(db, "audit", {
      organizationId, userId: id, type: "audit_sent", title: "Audit sent for execution",
      body: `${planMeta(plan).auditTitle ?? plan.scope ?? "An Audit Plan"} has been sent to Audit Execution.`, entityType: "audit", entityId: result.id,
    })));
    await auditLog(req, "send_for_audit", "audit_plan", plan.id, plan, result);
  }
  res.json(auditDto(result));
}));
router.get("/audits", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(audits, actor(req).organizationId), await auditProjectCondition(req, scope));
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(audits).where(where).orderBy(desc(audits.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(audits).where(where),
  ]);
  const editScope = await getAuthorizedProjectScope(req, "audit", { module: "audits", action: "full" });
  res.json(paginated(rows.map(row => auditDto(row, editScope.unrestricted || (row.projectId ? editScope.projectIds.includes(row.projectId) : editScope.projectIds.length > 0 || editScope.processAuditsAllowed === true))), Number(count), page, limit));
}));
router.post("/audits", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditBody, req);
  if (auditIsComplete(data.status)) throw new HttpError(422, "Create the audit first, then use Mark Complete.");
  await assertFieldAccess(req, "audit", "audit-execution", { mode: "create" });
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.planId)));
  if (!plan) throw new HttpError(422, "Audit plan does not belong to this organization");
  await assertAuditProject(req, plan.projectId);
  if (data.projectId && plan.projectId && data.projectId !== plan.projectId) {
    throw new HttpError(422, "Audit project must match the selected plan");
  }
  if (plan.auditScheduleId) {
    const [schedule] = await db.select({ projectId: auditSchedules.projectId }).from(auditSchedules).where(and(
      active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, plan.auditScheduleId),
    )).limit(1);
     await assertChildSchedule(schedule);
    if (data.projectId && schedule.projectId && data.projectId !== schedule.projectId) {
      throw new HttpError(422, "Audit project must match the plan schedule");
    }
  }
  // When an audit numbering pattern is configured, the reference number is
  // generated from it; otherwise the manually supplied title remains the reference.
  const usePattern = await hasNumberingPattern(actor(req).organizationId, "audit");
  const values: Omit<typeof audits.$inferInsert, "organizationId"> = auditValues(data);
  let row: typeof audits.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    if (usePattern) {
      values.referenceNumber = await allocateReferenceNumber(actor(req).organizationId, "audit");
      values.referenceGenerated = true;
    }
    try {
      [row] = await db.insert(audits).values({ organizationId: actor(req).organizationId, ...values }).returning();
    } catch (error: any) {
      if (error?.code === "23505" && usePattern && String(error?.message ?? "").includes("audit_reference_active_idx")) continue;
      if (error?.code === "23505") throw new HttpError(409, "An active audit with this title already exists");
      throw error;
    }
  }
  if (!row) throw new HttpError(409, "Unable to allocate a unique audit reference number");
  await auditLog(req, "create", "audit", row.id, undefined, row); res.status(201).json(auditDto(row));
}));
router.get("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!row) throw new HttpError(404, "Audit not found");
  const editScope = await getAuthorizedProjectScope(req, "audit", { module: "audits", action: "full" });
  res.json(auditDto(row, editScope.unrestricted || (row.projectId ? editScope.projectIds.includes(row.projectId) : editScope.projectIds.length > 0 || editScope.processAuditsAllowed === true)));
}));
router.post("/audits/:id/complete", asyncHandler(async (req, res) => {
  const result = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, actor(req).organizationId),
      eq(audits.id, String(req.params.id)))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    if (auditIsComplete(before.workflowState)) return { before, row: before, changed: false };
    await assertFieldAccess(req, "audit", "audit-execution", {
      mode: "update", current: auditDto(before), body: { status: "Complete" },
    });
    await assertFieldControls(req, "audit", "audit-execution", { mode: "update", current: auditDto(before), body: { status: "Complete" } });
    const [row] = await tx.update(audits).set({
      workflowState: "closed", updatedAt: new Date(),
      status: JSON.stringify({ ...auditMeta(before), closedAt: new Date().toISOString(), completedById: actor(req).id }),
    }).where(eq(audits.id, before.id)).returning();
    return { before, row, changed: true };
  });
  if (result.changed) await auditLog(req, "complete", "audit", result.row.id, result.before, result.row);
  res.json(auditDto(result.row, true));
}));
router.put("/audits/:id/report-details", asyncHandler(async (req, res) => {
  const data = body<AuditReportDetailsData>(Api.SaveAuditReportDetailsBody, req);
  const errors = auditReportDetailsErrors(data);
  if (errors.length) throw new HttpError(422, errors.join("; "));
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, actor(req).organizationId),
      eq(audits.id, String(req.params.id)))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const captions = data.rows.photographs?.filter(row => row.fileName?.trim()) ?? [];
    if (captions.length) {
      const files = await tx.select({ fileName: auditEvidenceFiles.fileName }).from(auditEvidenceFiles).where(and(
        active(auditEvidenceFiles, actor(req).organizationId), eq(auditEvidenceFiles.recordId, before.id),
        inArray(auditEvidenceFiles.recordType, ["audit", "audit_execution"]), eq(auditEvidenceFiles.status, "stored"),
        inArray(auditEvidenceFiles.mimeType, ["image/png", "image/jpeg", "image/webp", "image/gif"]),
      ));
      const fileNames = new Set(files.map(file => file.fileName));
      if (captions.some(row => !fileNames.has(row.fileName.trim()))) {
        throw new HttpError(422, "Photograph captions must match an uploaded image evidence file name.");
      }
    }
    await assertFieldAccess(req, "audit", "audit-execution", {
      mode: "update", current: auditDto(before), body: { reportDetails: data },
    });
    await assertFieldControls(req, "audit", "audit-execution", { mode: "update", current: auditDto(before), body: { reportDetails: data } });
    const [row] = await tx.update(audits).set({
      status: JSON.stringify({ ...auditMeta(before), reportDetails: data }), updatedAt: new Date(),
    }).where(eq(audits.id, before.id)).returning();
    return { before, row };
  });
  await auditLog(req, "update_report_details", "audit", row.id, before, row);
  res.json(auditDto(row, true));
}));
router.put("/audits/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  if (auditIsComplete(data.status) !== auditIsComplete(before.workflowState)) {
    throw new HttpError(409, "Use Mark Complete to complete an audit. Completed audits cannot be reopened through general editing.");
  }
  const [plan] = await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, data.planId)));
  if (!plan) throw new HttpError(404, "Audit plan not found");
  await assertAuditProject(req, plan.projectId);
  if (data.projectId && plan.projectId && data.projectId !== plan.projectId) {
    throw new HttpError(422, "Audit project must match the selected plan");
  }
  const values = auditValues(data);
  if (auditIsComplete(before.workflowState)) {
    values.workflowState = "closed";
    values.status = JSON.stringify({ ...parseJson(values.status, {}), closedAt: auditMeta(before).closedAt });
  }
  values.projectId = plan.projectId;
  // Generated reference numbers are immutable, regardless of the current pattern config.
  if (before.referenceGenerated) values.referenceNumber = before.referenceNumber;
  await assertFieldAccess(req, "audit", "audit-execution", { mode: "update", current: auditDto(before) });
  // Lock before merging metadata so a concurrent document save cannot be overwritten.
  const { locked, row } = await db.transaction(async tx => {
    const [locked] = await tx.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, before.id))).for("update");
    if (!locked) throw new HttpError(404, "Audit not found");
    if (auditIsComplete(data.status) !== auditIsComplete(locked.workflowState)) {
      throw new HttpError(409, "The audit completion status changed. Reload before editing.");
    }
    if (auditIsComplete(locked.workflowState)) {
      values.workflowState = "closed";
      values.status = JSON.stringify({ ...parseJson(values.status, {}), closedAt: auditMeta(locked).closedAt });
    }
    const [row] = await tx.update(audits).set({
      ...values, id: undefined,
      status: JSON.stringify({ ...auditMeta(locked), ...parseJson(values.status, {}) }),
      updatedAt: new Date(),
    }).where(eq(audits.id, before.id)).returning();
    return { locked, row };
  });
  await auditLog(req, "update", "audit", row.id, locked, row); res.json(auditDto(row));
}));
router.delete("/audits/:id", asyncHandler(async (req, res) => {
  const [row] = await db.update(audits).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id)))).returning();
  if (!row) throw new HttpError(404, "Audit not found"); await auditLog(req, "delete", "audit", row.id, row); res.status(204).end();
}));
router.get("/audits/:id/attendee-options", asyncHandler(async (req, res) => {
  const auditId = String(req.params.id);
  await assertAuditRecordAccess(req, "audit", auditId);
  res.json(await eligibleMeetingAttendees(actor(req).organizationId));
}));

async function updateMeeting(req: Request, kind: "opening" | "closing", schema: { safeParse: (value: unknown) => any }) {
  const data = body<AnyRow>(schema, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const eligibleIds = new Set((await eligibleMeetingAttendees(actor(req).organizationId)).map(user => user.id));
  // Existing free-text minutes remain editable without forcing a retrospective user match.
  const previous = new Set((auditMeta(before)[`${kind}Meeting`]?.attendees ?? []) as string[]);
  if (data.attendees.some((id: string) => !eligibleIds.has(id) && !previous.has(id))) {
    throw new HttpError(422, "Select attendees from active QMS Audit users");
  }
  await assertFieldAccess(req, "audit", "audit-execution", {
    mode: "update",
    body: { [`${kind}Meeting`]: data },
    current: { [`${kind}Meeting`]: auditMeta(before)[`${kind}Meeting`] ?? null },
  });
  const row = await db.transaction(async tx => {
    const [locked] = await tx.select().from(audits).where(and(active(audits, actor(req).organizationId),
      eq(audits.id, before.id))).for("update");
    if (!locked) throw new HttpError(404, "Audit not found");
    const meta = auditMeta(locked); meta[`${kind}Meeting`] = { ...data, heldAt: data.heldAt.toISOString() };
    if (kind === "opening" && !meta.startedAt) meta.startedAt = data.heldAt.toISOString();
    const [row] = await tx.update(audits).set({
      status: JSON.stringify(meta), [kind === "opening" ? "openingMeetingMinutes" : "closingMeetingMinutes"]: data.minutes,
      workflowState: kind === "opening" && locked.workflowState === "planned" ? "in progress" : locked.workflowState, updatedAt: new Date(),
    }).where(eq(audits.id, locked.id)).returning();
    return row;
  });
  await auditLog(req, `${kind}_meeting`, "audit", row.id, before, row); return row;
}
router.put("/audits/:id/opening-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "opening", Api.UpdateAuditOpeningMeetingBody)))));
router.put("/audits/:id/closing-meeting", asyncHandler(async (req, res) => res.json(auditDto(await updateMeeting(req, "closing", Api.UpdateAuditClosingMeetingBody)))));
router.put("/audits/:id/checklist", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditChecklistBody, req);
  const [before] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Audit not found");
  const legacyResults = (Array.isArray(before.checklistState) ? before.checklistState : [])
    .map((item: AnyRow) => item.result).filter((value: unknown): value is string => typeof value === "string");
  const existingItems = new Map((Array.isArray(before.checklistState) ? before.checklistState : [])
    .map((item: AnyRow) => [item.id, item]));
  await Promise.all(data.map(async (item) => {
    const previous = existingItems.get(item.id);
    if (!previous && (!item.clause?.trim() || !item.auditArea?.trim() || !item.question?.trim())) {
      throw new HttpError(422, "Clause, Audit Area and Audit Question are required for new checklist items");
    }
    if (item.result) await assertLovValue(db, actor(req).organizationId, "checklist_results", item.result, { allowLegacy: legacyResults });
    if (item.auditArea) await assertLovValue(db, actor(req).organizationId, "Audit Area", item.auditArea, { allowLegacy: previous?.auditArea });
  }));
  const merged = data.filter(item => item.source !== "finding").map(item => {
    const previous = existingItems.get(item.id);
    return previous ? { ...item, source: previous.source, actionTakerId: previous.actionTakerId } : item;
  });
  merged.push(...[...existingItems.values()].filter(item => item.source === "finding"));
  const [row] = await db.update(audits).set({ checklistState: merged as any, updatedAt: new Date() }).where(eq(audits.id, before.id)).returning();
  await auditLog(req, "update_checklist", "audit", row.id, before, row); res.json(auditDto(row));
}));

async function checklistEvidenceIds(organizationId: string, auditId: string, ids: string[]) {
  const evidenceIds = [...new Set(ids)];
  if (evidenceIds.length) {
    const files = await db.select({ id: auditEvidenceFiles.id }).from(auditEvidenceFiles).where(and(
      eq(auditEvidenceFiles.organizationId, organizationId), eq(auditEvidenceFiles.recordType, "audit"),
      eq(auditEvidenceFiles.recordId, auditId), eq(auditEvidenceFiles.status, "stored"),
      isNull(auditEvidenceFiles.deletedAt), inArray(auditEvidenceFiles.id, evidenceIds),
    ));
    if (files.length !== evidenceIds.length) throw new HttpError(422, "Evidence must be uploaded to this audit before linking it");
  }
  return evidenceIds;
}

const checklistItemValues = (data: AnyRow, evidenceIds: string[]) => ({
  clause: data.clause.trim(), auditArea: data.auditArea.trim(), question: data.question.trim(),
  description: data.description?.trim() || null, auditFinding: data.auditFinding || null, evidenceIds,
});

router.post("/audits/:id/checklist/items", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditChecklistItemBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  if (!data.clause.trim() || !data.auditArea.trim() || !data.question.trim()) throw new HttpError(422, "Clause, Audit Area and Audit Question are required");
  await assertLovValue(db, organizationId, "Audit Area", data.auditArea.trim());
  const evidenceIds = await checklistEvidenceIds(organizationId, auditId, data.evidenceIds ?? []);
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(
      active(audits, organizationId), eq(audits.id, auditId),
    )).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const checklist = Array.isArray(before.checklistState) ? before.checklistState : [];
    const item = { id: randomUUID(), ...checklistItemValues(data, evidenceIds) };
    const [row] = await tx.update(audits).set({
      checklistState: [...checklist, item] as any, updatedAt: new Date(),
    }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "add_checklist_item", "audit", row.id, before, row);
  res.status(201).json(auditDto(row));
}));

router.put("/audits/:id/checklist/items/:itemId", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.EditAuditChecklistItemBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  const itemId = String(req.params.itemId);
  if (!data.clause.trim() || !data.auditArea.trim() || !data.question.trim()) throw new HttpError(422, "Clause, Audit Area and Audit Question are required");
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const checklist = Array.isArray(before.checklistState) ? before.checklistState as AnyRow[] : [];
    const previous = checklist.find(item => item.id === itemId);
    if (!previous) throw new HttpError(404, "Checklist item not found");
    if (previous.source === "finding") throw new HttpError(404, "Checklist item not found");
    await assertLovValue(db, organizationId, "Audit Area", data.auditArea.trim(), { allowLegacy: previous.auditArea });
    const submittedIds = [...new Set((data.evidenceIds ?? previous.evidenceIds ?? []) as string[])];
    const priorIds = new Set((previous.evidenceIds ?? []) as string[]);
    await checklistEvidenceIds(organizationId, auditId, submittedIds.filter(id => !priorIds.has(id)));
    const evidenceIds = submittedIds;
    const updated = checklist.map(item => item.id === itemId
      ? { ...item, ...checklistItemValues(data, evidenceIds) } : item);
    const [row] = await tx.update(audits).set({ checklistState: updated as any, updatedAt: new Date() }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "edit_checklist_item", "audit", row.id, before, row);
  res.json(auditDto(row));
}));

router.post("/audits/:id/checklist/import", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.ImportAuditChecklistItemsBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  const referencedIds = new Set<string>();
  for (const [index, item] of data.entries()) {
    if (!item.clause.trim() || !item.auditArea.trim() || !item.question.trim()) {
      throw new HttpError(422, `Row ${index + 2}: Clause, Audit Area and Audit Question are required`);
    }
    if (item.id && referencedIds.has(item.id)) throw new HttpError(422, `Row ${index + 2}: duplicate Checklist item ID`);
    if (item.id) referencedIds.add(item.id);
  }
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const checklist = Array.isArray(before.checklistState) ? before.checklistState as AnyRow[] : [];
    const existing = new Map(checklist.map(item => [item.id, item]));
    const checkedAreas = new Set<string>();
    for (const [index, item] of data.entries()) {
      const previous = item.id ? existing.get(item.id) : undefined;
      if (item.id && !previous) throw new HttpError(422, `Row ${index + 2}: Checklist item is not in this audit`);
      if (previous?.source === "finding") throw new HttpError(422, `Row ${index + 2}: finding-only rows cannot be imported as checklist items`);
      const area = item.auditArea.trim();
      const checkKey = `${area}\0${previous?.auditArea === area ? "legacy" : "active"}`;
      if (!checkedAreas.has(checkKey)) {
        await assertLovValue(db, organizationId, "Audit Area", area, { allowLegacy: previous?.auditArea });
        checkedAreas.add(checkKey);
      }
    }
    const updates = new Map(data.filter(item => item.id).map(item => [item.id, item]));
    const updated = checklist.map(item => {
      const changes = updates.get(item.id);
      return changes ? { ...item, ...checklistItemValues(changes, item.evidenceIds ?? []) } : item;
    });
    const additions = data.filter(item => !item.id).map(item => ({ id: randomUUID(), ...checklistItemValues(item, []) }));
    const [row] = await tx.update(audits).set({ checklistState: [...updated, ...additions] as any, updatedAt: new Date() }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "import_checklist_items", "audit", row.id, before, row);
  res.status(201).json(auditDto(row));
}));

router.post("/audits/:id/finding-items", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditFindingItemBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  if (!data.clause.trim() || !data.auditArea.trim()) throw new HttpError(422, "Clause and Audit Area are required");
  await assertLovValue(db, organizationId, "Audit Area", data.auditArea.trim());
  const eligible = await eligibleMeetingAttendees(organizationId);
  if (!eligible.some(user => user.id === data.actionTakerId)) throw new HttpError(422, "Select an active QMS Audit user as Action Taker");
  const evidenceIds = await checklistEvidenceIds(organizationId, auditId, data.evidenceIds ?? []);
  const { before, row, created } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const checklist = Array.isArray(before.checklistState) ? before.checklistState : [];
    if (data.clientReference && checklist.some((entry: AnyRow) => entry.source === "finding" && entry.clientReference === data.clientReference)) {
      return { before, row: before, created: false };
    }
    const item = {
      id: randomUUID(), source: "finding", question: "", clause: data.clause.trim(),
      auditArea: data.auditArea.trim(), description: data.description?.trim() || null,
      auditFinding: data.auditFinding, evidenceIds, actionTakerId: data.actionTakerId,
      ...(data.clientReference ? { clientReference: data.clientReference } : {}),
    };
    const [row] = await tx.update(audits).set({ checklistState: [...checklist, item] as any, updatedAt: new Date() })
      .where(eq(audits.id, auditId)).returning();
    return { before, row, created: true };
  });
  if (created) await auditLog(req, "add_finding_item", "audit", auditId, before, row);
  res.status(201).json(auditDto(row));
}));

router.patch("/audits/:id/finding-items/:itemId/action-taker", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.AssignAuditFindingActionTakerBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  if (!(await eligibleMeetingAttendees(organizationId)).some(user => user.id === data.actionTakerId)) {
    throw new HttpError(422, "Select an active QMS Audit user as Action Taker");
  }
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const checklist = Array.isArray(before.checklistState) ? before.checklistState as AnyRow[] : [];
    const item = checklist.find(entry => entry.id === String(req.params.itemId));
    const classification = item?.auditFinding || item?.result;
    if (!item || typeof classification !== "string" || !classification.trim() || classification.trim().toLowerCase() === "not applicable") {
      throw new HttpError(404, "Finding not found");
    }
    const [row] = await tx.update(audits).set({
      checklistState: checklist.map(entry => entry.id === item.id ? { ...entry, actionTakerId: data.actionTakerId } : entry) as any,
      updatedAt: new Date(),
    }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "assign_finding_action_taker", "audit", auditId, before, row);
  res.json(auditDto(row));
}));

const documentStatusLabels: Record<string, Array<[string, string]>> = {
  "design-status": [
    ["status-a", "Status A"], ["status-b", "Status B"], ["status-c", "Status C"],
    ["status-d", "Status D"], ["under-review", "Under Review(U/R)"], ["cancelled", "Cancelled"],
  ],
  "procurement-status": [
    ["total-items-tracked", "Total items tracked"], ["purchase-order-issued", "Purchase order issued"],
    ["in-manufacturing", "In manufacturing"], ["fat-completed", "FAT completed"],
    ["fat-pending", "FAT pending / report under approval"], ["shipped", "Shipped / in transit"],
    ["received-at-site", "Received at site"], ["past-planned-receipt-date", "Past planned receipt date"],
  ],
};

router.put("/audits/:id/additional-documents/organization-chart", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.ReplaceAuditOrganizationChartBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  await assertAuditRecordAccess(req, "audit", auditId);
  const { before, row, replaced } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const meta = auditMeta(before);
    const currentId = meta.additionalDocuments?.organizationChartId ?? null;
    // An identical retry must not remove the current chart.
    if (currentId === data.evidenceId) return { before, row: before, replaced: false };
    if (currentId !== data.previousId) throw new HttpError(409, "Organization chart changed. Refresh before replacing it.");
    const [file] = await tx.select().from(auditEvidenceFiles).where(and(
      eq(auditEvidenceFiles.id, data.evidenceId), eq(auditEvidenceFiles.organizationId, organizationId),
      eq(auditEvidenceFiles.recordType, "audit"), eq(auditEvidenceFiles.recordId, auditId),
      eq(auditEvidenceFiles.status, "stored"), isNull(auditEvidenceFiles.deletedAt),
    ));
    if (!file || file.category !== "organization_chart") throw new HttpError(422, "Upload and confirm an Organization Chart file for this audit first");
    const extensions: Record<string, string[]> = {
      pdf: ["application/pdf"], doc: ["application/msword"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      xls: ["application/vnd.ms-excel"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ppt: ["application/vnd.ms-powerpoint"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    };
    const extension = file.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!extensions[extension] || ![...extensions[extension], "application/octet-stream"].includes(file.mimeType)) {
      throw new HttpError(422, "Organization chart must be a PDF, Word, Excel or PowerPoint file");
    }
    const additionalDocuments = { ...meta.additionalDocuments, organizationChartId: file.id, organizationChartFileName: file.fileName };
    const [row] = await tx.update(audits).set({
      status: JSON.stringify({ ...meta, additionalDocuments }), updatedAt: new Date(),
    }).where(eq(audits.id, auditId)).returning();
    // An older chart may also be cited by a checklist or meeting. Unlink it
    // from this section, but leave shared evidence accessible at those links.
    const referenced = currentId && (
      (Array.isArray(before.checklistState) && before.checklistState.some((item: AnyRow) => item.evidenceIds?.includes(currentId))) ||
      meta.openingMeeting?.evidenceIds?.includes(currentId) || meta.closingMeeting?.evidenceIds?.includes(currentId)
    );
    if (currentId && !referenced) await tx.update(auditEvidenceFiles).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(auditEvidenceFiles.id, currentId), eq(auditEvidenceFiles.organizationId, organizationId),
      eq(auditEvidenceFiles.recordType, "audit"), eq(auditEvidenceFiles.recordId, auditId), isNull(auditEvidenceFiles.deletedAt),
    ));
    return { before, row, replaced: true };
  });
  if (replaced) await auditLog(req, "replace_organization_chart", "audit", auditId, before, row);
  res.json(auditDto(row));
}));

router.put("/audits/:id/additional-documents/good-practices", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditGoodPracticesBody, req);
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  await assertAuditRecordAccess(req, "audit", auditId);
  const ids = new Set<string>();
  const rows = data.rows.map((entry: AnyRow) => {
    const id = entry.id.trim();
    if (!id || ids.has(id)) throw new HttpError(422, "Each good practice row needs a unique ID");
    ids.add(id);
    return {
      id, areaProcess: entry.areaProcess.trim(), verifiedConforming: entry.verifiedConforming.trim(),
      evidenceReference: entry.evidenceReference.trim(), referenceNumber: entry.referenceNumber.trim(),
      evidenceId: entry.evidenceId ?? null,
    };
  });
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const evidenceIds = [...new Set<string>(rows.flatMap((item: AnyRow) =>
      typeof item.evidenceId === "string" ? [item.evidenceId] : []))];
    const files = evidenceIds.length ? await tx.select({
      id: auditEvidenceFiles.id, fileName: auditEvidenceFiles.fileName,
    }).from(auditEvidenceFiles).where(and(
      inArray(auditEvidenceFiles.id, evidenceIds),
      eq(auditEvidenceFiles.organizationId, organizationId), eq(auditEvidenceFiles.recordType, "audit"),
      eq(auditEvidenceFiles.recordId, auditId), eq(auditEvidenceFiles.category, "good_practices"),
      eq(auditEvidenceFiles.status, "stored"), isNull(auditEvidenceFiles.deletedAt),
    )) : [];
    if (files.length !== evidenceIds.length) throw new HttpError(422, "Each attached file must be uploaded and confirmed for this audit");
    const fileNames = new Map(files.map(file => [file.id, file.fileName]));
    const savedRows = rows.map((item: AnyRow) => ({
      ...item, evidenceFileName: item.evidenceId ? fileNames.get(item.evidenceId) : null,
    }));
    const meta = auditMeta(before);
    const [row] = await tx.update(audits).set({
      status: JSON.stringify({ ...meta, additionalDocuments: { ...meta.additionalDocuments, goodPractices: savedRows } }),
      updatedAt: new Date(),
    }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "update_good_practices", "audit", auditId, before, row);
  res.json(auditDto(row));
}));

router.put("/audits/:id/additional-documents/:section", asyncHandler(async (req, res) => {
  const section = String(req.params.section);
  const fixed = documentStatusLabels[section];
  if (!fixed) throw new HttpError(404, "Document status section not found");
  const data = body<AnyRow>(Api.UpdateAuditDocumentStatusBody, req);
  const fixedLabels = new Map(fixed);
  const ids = new Set<string>();
  const rows = data.rows.map((entry: AnyRow) => {
    const id = entry.id.trim(), label = entry.label.trim();
    if (!id || !label || ids.has(id)) throw new HttpError(422, "Each status row needs a unique name and ID");
    ids.add(id);
    if (fixedLabels.has(id) && fixedLabels.get(id) !== label) throw new HttpError(422, "Default status labels cannot be changed");
    if (entry.value !== null && (!Number.isFinite(entry.value) || entry.value < 0)) throw new HttpError(422, "Enter a non-negative numeric value");
    return { id, label, value: entry.value, remarks: entry.remarks.trim() };
  });
  if (fixed.some(([id]) => !ids.has(id))) throw new HttpError(422, "All default status rows must be included");
  const organizationId = actor(req).organizationId;
  const auditId = String(req.params.id);
  await assertAuditRecordAccess(req, "audit", auditId);
  const { before, row } = await db.transaction(async tx => {
    const [before] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, auditId))).for("update");
    if (!before) throw new HttpError(404, "Audit not found");
    const meta = auditMeta(before);
    const key = section === "design-status" ? "designStatus" : "procurementStatus";
    const remarksKey = section === "design-status" ? "designRemarks" : "procurementRemarks";
    const remarks = data.remarks ?? legacyDocumentRemarks(rows);
    const [row] = await tx.update(audits).set({
      status: JSON.stringify({ ...meta, additionalDocuments: { ...meta.additionalDocuments, [key]: rows, [remarksKey]: remarks } }),
      updatedAt: new Date(),
    }).where(eq(audits.id, auditId)).returning();
    return { before, row };
  });
  await auditLog(req, "update_document_status", "audit", auditId, before, row);
  res.json(auditDto(row));
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
  const { page, limit, offset } = pagination(req);
  const scope = await getAuthorizedProjectScope(req, "audit");
  const where = and(active(auditFindings, actor(req).organizationId), await auditProjectCondition(req, scope));
  const [rows, [{ count }]] = await Promise.all([
    db.select({ finding: auditFindings }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where).orderBy(desc(auditFindings.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditFindings).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where),
  ]); res.json(paginated(rows.map((row) => findingDto(row.finding)), Number(count), page, limit));
}));
router.post("/findings", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditFindingBody, req);
  await assertFieldAccess(req, "audit", "finding", { mode: "create" });
  await assertFieldControls(req, "audit", "finding", { mode: "create" });
  await Promise.all([
    assertLovValue(db, actor(req).organizationId, "nc_classifications", data.classification),
    assertLovValue(db, actor(req).organizationId, "finding_priorities", data.priority),
    assertLovValue(db, actor(req).organizationId, "risk_levels", data.riskLevel),
  ]);
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, data.auditId)));
  if (!audit) throw new HttpError(404, "Audit not found");
  await assertAuditProject(req, audit.projectId);
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
  const [parentAudit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, data.auditId)));
  if (!parentAudit) throw new HttpError(404, "Audit not found");
  await assertAuditProject(req, parentAudit.projectId);
  await assertFieldAccess(req, "audit", "finding", { mode: "update", current: findingDto(before) });
  await assertFieldControls(req, "audit", "finding", { mode: "update", current: findingDto(before) });
  await Promise.all([
    assertLovValue(db, actor(req).organizationId, "nc_classifications", data.classification, { allowLegacy: before.classification }),
    assertLovValue(db, actor(req).organizationId, "finding_priorities", data.priority, { allowLegacy: before.priority }),
    assertLovValue(db, actor(req).organizationId, "risk_levels", data.riskLevel, { allowLegacy: before.riskLevel }),
  ]);
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
  extensionPriorState?: string | null;
  reviewComments?: string | null; effectivenessVerified?: boolean; closedAt?: string | null;
  sourceChecklistItemId?: string;
  reviewOutcome?: string | null; reviewedBy?: string | null; reviewedAt?: string | null;
};
// A due-date extension may only be requested once the CAR response has been reviewed and
// accepted (implementation stage). Allowing earlier requests would let an extension approval
// promote a CAR past its response and review steps straight into a closable state.
const CAR_EXTENSION_ELIGIBLE_STATES: readonly string[] = ["accepted"];
// States a CAR may legitimately resume after an extension decision ("extension_requested" and
// "closed" are never valid restore targets).
const CAR_EXTENSION_RESTORABLE_STATES: readonly string[] = ["open", "draft", "submitted", "accepted", "rejected"];
// Resolves the workflow state a CAR was in when its pending extension was requested. Rows
// requested after the safeguard record it in the CAR metadata; older rows recover it from the
// audit trail, whose request_extension entries store the pre-request snapshot. Returns null
// when the original state cannot be verified.
const extensionPriorState = async (before: AnyRow): Promise<string | null> => {
  const recorded = carMeta(before).extensionPriorState;
  if (typeof recorded === "string" && CAR_EXTENSION_RESTORABLE_STATES.includes(recorded)) return recorded;
  const [entry] = await db.select({ before: auditAuditLogEntries.before }).from(auditAuditLogEntries)
    .where(and(
      eq(auditAuditLogEntries.organizationId, before.organizationId),
      eq(auditAuditLogEntries.entityType, "corrective_action_report"),
      eq(auditAuditLogEntries.entityId, before.id),
      eq(auditAuditLogEntries.action, "request_extension"),
    ))
    .orderBy(desc(auditAuditLogEntries.createdAt)).limit(1);
  const state = (entry?.before as AnyRow | null | undefined)?.workflowState;
  return typeof state === "string" && CAR_EXTENSION_RESTORABLE_STATES.includes(state) ? state : null;
};
const carMeta = (row: AnyRow): CarMeta => parseJson(row.effectivenessNotes, {});
const carDto = (row: AnyRow) => {
  const meta = carMeta(row);
  return {
    id: row.id, findingId: row.auditFindingId, responsibleDepartment: row.responsibleDepartment,
    ownerId: row.ownerId ?? row.id, rootCause: row.rootCause, correction: row.correction, correctiveAction: row.correctiveAction,
    status: row.workflowState === "rejected" && ["query", "rework"].includes(meta.reviewOutcome ?? "")
      ? `Returned for ${meta.reviewOutcome}`
      : ({ open: "Open", draft: "Draft", submitted: "Submitted", accepted: "Accepted", rejected: "Rejected", extension_requested: "Extension Requested", closed: "Closed" } as AnyRow)[row.workflowState] ?? "Open",
    dueDate: new Date(row.dueDate ?? row.createdAt), extensionRequestedTo: row.extensionDueDate ? new Date(row.extensionDueDate) : null,
    extensionReason: meta.extensionReason ?? null,
    extensionStatus: row.extensionStatus === "none" ? null : row.extensionStatus === "requested" ? "pending" : row.extensionStatus,
    extensionReviewedBy: meta.extensionReviewedBy ?? null,
    extensionReviewedAt: meta.extensionReviewedAt ? new Date(meta.extensionReviewedAt) : null,
    effectivenessVerified: meta.effectivenessVerified ?? false, closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
    reviewComments: meta.reviewComments ?? null, reviewOutcome: meta.reviewOutcome ?? null,
    reviewedBy: meta.reviewedBy ?? null, reviewedAt: meta.reviewedAt ? new Date(meta.reviewedAt) : null,
  };
};

router.get("/car-register", asyncHandler(async (req, res) => {
  res.json(await carRegister(req, carDto));
}));
router.get("/car-register/report.docx", asyncHandler(async (req, res) => {
  const parsed = Api.DownloadCarWordReportQueryParams.safeParse(req.query);
  if (!parsed.success || [parsed.data.auditId, parsed.data.itemId, parsed.data.carId].filter(Boolean)
    .some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id!))) {
    throw new HttpError(422, "Valid audit and finding identifiers are required");
  }
  const data = await carWordReportData(req, parsed.data);
  const bytes = await renderCarWordReport(data);
  res.setHeader("Content-Type", CAR_WORD_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="Corrective_Action_Report_${parsed.data.carId ?? parsed.data.itemId}.docx"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(bytes);
}));
router.post("/car-register/start", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.StartFindingCarBody, req);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.auditId)) {
    throw new HttpError(422, "A valid Audit reference is required");
  }
  const organizationId = actor(req).organizationId;
  const [audit] = await db.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, data.auditId)));
  if (!audit) throw new HttpError(404, "Audit not found");
  await carAuditContext(req, audit);
  const row = await db.transaction(async tx => {
    const [locked] = await tx.select().from(audits).where(and(active(audits, organizationId), eq(audits.id, audit.id))).for("update");
    if (!locked) throw new HttpError(404, "Audit not found");
    const item = Array.isArray(locked.checklistState) ? locked.checklistState.find((item: AnyRow) => item.id === data.itemId) as AnyRow : null;
    if (!item || !actionableFinding(item)) throw new HttpError(404, "Finding not found in this audit");
    if (!item.actionTakerId) throw new HttpError(422, "Assign an action taker to the finding before starting its CAR");
    if (item.actionTakerId !== actor(req).id) {
      throw new HttpError(403, "Only the assigned action taker may respond to this finding");
    }
    const existingFindings = await tx.select().from(auditFindings).where(and(active(auditFindings, organizationId), eq(auditFindings.auditId, audit.id)));
    let finding = existingFindings.find(row => (row.evidence as AnyRow)?.sourceChecklistItemId === item.id);
    if (!finding) [finding] = await tx.insert(auditFindings).values({
      organizationId, auditId: audit.id, classification: item.auditFinding || item.result,
      description: item.description || item.question || "", responsibleDepartment: item.auditArea || "Audit finding",
      evidence: { sourceChecklistItemId: item.id, evidenceIds: item.evidenceIds || [] },
    }).returning();
    const [existing] = await tx.select().from(correctiveActionReports).where(and(active(correctiveActionReports, organizationId), eq(correctiveActionReports.auditFindingId, finding!.id)));
    if (existing) return existing;
    const [created] = await tx.insert(correctiveActionReports).values({
      organizationId, auditFindingId: finding!.id, ownerId: item.actionTakerId,
      responsibleDepartment: item.auditArea || "Audit finding", workflowState: "open",
      effectivenessNotes: JSON.stringify({ sourceChecklistItemId: item.id }),
    }).returning();
    await tx.insert(auditAuditLogEntries).values({ organizationId, actorId: actor(req).id,
      action: "create", entityType: "corrective_action_report", entityId: created!.id,
      after: created as any });
    return created!;
  });
  const context = await carContext(req, row.id);
  res.json({ ...carDto(row), canRespond: context.canEditResponse, canReview: context.canReview });
}));

router.get("/my-actions", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const organizationId = actor(req).organizationId;
  const userId = actor(req).id;
  const [
    scheduleScope, planScope, auditScope, carScope,
    scheduleFullScope, planFullScope, auditFullScope, carFullScope,
    scheduleReviewScope, effectiveScope,
  ] = await Promise.all([
    moduleSelectScope(req, "schedules"),
    moduleSelectScope(req, "plans"),
    moduleSelectScope(req, "audits"),
    moduleSelectScope(req, "cars"),
    moduleFullScope(req, "schedules"),
    moduleFullScope(req, "plans"),
    moduleFullScope(req, "audits"),
    moduleFullScope(req, "cars"),
    moduleFullScope(req, "schedules", "review"),
    getAuthorizedProjectScope(req, "audit"),
  ]);
  if (![scheduleScope, planScope, auditScope, carScope].some(scopeHasSelectAccess)) {
    throw new HttpError(403, "Audit select access is required");
  }
  const carLeadReviewer = scopeHasSelectAccess(carScope) && await carLeadMarker(organizationId, userId);
  if (![hasActionPermission(scheduleScope, scheduleFullScope), hasActionPermission(scheduleScope, scheduleReviewScope), hasActionPermission(planScope, planFullScope),
    hasActionPermission(auditScope, auditFullScope), hasActionPermission(carScope, carFullScope), carLeadReviewer].some(Boolean)) {
    res.json(Api.ListAuditMyActionsResponse.parse(paginated([], 0, page, limit)));
    return;
  }

  const itemsByRecord = new Map<string, MyActionItem>();
  const add = (item: MyActionItem) => itemsByRecord.set(`${item.kind}:${item.id}`, item);

  const scheduleRows = [
    hasActionPermission(scheduleScope, scheduleFullScope), hasActionPermission(scheduleScope, scheduleReviewScope), hasActionPermission(planScope, planFullScope),
    hasActionPermission(auditScope, auditFullScope), hasActionPermission(carScope, carFullScope), carLeadReviewer,
  ].some(Boolean)
    ? await db.select().from(auditSchedules).where(active(auditSchedules, organizationId))
    : [];
  const schedulesById = new Map(scheduleRows.map(row => [row.id, row]));
  const scheduleProjectIds = (row: AnyRow) => scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
  const scheduleIsInActionScope = (row: AnyRow, actionScope = scheduleFullScope) => {
    const projectIds = scheduleProjectIds(row);
    if (!projectIds.length) {
      return isProcessAuditSchedule(row) && hasActionPermission(scheduleScope, actionScope)
        && scopeHasSelectAccess(effectiveScope);
    }
    return projectIds.every((projectId: string) =>
      (scheduleScope.unrestricted || scheduleScope.projectIds.includes(projectId))
      && (actionScope.unrestricted || actionScope.projectIds.includes(projectId))
      && (effectiveScope.unrestricted || effectiveScope.projectIds.includes(projectId)));
  };
  const programmesWithScopedChildren = (actionScope: typeof scheduleFullScope) => new Set(scheduleRows.flatMap(child => {
    const meta = scheduleMeta(child);
    return !meta.programme && meta.parentId && scheduleIsInActionScope(child, actionScope) ? [meta.parentId] : [];
  }));
  const editableProgrammeChildren = programmesWithScopedChildren(scheduleFullScope);
  const reviewableProgrammeChildren = programmesWithScopedChildren(scheduleReviewScope);
  const scheduleRecordIsVisible = (row: AnyRow, reviewing: boolean) => {
    const actionScope = reviewing ? scheduleReviewScope : scheduleFullScope;
    if (!isProgramme(row)) return scheduleIsInActionScope(row, actionScope);
    if (!reviewing && row.ownerId === userId) return hasActionPermission(scheduleScope, actionScope)
      && scopeHasSelectAccess(effectiveScope);
    return (reviewing ? reviewableProgrammeChildren : editableProgrammeChildren).has(row.id);
  };
  const processScheduleIds = new Set(scheduleRows
    .filter(row => !isProgramme(row) && isProcessAuditSchedule(row))
    .map(row => row.id));
  const currentApprovalRoleIds = hasActionPermission(scheduleScope, scheduleReviewScope) ? [...new Set(scheduleRows.flatMap(row => {
    if (row.workflowState !== "submitted") return [];
    const meta = scheduleMeta(row);
    const role = (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0];
    return role?.id ? [role.id] : [];
  }))] : [];
  const currentApprovalAssignments = currentApprovalRoleIds.length
    ? await db.select({
      roleId: auditUserWorkspaceRoles.workspaceRoleId,
      userId: auditUserWorkspaceRoles.userId,
    }).from(auditUserWorkspaceRoles)
      .innerJoin(users, eq(users.id, auditUserWorkspaceRoles.userId))
      .where(and(
        eq(auditUserWorkspaceRoles.organizationId, organizationId),
        inArray(auditUserWorkspaceRoles.workspaceRoleId, currentApprovalRoleIds),
        eq(auditUserWorkspaceRoles.status, "active"),
        isNull(auditUserWorkspaceRoles.deletedAt),
        eq(users.accessStatus, "active"),
        isNull(users.deletedAt),
      ))
    : [];
  const approvalReviewers = new Map<string, Set<string>>();
  for (const assignment of currentApprovalAssignments) {
    const members = approvalReviewers.get(assignment.roleId) ?? new Set<string>();
    members.add(assignment.userId);
    approvalReviewers.set(assignment.roleId, members);
  }
  for (const row of scheduleRows) {
    const programme = isProgramme(row);
    const ownerAction = row.ownerId === userId && ["draft", "sent_back"].includes(row.workflowState)
      && scheduleRecordIsVisible(row, false);
    const meta = scheduleMeta(row);
    const currentRole = (meta.approvalRoles ?? [])[meta.approvalIndex ?? 0];
    const reviewAction = row.workflowState === "submitted"
      && Boolean(currentRole && approvalReviewers.get(currentRole.id)?.has(userId))
      && scheduleRecordIsVisible(row, true);
    if (!ownerAction && !reviewAction) continue;
    const id = row.id;
    let href: string;
    if (programme) {
      href = `/audit/schedules/${encodeURIComponent(id)}`;
    } else {
      const parentId = meta.parentId;
      const parentRow = typeof parentId === "string" ? schedulesById.get(parentId) : undefined;
      const parentIsUsable = typeof parentId === "string" && parentId !== "legacy"
        && Boolean(parentRow && isProgramme(parentRow));
      const legacyContext = parentId == null || parentId === "" || parentId === "legacy";
      if (!parentIsUsable && !legacyContext) continue;
      const contextId = parentIsUsable ? parentId : "legacy";
      href = `/audit/schedules/${encodeURIComponent(contextId)}?focusSchedule=${encodeURIComponent(id)}`;
    }
    add({
      kind: programme ? "programme" : "schedule",
      id,
      title: row.title,
      action: reviewAction ? "Review" : "Continue",
      status: ({ draft: "Draft", submitted: "Submitted", sent_back: "Sent Back" } as AnyRow)[row.workflowState] ?? row.workflowState,
      href,
      dueDate: myActionDate(meta.plannedStartDate ?? meta.fromDate),
    });
  }

  const planRows = [hasActionPermission(planScope, planFullScope), hasActionPermission(auditScope, auditFullScope),
    hasActionPermission(carScope, carFullScope)].some(Boolean)
    ? await db.select().from(auditPlans).where(active(auditPlans, organizationId))
    : [];
  const plansById = new Map(planRows.map(row => [row.id, row]));
  for (const row of planRows) {
    if (!hasActionPermission(planScope, planFullScope)) continue;
    if (!["draft", "shared", "active", "ready"].includes(String(row.workflowState).toLowerCase())) continue;
    const meta = planMeta(row);
    const assigned = meta.leadAuditorId === userId
      || (Array.isArray(row.teamMemberIds) && row.teamMemberIds.includes(userId))
      || (meta.processOwnerIds ?? []).includes(userId);
    if (!assigned) continue;
    const processSchedule = Boolean(row.auditScheduleId && processScheduleIds.has(row.auditScheduleId));
    if (!myActionProjectInScope(row.projectId, planScope, planFullScope, effectiveScope, processSchedule)) continue;
    const title = meta.auditTitle ?? row.scope ?? "Audit Plan";
    add({
      kind: "plan", id: row.id, title,
      action: "Continue",
      status: ({ draft: "Draft", shared: "Shared", active: "Active", ready: "Ready" } as AnyRow)[String(row.workflowState).toLowerCase()] ?? row.workflowState,
      href: `/audit/plans/${encodeURIComponent(row.id)}`,
      dueDate: myActionDate(row.auditDate ?? meta.startDateTime),
    });
  }

  const auditRows = hasActionPermission(auditScope, auditFullScope) ? await db.select({ audit: audits }).from(audits)
    .innerJoin(auditPlans, eq(audits.auditPlanId, auditPlans.id))
    .where(and(active(audits, organizationId), active(auditPlans, organizationId))) : [];
  for (const { audit: row } of auditRows) {
    if (!["planned", "scheduled", "in progress", "report draft", "car follow-up"].includes(String(row.workflowState).toLowerCase())) continue;
    const plan = plansById.get(row.auditPlanId ?? "");
    if (!plan) continue;
    const meta = planMeta(plan);
    const assigned = meta.leadAuditorId === userId
      || (Array.isArray(plan.teamMemberIds) && plan.teamMemberIds.includes(userId));
    if (!assigned) continue;
    const processSchedule = Boolean(plan.auditScheduleId && processScheduleIds.has(plan.auditScheduleId));
    if (!myActionProjectInScope(row.projectId, auditScope, auditFullScope, effectiveScope, processSchedule)) continue;
    const auditInfo = auditMeta(row);
    const displayStatus = ({ planned: "Planned", scheduled: "Planned", "in progress": "In Progress", "report draft": "Report Draft", "car follow-up": "CAR Follow-up" } as AnyRow)[String(row.workflowState).toLowerCase()] ?? row.workflowState;
    add({
      kind: "audit", id: row.id, title: auditInfo.title ?? row.referenceNumber,
      action: "Continue", status: displayStatus,
      href: `/audit/audits/${encodeURIComponent(row.id)}`,
      dueDate: myActionDate(plan.auditDate ?? meta.startDateTime),
    });
  }

  const actionableCarConditions = [
    and(eq(correctiveActionReports.ownerId, userId), inArray(correctiveActionReports.workflowState, ["open", "draft", "rejected"])),
    ...(carLeadReviewer ? [eq(correctiveActionReports.workflowState, "submitted")] : []),
  ];
  const carsWithParents = (hasActionPermission(carScope, carFullScope) || carLeadReviewer) && actionableCarConditions.length ? await db.select({
    car: correctiveActionReports, audit: audits,
  }).from(correctiveActionReports)
    .innerJoin(auditFindings, and(
      eq(correctiveActionReports.auditFindingId, auditFindings.id),
      eq(auditFindings.organizationId, organizationId),
      isNull(auditFindings.deletedAt),
    ))
    .innerJoin(audits, and(
      eq(auditFindings.auditId, audits.id),
      eq(audits.organizationId, organizationId),
      isNull(audits.deletedAt),
    ))
    .where(and(
      active(correctiveActionReports, organizationId), active(auditFindings, organizationId), active(audits, organizationId),
      or(...actionableCarConditions),
    )) : [];
  for (const { car, audit: parentAudit } of carsWithParents) {
    const sourceId = carMeta(car).sourceChecklistItemId;
    if (sourceId && !(Array.isArray(parentAudit.checklistState) && parentAudit.checklistState.some((item: AnyRow) => item.id === sourceId && actionableFinding(item)))) continue;
    const ownerAction = car.ownerId === userId && ["open", "draft", "rejected"].includes(String(car.workflowState).toLowerCase());
    const reviewerAction = car.workflowState === "submitted" && carLeadReviewer
      && planMeta(plansById.get(parentAudit.auditPlanId ?? "") ?? {}).leadAuditorId === userId;
    if (!ownerAction && !reviewerAction) continue;
    const plan = plansById.get(parentAudit.auditPlanId ?? "");
    const processSchedule = Boolean(plan?.auditScheduleId && processScheduleIds.has(plan.auditScheduleId));
    if (!myActionProjectInScope(parentAudit.projectId, carScope, reviewerAction ? carScope : carFullScope, effectiveScope, processSchedule)) continue;
    add({
      kind: "car", id: car.id,
      title: `Corrective action: ${car.responsibleDepartment}`,
      action: reviewerAction ? "Review" : car.workflowState === "rejected" ? "Revise" : "Complete",
       status: carDto(car).status,
      href: `/audit/cars/${encodeURIComponent(car.id)}`,
      dueDate: myActionDate(car.dueDate),
    });
  }

  const items = [...itemsByRecord.values()].sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });
  res.json(Api.ListAuditMyActionsResponse.parse(paginated(items.slice(offset, offset + limit), items.length, page, limit)));
}));

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
  const scope = await getAuthorizedProjectScope(req, "audit");
  if (!scope.unrestricted) clauses.push((await auditProjectCondition(req, scope))!);
  if (req.query.status) clauses.push(eq(correctiveActionReports.workflowState, String(req.query.status).toLowerCase().replaceAll(" ", "_")));
  const where = and(...clauses);
  const [rows, [{ count }]] = await Promise.all([
    db.select({ car: correctiveActionReports }).from(correctiveActionReports).innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id)).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where).orderBy(desc(correctiveActionReports.updatedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(correctiveActionReports).innerJoin(auditFindings, eq(correctiveActionReports.auditFindingId, auditFindings.id)).innerJoin(audits, eq(auditFindings.auditId, audits.id)).where(where),
  ]); res.json(paginated(rows.map((row) => carDto(row.car)), Number(count), page, limit));
}));
router.get("/cars/:id/activity", asyncHandler(async (req, res) => {
  const context = await carContext(req, String(req.params.id), true);
  const { page, limit, offset } = pagination(req);
  const predicate = and(
    eq(auditAuditLogEntries.organizationId, actor(req).organizationId),
    eq(auditAuditLogEntries.entityType, "corrective_action_report"),
    eq(auditAuditLogEntries.entityId, context.car.id),
    inArray(auditAuditLogEntries.action, ["update", "submit"]),
  );
  const [events, [count]] = await Promise.all([
    db.select({ event: auditAuditLogEntries, actorName: users.fullName }).from(auditAuditLogEntries)
      .leftJoin(users, eq(users.id, auditAuditLogEntries.actorId))
      .where(predicate).orderBy(desc(auditAuditLogEntries.createdAt), desc(auditAuditLogEntries.id))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditAuditLogEntries).where(predicate),
  ]);
  res.json({ items: events.map(({ event, actorName }) => {
    const after = event.after as AnyRow | null;
    return { id: event.id, action: event.action, actorName: actorName || "Unavailable user",
      createdAt: event.createdAt, status: after?.workflowState ? carDto(after).status : after?.status || null,
      comments: null };
  }), total: Number(count?.count ?? 0), page, limit });
}));
router.post("/cars/:id/edit-session", asyncHandler(async (req, res) => {
  const context = await carContext(req, String(req.params.id));
  if (!context.canEditResponse) throw new HttpError(403, "Only the assigned action taker may edit this response");
  if (!["open", "draft", "rejected"].includes(context.car.workflowState)) throw new HttpError(409, "CAR cannot be edited in its current state");
  res.json({ ...carDto(context.car), canRespond: context.canEditResponse, canReview: context.canReview });
}));
router.get("/cars/:id", asyncHandler(async (req, res) => {
  const [row] = await db.select().from(correctiveActionReports).where(and(
    active(correctiveActionReports, actor(req).organizationId),
    eq(correctiveActionReports.id, String(req.params.id)),
  ));
  if (!row) throw new HttpError(404, "CAR not found");
  await assertAuditRecordAccess(req, "car", row.id);
  const context = await carContext(req, row.id, true);
  res.json(Api.GetCorrectiveActionReportResponse.parse({ ...carDto(row), canRespond: context.canEditResponse, canReview: context.canReview }));
}));
router.put("/cars/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateCorrectiveActionReportBody, req);
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  const context = await carContext(req, before.id);
  if (!context.canEditResponse) throw new HttpError(403, "Only the assigned action taker may update this response");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR cannot be edited in its current state");
  await assertFieldAccess(req, "audit", "car", { mode: "update", current: carDto(before) });
  await assertFieldControls(req, "audit", "car", { mode: "update", current: carDto(before) });
  const saveAndSubmit = data.saveAndSubmit === true;
  if (saveAndSubmit) {
    if (!context.leadId) throw new HttpError(422, "Select a Lead / Internal Auditor in the linked Audit Plan before submitting");
    if (!data.rootCause?.trim() || !data.correction?.trim() || !data.correctiveAction?.trim()) {
      throw new HttpError(422, "Root cause, correction, and corrective action are required");
    }
  }
  const row = await db.transaction(async tx => {
    const [saved] = await tx.update(correctiveActionReports).set({
      rootCause: data.rootCause, correction: data.correction, correctiveAction: data.correctiveAction,
      ownerId: context.ownerId, dueDate: before.dueDate, workflowState: saveAndSubmit ? "submitted" : "draft", updatedAt: new Date(),
    }).where(and(eq(correctiveActionReports.id, before.id), eq(correctiveActionReports.workflowState, before.workflowState))).returning();
    if (!saved) throw new HttpError(409, "CAR changed while saving. Reload and retry.");
    await auditLog(req, saveAndSubmit ? "submit" : "update", "corrective_action_report", saved.id, before, saved, tx as unknown as typeof db);
    return saved;
  });
  if (saveAndSubmit) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: context.leadId!,
    type: "car_submitted", title: "CAR response awaiting your review", body: "The action taker submitted a response to an Audit finding.",
    entityType: "corrective_action_report", entityId: row.id });
  res.json(carDto(row));
}));
router.post("/cars/:id/submit", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  const context = await carContext(req, before.id);
  if (!context.canEditResponse) throw new HttpError(403, "Only the assigned action taker may submit this response");
  if (!context.leadId) throw new HttpError(422, "Select a Lead / Internal Auditor in the linked Audit Plan before submitting");
  if (!["open", "draft", "rejected"].includes(before.workflowState)) throw new HttpError(409, "CAR is not eligible for submission");
  if (!before.rootCause?.trim() || !before.correction?.trim() || !before.correctiveAction?.trim()) throw new HttpError(422, "Root cause, correction, and corrective action are required");
  const [row] = await db.update(correctiveActionReports).set({ workflowState: "submitted", updatedAt: new Date() })
    .where(and(eq(correctiveActionReports.id, before.id), eq(correctiveActionReports.workflowState, before.workflowState))).returning();
  if (!row) throw new HttpError(409, "CAR changed while submitting. Reload and retry.");
  await notify(db, "audit", { organizationId: actor(req).organizationId, userId: context.leadId,
    type: "car_submitted", title: "CAR response awaiting your review", body: "The action taker submitted a response to an Audit finding.",
    entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, "submit", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/review", asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCorrectiveActionReportBody, req);
  if (data.decision !== "accept" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when returning a response for queries or rework");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  const context = await carContext(req, before.id);
  if (!context.canReview) throw new HttpError(403, "Only this audit's assigned Audit Team Lead may review the CAR");
  if (before.workflowState !== "submitted") throw new HttpError(409, "Only submitted CARs may be reviewed");
  const [row] = await db.update(correctiveActionReports).set({
    ownerId: context.ownerId,
    workflowState: data.decision === "accept" ? "closed" : "rejected",
    effectivenessNotes: JSON.stringify({ ...carMeta(before), reviewComments: data.comments?.trim() || null,
      reviewOutcome: data.decision === "reject" ? "rework" : data.decision, reviewedBy: actor(req).id,
      reviewedAt: new Date().toISOString(), ...(data.decision === "accept" ? { closedAt: new Date().toISOString() } : {}) }), updatedAt: new Date(),
  }).where(and(eq(correctiveActionReports.id, before.id), eq(correctiveActionReports.workflowState, "submitted"))).returning();
  if (!row) throw new HttpError(409, "This CAR has already been reviewed. Reload to see its status.");
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "car_decision", title: data.decision === "accept" ? "CAR closed" : data.decision === "query" ? "CAR returned for query" : "CAR returned for rework", body: data.comments || "Your CAR has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, data.decision, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension", asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.RequestCarExtensionBody, req);
  if (!data.reason.trim()) throw new HttpError(422, "Extension reason is required");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.workflowState === "extension_requested" || before.extensionStatus === "requested") throw new HttpError(409, "An extension request is already awaiting review");
  if (!CAR_EXTENSION_ELIGIBLE_STATES.includes(before.workflowState)) throw new HttpError(409, `Extension can only be requested once the CAR is accepted (current state: ${before.workflowState})`);
  if (before.dueDate && dateOnly(data.requestedDueDate)! <= before.dueDate) throw new HttpError(422, "Requested due date must be after the current due date");
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: "requested", extensionRequestedAt: new Date(), extensionDueDate: dateOnly(data.requestedDueDate),
    workflowState: "extension_requested",
    effectivenessNotes: JSON.stringify({ ...carMeta(before), extensionReason: data.reason, extensionPriorState: before.workflowState }), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "request_extension", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension/review", requireAuditAdmin, asyncHandler(async (req, res) => { const data = body<AnyRow>(Api.ReviewCarExtensionBody, req);
  if (data.decision === "reject" && !data.comments?.trim()) throw new HttpError(422, "Comments are required when rejecting");
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.extensionStatus !== "requested" || before.workflowState !== "extension_requested") throw new HttpError(409, "No extension is awaiting review");
  // Restore the state the CAR was in before the extension request so an approval can never
  // promote it past response/review. When the original state cannot be verified (legacy rows
  // predate the safeguard and have no audit-trail snapshot), refuse to decide: the request
  // must be withdrawn and re-submitted so the CAR cannot skip its required steps.
  const priorState = await extensionPriorState(before);
  if (!priorState) throw new HttpError(409, "This extension request predates the workflow safeguards and its original state cannot be verified. Withdraw the request and submit a new extension.");
  const meta = { ...carMeta(before), extensionReviewedBy: actor(req).id, extensionReviewedAt: new Date().toISOString(), reviewComments: data.comments ?? null };
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: data.decision === "approve" ? "approved" : "rejected",
    extensionApprovedAt: data.decision === "approve" ? new Date() : null,
    extensionDueDate: data.decision === "approve" ? before.extensionDueDate : null,
    workflowState: priorState, effectivenessNotes: JSON.stringify(meta), updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  if (row.ownerId) await notify(db, "audit", { organizationId: actor(req).organizationId, userId: row.ownerId, type: "extension_decision", title: `CAR extension ${data.decision}d`, body: data.comments || "Your extension request has been reviewed.", entityType: "corrective_action_report", entityId: row.id });
  await auditLog(req, `${data.decision}_extension`, "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/extension/cancel", asyncHandler(async (req, res) => {
  const [before] = await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), eq(correctiveActionReports.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "CAR not found");
  if (before.extensionStatus !== "requested" || before.workflowState !== "extension_requested") throw new HttpError(409, "No extension is awaiting review");
  // Fall back to "open" when the original state cannot be verified: a reopened CAR must go
  // through the full response and review cycle again, so it can never skip required steps.
  const priorState = (await extensionPriorState(before)) ?? "open";
  const [row] = await db.update(correctiveActionReports).set({
    extensionStatus: "none", extensionRequestedAt: null, extensionDueDate: null,
    workflowState: priorState, updatedAt: new Date(),
  }).where(eq(correctiveActionReports.id, before.id)).returning();
  await auditLog(req, "cancel_extension", "corrective_action_report", row.id, before, row); res.json(carDto(row));
}));
router.post("/cars/:id/close", requireAuditAdmin, asyncHandler(async (req, res) => {
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
  await assertAuditRecordAccess(req, data.recordType, data.recordId);
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
  const [before] = await db.select().from(auditEvidenceFiles).where(and(
    eq(auditEvidenceFiles.id, String(req.params.id)),
    eq(auditEvidenceFiles.organizationId, actor(req).organizationId),
    isNull(auditEvidenceFiles.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Evidence not found");
  await assertAuditRecordAccess(req, before.recordType, before.recordId);
  let row;
  try {
    row = await confirmEvidence(db, "audit", String(req.params.id), actor(req).organizationId);
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : "Upload has not completed");
  }
  if (!row) throw new HttpError(404, "Evidence not found");
  await auditLog(req, "confirm", "evidence", row.id, undefined, row); res.json(evidenceDto(row));
}));
router.get("/evidence", asyncHandler(async (req, res) => {
  const parsed = Api.ListAuditEvidenceQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(422, parsed.error.message);
  const { page, limit } = parsed.data;
  await assertAuditRecordAccess(req, parsed.data.recordType, parsed.data.recordId);
  const all = await listEvidence(db, "audit", actor(req).organizationId, parsed.data.recordType, parsed.data.recordId);
  if (parsed.data.scope !== "attachments") {
    res.json(paginated(all.slice((page - 1) * limit, page * limit).map(evidenceDto), all.length, page, limit));
    return;
  }
  if (parsed.data.recordType !== "audit") throw new HttpError(422, "Attachment scope is only available for audits");
  const [audit] = await db.select({ checklistState: audits.checklistState }).from(audits).where(and(
    active(audits, actor(req).organizationId), eq(audits.id, parsed.data.recordId),
  )).limit(1);
  if (!audit) throw new HttpError(404, "Audit not found");
  const checklistIds = new Set(
    (Array.isArray(audit.checklistState) ? audit.checklistState : [])
      .flatMap((item: AnyRow) => Array.isArray(item.evidenceIds) ? item.evidenceIds : []),
  );
  const attachments = all.filter((file: AnyRow) =>
    file.status === "stored" && !checklistIds.has(file.id) && file.category !== "checklist")
    .sort((a: AnyRow, b: AnyRow) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(paginated(attachments.slice((page - 1) * limit, page * limit).map(evidenceDto), attachments.length, page, limit));
}));

async function scopedAuditRows(req: Request, projectId?: string, module = "audits") {
  const scope = await getAuthorizedProjectScope(req, "audit", { module, action: "select" });
  if (projectId && !scope.unrestricted && !scope.projectIds.includes(projectId)) {
    throw new HttpError(403, "You do not have access to this project");
  }
  return db.select().from(audits).where(and(
    active(audits, actor(req).organizationId),
    projectId ? eq(audits.projectId, projectId) : await auditProjectCondition(req, scope),
  ));
}

async function scopedAuditData(req: Request, projectId?: string, scopeModule?: string) {
  const [auditRows, findingAudits, carAudits] = await Promise.all([
    scopedAuditRows(req, projectId, scopeModule ?? "audits"),
    scopedAuditRows(req, projectId, scopeModule ?? "findings"),
    scopedAuditRows(req, projectId, scopeModule ?? "cars"),
  ]);
  const findingAuditIds = findingAudits.map((row) => row.id);
  const findingRows = findingAuditIds.length
    ? await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), inArray(auditFindings.auditId, findingAuditIds)))
    : [];
  const carAuditIds = carAudits.map((row) => row.id);
  const carParents = carAuditIds.length
    ? await db.select({ id: auditFindings.id }).from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), inArray(auditFindings.auditId, carAuditIds)))
    : [];
  const carRows = carParents.length
    ? await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), inArray(correctiveActionReports.auditFindingId, carParents.map((row) => row.id))))
    : [];
  return { auditRows, findingRows, carRows };
}

async function dashboardData(req: Request, projectId?: string, scopeModule = "dashboard") {
  const { auditRows, findingRows, carRows } = await scopedAuditData(req, projectId, scopeModule);
  const countBy = (rows: AnyRow[], key: string) => rows.reduce((out: AnyRow, row) => ({ ...out, [row[key]]: (out[row[key]] ?? 0) + 1 }), {});
  const now = dateOnly(new Date())!;
  return {
    generatedAt: new Date(),
    metrics: {
      audits: { open: auditRows.filter((x) => !auditIsComplete(x.workflowState)).length, closed: auditRows.filter((x) => auditIsComplete(x.workflowState)).length },
      findingsByClassification: countBy(findingRows, "classification"),
      carStatus: countBy(carRows, "workflowState"),
      overdueCars: carRows.filter((x) => x.workflowState !== "closed" && (x.extensionDueDate ?? x.dueDate) && (x.extensionDueDate ?? x.dueDate)! < now).length,
      openFindings: findingRows.filter((x) => !["Closed", "Verified"].includes(x.status)).length,
    },
    series: Object.entries(countBy(findingRows, "classification")).map(([classification, count]) => ({ classification, count })),
  };
}
router.get("/dashboard", asyncHandler(async (req, res) => res.json(await dashboardData(req, req.query.projectId ? String(req.query.projectId) : undefined))));
router.get("/reports/open-vs-closed", asyncHandler(async (req, res) => {
  const report = await dashboardData(req, req.query.projectId ? String(req.query.projectId) : undefined, "reports");
  const rows = Object.entries(report.metrics.audits as AnyRow).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "audit-open-vs-closed", rows)) res.json(report);
}));
router.get("/reports/findings-log", asyncHandler(async (req, res) => {
  const { page, limit } = pagination(req);
  const { findingRows } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined, "reports");
  const sorted = findingRows.sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
  const result = sorted.slice((page - 1) * limit, page * limit).map(findingDto);
  if (!maybeCsv(req, res, "audit-findings-log", result)) res.json(paginated(result, sorted.length, page, limit));
}));
router.get("/reports/ageing", asyncHandler(async (req, res) => {
  const { findingRows: findings, carRows: cars } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined, "reports");
  const bucket = (createdAt: Date) => { const days = Math.floor((Date.now() - createdAt.valueOf()) / 86400000); return days <= 15 ? "0-15" : days <= 45 ? "16-45" : ">45"; };
  const rows = [...findings.map((x) => ({ type: "finding", bucket: bucket(x.createdAt), id: x.id })), ...cars.map((x) => ({ type: "CAR", bucket: bucket(x.createdAt), id: x.id }))];
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [`${x.type}:${x.bucket}`]: (out[`${x.type}:${x.bucket}`] ?? 0) + 1 }), {});
  if (!maybeCsv(req, res, "audit-ageing", rows)) res.json({ generatedAt: new Date(), metrics, series: rows });
}));
router.get("/reports/car-status", asyncHandler(async (req, res) => {
  const { carRows: rows } = await scopedAuditData(req, req.query.projectId ? String(req.query.projectId) : undefined, "reports");
  const metrics = rows.reduce((out: AnyRow, x) => ({ ...out, [x.workflowState]: (out[x.workflowState] ?? 0) + 1 }), {});
  const series = Object.entries(metrics).map(([status, count]) => ({ status, count }));
  if (!maybeCsv(req, res, "car-status", series)) res.json({ generatedAt: new Date(), metrics, series });
}));
router.get("/reports/schedule", asyncHandler(async (req, res) => {
  const all = await db.select().from(auditSchedules).where(active(auditSchedules, actor(req).organizationId)).orderBy(desc(auditSchedules.year));
  const scope = await getAuthorizedProjectScope(req, "audit", { module: "schedules", action: "select" });
  const scoped = all.filter((row) => {
    const ids = scheduleMeta(row).projectIds ?? (row.projectId ? [row.projectId] : []);
    return scope.unrestricted || (ids.length > 0 && ids.every((id) => scope.projectIds.includes(id)));
  });
  const rows = scoped.map(row => scheduleDto(row));
  if (!maybeCsv(req, res, "annual-audit-schedule", rows)) res.json(paginated(rows, rows.length, 1, Math.max(1, rows.length)));
}));
async function consolidatedReport(req: Request) {
  const [audit] = await db.select().from(audits).where(and(active(audits, actor(req).organizationId), eq(audits.id, String(req.params.id))));
  if (!audit) throw new HttpError(404, "Audit not found");
  if (!auditIsComplete(audit.workflowState)) throw new HttpError(409, "Mark the audit Complete before viewing or downloading its report.");
  const [plan] = audit.auditPlanId ? await db.select().from(auditPlans).where(and(active(auditPlans, actor(req).organizationId), eq(auditPlans.id, audit.auditPlanId))) : [];
  // The router-wide parent-chain guard already handles both project and
  // department-scoped Internal Process audits.
  const findings = await db.select().from(auditFindings).where(and(active(auditFindings, actor(req).organizationId), eq(auditFindings.auditId, audit.id)));
  const cars = findings.length ? await db.select().from(correctiveActionReports).where(and(active(correctiveActionReports, actor(req).organizationId), inArray(correctiveActionReports.auditFindingId, findings.map((x) => x.id)))) : [];
  const [schedule] = plan?.auditScheduleId ? await db.select().from(auditSchedules).where(and(
    active(auditSchedules, actor(req).organizationId), eq(auditSchedules.id, plan.auditScheduleId))) : [];
  const [project] = audit.projectId ? await db.select().from(projects).where(and(
    active(projects, actor(req).organizationId), eq(projects.id, audit.projectId))) : [];
  const evidence = await db.select().from(auditEvidenceFiles).where(and(
    active(auditEvidenceFiles, actor(req).organizationId), inArray(auditEvidenceFiles.recordType, ["audit", "audit_execution"]),
    eq(auditEvidenceFiles.recordId, audit.id), eq(auditEvidenceFiles.status, "stored")));
  const mappedAudit = auditDto(audit);
  const meta = plan ? planMeta(plan) : null;
  // The generic Plan DTO uses epoch placeholders for missing dates and aliases
  // Audit Types as legacy criteria. Neither is factual consolidated report data.
  const mappedPlan = plan ? {
    ...planDto(plan),
    startDateTime: meta?.startDateTime || plan.auditDate || null,
    endDateTime: meta?.endDateTime || plan.auditDate || null,
    activities: planDto(plan).activities,
    criteria: scheduleMeta(schedule ?? {}).qaqcClauses ? [scheduleMeta(schedule ?? {}).qaqcClauses]
      : !meta?.auditTypes ? parseJson(plan.criteria, plan.criteria ? [plan.criteria] : []) : [],
  } : null;
  const userIds = [...new Set([
    mappedPlan?.leadAuditorId, ...(mappedPlan?.teamMemberIds ?? []), ...(mappedPlan?.processOwnerIds ?? []),
    ...(mappedPlan?.activities ?? []).flatMap(row => row.auditeeIds ?? [row.auditeeId]),
    ...(auditMeta(audit).openingMeeting?.attendees ?? []), ...(auditMeta(audit).closingMeeting?.attendees ?? []), ...cars.map(c => c.ownerId),
  ].filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const nameRows = userIds.length ? await db.select({ id: users.id, name: users.fullName, designation: users.designation }).from(users).where(and(
    eq(users.organizationId, actor(req).organizationId), inArray(users.id, userIds), isNull(users.deletedAt))) : [];
  const roleIds = mappedPlan?.auditeeRoleIds ?? [];
  const roleRows = roleIds.length ? await db.select({ id: auditWorkspaceRoles.id, name: auditWorkspaceRoles.name }).from(auditWorkspaceRoles).where(and(
    active(auditWorkspaceRoles, actor(req).organizationId), inArray(auditWorkspaceRoles.id, roleIds))) : [];
  const sections = buildConsolidatedAuditReport({
    audit: { ...mappedAudit, referenceNumber: audit.referenceNumber }, plan: mappedPlan, project,
    schedule: schedule ? { ...scheduleMeta(schedule), department: scheduleMeta(schedule).departmentProject } : null,
    legacyFindings: findings.filter(row => !(row.evidence as AnyRow)?.sourceChecklistItemId).map(findingDto), cars: cars.map(carDto), evidence,
    names: new Map(nameRows.map(u => [u.id, [u.name, u.designation].filter(Boolean).join(" / ")])),
    roleNames: new Map(roleRows.map(r => [r.id, r.name])),
  });
  return { audit, mappedAudit, plan, findings, cars, sections, evidence };
}
router.get("/audits/:id/report", asyncHandler(async (req, res) => {
  const { audit, plan, findings, cars, sections } = await consolidatedReport(req);
  const payload = { audit: auditDto(audit), plan: plan ? planDto(plan) : null, findings: findings.filter(row => !(row.evidence as AnyRow)?.sourceChecklistItemId).map(findingDto), cars: cars.map(carDto), generatedAt: new Date(), downloadUrl: null };
  if (!maybeCsv(req, res, `audit-${audit.referenceNumber}`, sections.flatMap(s => [
    ...s.fields.map(f => ({ section: s.title, field: f.label, value: f.value })),
    ...s.tables.flatMap(t => t.rows.map(row => ({ section: s.title, field: t.title, value: t.columns.map((column, i) => `${column}: ${row[i] ?? ""}`).join(" | ") }))),
  ]))) res.json({ ...payload, sections });
}));
router.get("/audits/:id/report/pptx", asyncHandler(async (req, res) => {
  const report = await consolidatedReport(req);
  // The legacy DTO defaults a missing due date to creation time. That is not
  // a real deadline; this export must use the stored date/approved extension.
  const tracker = report.sections.find(s => s.key === "corrective-actions")?.tables[0];
  const reviewers = [...new Set(report.cars.map(car => carMeta(car).reviewedBy).filter((id): id is string => !!id))];
  const reviewerRows = reviewers.length ? await db.select({ id: users.id, name: users.fullName }).from(users).where(and(
    eq(users.organizationId, actor(req).organizationId), inArray(users.id, reviewers), isNull(users.deletedAt))) : [];
  const date = (value?: string | Date | null) => value ? formatDateInTimeZone(value, "Asia/Riyadh") : "To be mapped";
  tracker?.rows.forEach((row, i) => {
    const car = report.cars[i]!;
    const meta = carMeta(car);
    row[5] = date(car.extensionStatus === "approved" && car.extensionDueDate ? car.extensionDueDate : car.dueDate);
    row[7] = meta.reviewedAt && (meta.reviewOutcome === "accept" || car.workflowState === "closed" || car.workflowState === "accepted")
      ? `${reviewerRows.find(u => u.id === meta.reviewedBy)?.name || "To be mapped"} / ${date(meta.reviewedAt)}`
      : "To be mapped";
  });
  const images = new Map<string, Uint8Array>();
  for (const photo of report.sections.flatMap(s => s.photos)) {
    const file = report.evidence.find(f => f.id === photo.id)!;
    try {
      let bytes: Buffer;
      if (file.storageKey.startsWith("gcs:")) {
        const object = await getObject(file.storageKey.slice(4));
        if (Number(object.headers.get("content-length") ?? 0) > 20_000_000) throw new Error("Image exceeds report size limit");
        bytes = Buffer.from(await object.arrayBuffer());
      } else {
        const localKey = file.storageKey.replace(/^local:/, "");
        if (localKey !== `audit/${file.id}`) throw new Error("Unsupported legacy evidence key");
        bytes = await readFile(path.resolve(process.cwd(), "uploads", localKey.replace("/", "-")));
      }
      if (bytes.length > 20_000_000) throw new Error("Image exceeds report size limit");
      // Fit to the original template rectangle without distorting photographs.
      images.set(photo.id, await sharp(bytes, { limitInputPixels: 16_000_000 })
        .resize({ width: 1442, height: 800, fit: "contain", background: "#F3EEFA" }).png().toBuffer());
    } catch {
      throw new HttpError(502, `Could not load photograph "${photo.fileName}". Please retry the PowerPoint download.`);
    }
  }
  const bytes = await renderConsolidatedAuditPptx({ sections: report.sections, photos: images });
  res.setHeader("Content-Type", AUDIT_PPTX_MIME);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="audit-report-${report.audit.id}.pptx"`);
  res.send(bytes);
}));
router.get("/audits/:id/report/pdf", asyncHandler(async (req, res) => {
  const report = await consolidatedReport(req);
  const images = new Map<string, Uint8Array>();
  for (const photo of report.sections.flatMap(s => s.photos)) {
    const file = report.evidence.find(f => f.id === photo.id)!;
    try {
      let bytes: Buffer;
      if (file.storageKey.startsWith("gcs:")) {
        const object = await getObject(file.storageKey.slice(4));
        if (Number(object.headers.get("content-length") ?? 0) > 20_000_000) throw new Error("Image exceeds report size limit");
        bytes = Buffer.from(await object.arrayBuffer());
      } else {
        // Legacy evidence uses the same upload layout as the authenticated files route.
        const localKey = file.storageKey.replace(/^local:/, "");
        if (localKey !== `audit/${file.id}`) throw new Error("Unsupported legacy evidence key");
        bytes = await readFile(path.resolve(process.cwd(), "uploads", localKey.replace("/", "-")));
      }
      if (bytes.length > 20_000_000) throw new Error("Image exceeds report size limit");
      images.set(photo.id, await sharp(bytes, { limitInputPixels: 16_000_000 }).resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true }).png().toBuffer());
    } catch {
      throw new HttpError(502, `Could not load photograph "${photo.fileName}". Please retry the PDF download.`);
    }
  }
  const bytes = await renderConsolidatedAuditPdf({
    title: report.mappedAudit.title, reference: report.audit.referenceNumber, sections: report.sections, photos: images,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename="audit-report-${report.audit.id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

router.get("/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(actor(req).organizationId, "audit"));
}));

router.use("/admin", requireAuditAdmin);
router.get("/admin/schedule-numbering", asyncHandler(async (req, res) => {
  res.json(await getScheduleNumbering(actor(req).organizationId));
}));
router.put("/admin/schedule-numbering", asyncHandler(async (req, res) => {
  const config = body<ScheduleNumbering>(Api.UpdateAuditScheduleNumberingBody, req);
  for (const range of [config.qaqcReference, config.auditNumber]) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end < range.start || !range.prefix.trim()) {
      throw new HttpError(422, "Use a prefix and a valid whole-number range from 1 to 999");
    }
  }
  if (config.qaqcReference.start !== 1) throw new HttpError(422, "QA/QC Reference must always start at 001");
  const saved = await db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, actor(req).organizationId);
    const map = { ...(settings.documentNumbering as Record<string, unknown> ?? {}), audit_schedule_fields: config };
    await tx.update(organizationSettings).set({ documentNumbering: map as unknown as typeof settings.documentNumbering, updatedAt: new Date() })
      .where(eq(organizationSettings.id, settings.id));
    return config;
  });
  await auditLog(req, "update_schedule_numbering", "organization_settings", actor(req).organizationId, undefined, saved);
  res.json(saved);
}));
router.get("/admin/field-controls", asyncHandler(async (req, res) => {
  res.json(await readFieldControls(actor(req).organizationId, "audit"));
}));
router.put("/admin/field-controls", asyncHandler(async (req, res) => {
  const data = body<FieldControlsMatrix>(Api.UpdateAuditAdminFieldControlsBody, req);
  assertKnownFieldControlKeys("audit", data);
  const before = await writeFieldControls(actor(req).organizationId, "audit", data);
  await auditLog(req, "update", "field_controls", actor(req).organizationId, before, data);
  res.json(data);
}));
async function auditRoleResponse(role: AnyRow) {
  const permissions = await db.select({ key: auditPermissions.key, name: auditPermissions.label })
    .from(auditWorkspaceRolePermissions)
    .innerJoin(auditPermissions, eq(auditWorkspaceRolePermissions.permissionId, auditPermissions.id))
    .where(and(
      eq(auditWorkspaceRolePermissions.organizationId, role.organizationId),
      eq(auditWorkspaceRolePermissions.workspaceRoleId, role.id),
      isNull(auditWorkspaceRolePermissions.deletedAt),
      isNull(auditPermissions.deletedAt),
    ));
  return { id: role.id, name: role.name, description: role.description, roleAuthorizationLevel: role.roleAuthorizationLevel, permissions, active: role.status === "active", systemDefault: role.isSystem };
}
function auditRoleAuthorizationLevel(data: AnyRow): number | null {
  const catalog = new Set(auditModulePermissionCatalog.map(permission => permission.key));
  if (data.permissions.some((permission: { key: string }) => permission.key.startsWith("audit.") && !catalog.has(permission.key))) {
    throw new HttpError(422, "Unsupported Audit module permission");
  }
  if (!data.permissions.some((permission: { key: string }) =>
    ["approve_reject", "schedules.approve_reject", "audit.schedules.approve_reject"].includes(permission.key))) return null;
  const level = data.roleAuthorizationLevel;
  if (!Number.isInteger(level) || level < 1 || level > 2147483647) {
    throw new HttpError(422, "Approval Level must be a positive whole number when Approve / reject is selected");
  }
  return level;
}
async function syncAuditRolePermissions(req: Request, roleId: string, requested: Array<{ key: string; name: string }>) {
  const catalog = new Map(auditModulePermissionCatalog.map(permission => [permission.key, permission.name]));
  if (requested.some(permission => permission.key.startsWith("audit.") && !catalog.has(permission.key))) {
    throw new HttpError(422, "Unsupported Audit module permission");
  }
  const organizationId = actor(req).organizationId;
  await db.update(auditWorkspaceRolePermissions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(auditWorkspaceRolePermissions.organizationId, organizationId),
      eq(auditWorkspaceRolePermissions.workspaceRoleId, roleId),
      isNull(auditWorkspaceRolePermissions.deletedAt),
    ));
  const uniquePermissions = [...new Map(requested.map((permission) => [permission.key, permission])).values()];
  for (const requestedPermission of uniquePermissions) {
    let [permission] = await db.select().from(auditPermissions).where(and(
      eq(auditPermissions.organizationId, organizationId),
      eq(auditPermissions.key, requestedPermission.key),
      isNull(auditPermissions.deletedAt),
    )).limit(1);
    if (!permission) {
      [permission] = await db.insert(auditPermissions).values({
        organizationId,
        key: requestedPermission.key,
        label: catalog.get(requestedPermission.key) ?? requestedPermission.name,
        category: "audit",
      }).returning();
    }
    await db.insert(auditWorkspaceRolePermissions).values({ organizationId, workspaceRoleId: roleId, permissionId: permission.id });
  }
}
router.get("/admin/roles", asyncHandler(async (req, res) => {
  await backfillLegacyApprovalLevels(actor(req).organizationId);
  const { page, limit, offset } = pagination(req); const where = active(auditWorkspaceRoles, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditWorkspaceRoles).where(where).orderBy(asc(auditWorkspaceRoles.name)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditWorkspaceRoles).where(where),
  ]);
  res.json(paginated(await Promise.all(rows.map(auditRoleResponse)), Number(count), page, limit));
}));
router.post("/admin/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.CreateAuditRoleBody, req);
  const roleAuthorizationLevel = auditRoleAuthorizationLevel(data);
  try {
    const [row] = await db.insert(auditWorkspaceRoles).values({ id: data.id, organizationId: actor(req).organizationId, name: data.name, description: data.description, roleAuthorizationLevel, isSystem: data.systemDefault ?? false, status: data.active ? "active" : "inactive" }).returning();
    await syncAuditRolePermissions(req, row.id, data.permissions);
    await auditLog(req, "create", "workspace_role", row.id, undefined, row); res.status(201).json(await auditRoleResponse(row));
  } catch (error: any) { if (error?.code === "23505") throw new HttpError(409, "Role name already exists"); throw error; }
}));
router.put("/admin/roles/:id", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateAuditRoleBody, req);
  const roleAuthorizationLevel = auditRoleAuthorizationLevel(data);
  const [before] = await db.select().from(auditWorkspaceRoles).where(and(active(auditWorkspaceRoles, actor(req).organizationId), eq(auditWorkspaceRoles.id, String(req.params.id))));
  if (!before) throw new HttpError(404, "Role not found");
  const [row] = await db.update(auditWorkspaceRoles).set({ name: data.name, description: data.description, roleAuthorizationLevel, status: data.active ? "active" : "inactive", updatedAt: new Date() }).where(eq(auditWorkspaceRoles.id, before.id)).returning();
  await syncAuditRolePermissions(req, row.id, data.permissions);
  await auditLog(req, "update", "workspace_role", row.id, before, row); res.json(await auditRoleResponse(row));
}));
router.get("/admin/users", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = and(eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt));
  const [allRows, allAssignments, availablePlatformRoles] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.username)),
    db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), isNull(auditUserWorkspaceRoles.deletedAt))),
    db.select({ id: platformRoles.id, name: platformRoles.name }).from(platformRoles).where(and(eq(platformRoles.organizationId, actor(req).organizationId), isNull(platformRoles.deletedAt))),
  ]);
  const visibleRows = await visibleAdminUsers(req, allRows, allAssignments);
  const rows = visibleRows.slice(offset, offset + limit);
  const assignments = rows.length ? await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), inArray(auditUserWorkspaceRoles.userId, rows.map((x) => x.id)), isNull(auditUserWorkspaceRoles.deletedAt))) : [];
  const visibleAssignments = assignments.filter((assignment) => canManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds));
  const roles = visibleAssignments.length ? await db.select().from(auditWorkspaceRoles).where(inArray(auditWorkspaceRoles.id, visibleAssignments.map((x) => x.workspaceRoleId))) : [];
  res.json(paginated(rows.map((x) => ({
    id: x.id, username: x.username, fullName: x.fullName, email: x.email, designation: x.designation,
    signatureUrl: x.signaturePath ? `/api/audit/admin/users/${x.id}/signature` : null,
    platformRole: availablePlatformRoles.find((role) => role.id === x.platformRoleId)?.name ?? "Employee",
    workspaceRoles: roles.filter((role) => visibleAssignments.some((a) => a.userId === x.id && a.workspaceRoleId === role.id)).map((role) => {
      const assignment = visibleAssignments.find((a) => a.userId === x.id && a.workspaceRoleId === role.id)!;
      return { id: role.id, name: role.name, description: role.description, permissions: [], active: role.status === "active", systemDefault: role.isSystem, scopeType: assignment.projectIds?.length ? "project" as const : "organization" as const, scopeIds: assignment.projectIds ?? [] };
    }),
    status: x.accessStatus === "active" ? "Active" : x.accessStatus === "deactivated" ? "Deactivated" : "Not Requested", lastAccessAt: x.lastAccessAt,
  })), visibleRows.length, page, limit));
}));
router.put("/admin/users/:userId/profile", requireAuditAdmin, asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.UpdateLessonsUserProfileBody, req);
  const [target] = await db.select().from(users).where(and(
    eq(users.id, String(req.params.userId)), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt),
  )).limit(1);
  if (!target) throw new HttpError(404, "User not found");
  await assertAuditUserManagementScope(req, target.id);
  let signaturePath = target.signaturePath;
  if (data.signatureDataUrl) {
    if (data.signatureDataUrl.length > 720 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(data.signatureDataUrl);
    if (!match) throw new HttpError(422, "Signature must be a PNG, JPEG or WebP image");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]!)) {
      throw new HttpError(422, "Signature image must contain valid base64 data");
    }
    const bytes = Buffer.from(match[2]!, "base64");
    if (bytes.length > 512 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
    if (!bytes.length || bytes.toString("base64") !== match[2]) throw new HttpError(422, "Signature image must contain valid base64 data");
    await validateSignatureImage(bytes, match[1]!);
    signaturePath = `gcs:${await storeObject(`qms360/signatures/${target.id}`, bytes, match[1]!)}`;
  } else if (data.signatureDataUrl === null) {
    signaturePath = null;
  }
  const [row] = await db.update(users).set({
    designation: data.designation === undefined ? target.designation : (data.designation?.trim() || null),
    signaturePath, updatedAt: new Date(),
  }).where(eq(users.id, target.id)).returning();
  await auditLog(req, "update", "user_profile", row!.id,
    { designation: target.designation, hasSignature: Boolean(target.signaturePath) },
    { designation: row!.designation, hasSignature: Boolean(row!.signaturePath) });
  res.json({ id: row!.id, designation: row!.designation, signatureUrl: row!.signaturePath ? `/api/audit/admin/users/${row!.id}/signature` : null });
}));
router.get("/admin/users/:userId/signature", requireAuditAdmin, asyncHandler(async (req, res) => {
  const [target] = await db.select({ signaturePath: users.signaturePath }).from(users).where(and(
    eq(users.id, String(req.params.userId)), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt),
  )).limit(1);
  if (!target) throw new HttpError(404, "User not found");
  await assertAuditUserManagementScope(req, String(req.params.userId));
  if (!target.signaturePath) throw new HttpError(404, "Signature not found");
  const signaturePath = target.signaturePath;
  const object = await getObject(signaturePath.startsWith("gcs:") ? signaturePath.slice(4) : signaturePath);
  res.setHeader("content-type", object.headers.get("content-type") ?? "image/png");
  res.setHeader("cache-control", "private, max-age=60");
  const { Readable } = await import("node:stream");
  Readable.fromWeb(object.body as any).pipe(res);
}));
router.post("/admin/users/:userId/roles", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.AssignAuditUserRoleBody, req);
  const [user, role] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, String(req.params.userId)), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt))).then((x) => x[0]),
    db.select().from(auditWorkspaceRoles).where(and(eq(auditWorkspaceRoles.id, data.roleId), active(auditWorkspaceRoles, actor(req).organizationId))).then((x) => x[0]),
  ]);
  if (!user || !role) throw new HttpError(404, !user ? "User not found" : "Role not found");
  const [existing] = await db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.userId, user.id), eq(auditUserWorkspaceRoles.workspaceRoleId, role.id), isNull(auditUserWorkspaceRoles.deletedAt)));
  if (data.scopeType === "business_unit") throw new HttpError(422, "Business-unit scope is not supported; choose organization or project");
  const values = { organizationId: actor(req).organizationId, userId: user.id, workspaceRoleId: role.id, projectIds: data.scopeType === "project" ? await assertProjectScopeInOrg(db, actor(req).organizationId, data.scopeIds) : [], businessUnitIds: [], status: "active", updatedAt: new Date() };
  assertCanManageAssignmentScope(req, values.projectIds, values.businessUnitIds);
  const row = await db.transaction(async tx => {
    const [assigned] = existing
      ? await tx.update(auditUserWorkspaceRoles).set(values).where(eq(auditUserWorkspaceRoles.id, existing.id)).returning()
      : await tx.insert(auditUserWorkspaceRoles).values(values).returning();
    // Role assignment and the renewed request must commit together. A role
    // never grants application access: only an approval can set canOpenAudit.
    const accessRows = await tx.select().from(applicationAccess).where(and(
      eq(applicationAccess.organizationId, actor(req).organizationId),
      eq(applicationAccess.username, user.username),
      isNull(applicationAccess.deletedAt),
    ));
    if (!accessRows.some(access => access.canOpenAudit)) {
      for (const access of accessRows) {
        await writeAuditLog(tx, "audit", {
          organizationId: actor(req).organizationId, actorId: actor(req).id,
          action: "request_access", entityType: "application_access", entityId: access.id,
          after: { userId: user.id, roleId: role.id }, ipAddress: req.ip,
        }, { dispatch: false });
      }
    }
    return assigned;
  });
  await auditLog(req, "assign_role", "user_workspace_role", row.id, existing, row); res.json(row);
}));
router.delete("/admin/users/:userId/roles/:id", asyncHandler(async (req, res) => {
  const userId = String(req.params.userId);
  const roleId = String(req.params.id);
  const [user, assignment] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor(req).organizationId), isNull(users.deletedAt))).then((x) => x[0]),
    db.select().from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), eq(auditUserWorkspaceRoles.userId, userId), eq(auditUserWorkspaceRoles.workspaceRoleId, roleId), isNull(auditUserWorkspaceRoles.deletedAt))).then((x) => x[0]),
  ]);
  if (!user || !assignment) throw new HttpError(404, "Role assignment not found");
  assertCanManageAssignmentScope(req, assignment.projectIds, assignment.businessUnitIds);
  const now = new Date();
  await db.update(auditUserWorkspaceRoles).set({ deletedAt: now, status: "deleted", updatedAt: now }).where(eq(auditUserWorkspaceRoles.id, assignment.id));
  const remaining = await db.select({ id: auditUserWorkspaceRoles.id }).from(auditUserWorkspaceRoles).where(and(eq(auditUserWorkspaceRoles.organizationId, actor(req).organizationId), eq(auditUserWorkspaceRoles.userId, userId), isNull(auditUserWorkspaceRoles.deletedAt))).limit(1);
  if (!remaining.length) await db.update(applicationAccess).set({ canOpenAudit: false, updatedAt: now }).where(and(eq(applicationAccess.organizationId, actor(req).organizationId), eq(applicationAccess.username, user.username), isNull(applicationAccess.deletedAt)));
  await auditLog(req, "remove_role", "user_workspace_role", assignment.id, assignment, { userId, roleId });
  res.status(204).end();
}));

router.get("/admin/access-queue", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const organizationId = actor(req).organizationId;
  const pending = await loadPendingApplicationRequestPage(req, "audit", offset, limit);
  const usernames = pending.items.map(row => row.username);
  const orgUsers = usernames.length ? await db.select().from(users).where(and(eq(users.organizationId, organizationId),
    isNull(users.deletedAt), inArray(users.username, usernames))) : [];
  const byUsername = activeUserIdentityByUsername(orgUsers, organizationId);
  res.json(paginated(pending.items.map(r => ({
    id: r.id, ...accessRequestIdentity(r.username, byUsername), requestedRoleId: r.requestedRoleId,
    status: "pending", requestedAt: r.requestedAt,
  })), pending.total, page, limit));
}));
router.post("/admin/access-queue/:id/decision", asyncHandler(async (req, res) => {
  const data = body<AnyRow>(Api.DecideAuditAccessRequestBody, req);
  res.json(await decideApplicationAccess(req, "audit", data.decision, data.comments));
}));
const delegationDto = (x: AnyRow, peopleById = new Map<string, AnyRow>()) => {
  const personFields = (prefix: "delegator" | "delegate", userId: string) => {
    const person = peopleById.get(userId);
    return {
      [`${prefix}FullName`]: person?.fullName ?? null,
      [`${prefix}Username`]: person?.username ?? null,
      [`${prefix}Email`]: person?.email ?? null,
      [`${prefix}UserStatus`]: person
        ? person.accessStatus === "active" && !person.deletedAt ? "active" : "deactivated"
        : "unavailable",
    };
  };
  return ({
    id: x.id, delegatorId: x.delegatorId, delegateId: x.delegateId,
    ...personFields("delegator", x.delegatorId), ...personFields("delegate", x.delegateId),
    scope: typeof x.scope?.scope === "string" ? x.scope.scope : "audit",
    approvalTypes: x.scope?.approvalTypes ?? [], startDate: x.startsAt, endDate: x.endsAt,
    status: x.status === "active" && x.endsAt < new Date() ? "expired" : x.status, revokedAt: x.deletedAt,
  });
};
router.get("/admin/delegations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req); const where = active(auditDelegations, actor(req).organizationId);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditDelegations).where(where).orderBy(desc(auditDelegations.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditDelegations).where(where),
  ]);
  const userIds = [...new Set(rows.flatMap((row) => [row.delegatorId, row.delegateId]))];
  const people = userIds.length
    ? await db.select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
        accessStatus: users.accessStatus,
        deletedAt: users.deletedAt,
      }).from(users).where(and(eq(users.organizationId, actor(req).organizationId), inArray(users.id, userIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));
  res.json(paginated(rows.map((row) => delegationDto(row, peopleById)), Number(count), page, limit));
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
const ruleDto = (x: AnyRow, staffed?: Set<string>) => {
  const recipientRoles = (x.configuration?.recipientRoles ?? String(x.recipientRole ?? "").split(",").map((v: string) => v.trim()).filter(Boolean)) as string[];
  const ccRecipientRoles = Array.isArray(x.configuration?.ccRecipientRoles) ? x.configuration.ccRecipientRoles.filter((name: unknown): name is string => typeof name === "string") : [];
  return {
    id: x.id, triggerType: x.triggerKey, priority: x.priority, level: x.configuration?.level ?? null,
    slaWorkingDays: x.slaWorkingDays, recipientRoles, ccRecipientRoles,
    unstaffedRoles: staffed ? recipientRoles.filter((n) => !staffed.has(n)) : undefined,
    unstaffedCcRoles: staffed ? ccRecipientRoles.filter((n: string) => !staffed.has(n)) : undefined,
    repeatCadenceDays: x.repeatCadenceDays ?? 1, enabled: x.status === "active",
  };
};
// Open/resolved escalation instances for dashboard surfacing — mirrors the
// lessons module's GET /lessons/escalations shape (EscalationSummary).
router.get("/escalations", asyncHandler(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const findingScope = await getAuthorizedProjectScope(req, "audit", { module: "findings", action: "select" });
  const carScope = await getAuthorizedProjectScope(req, "audit", { module: "cars", action: "select" });
  const findingIds = findingScope.unrestricted ? [] : await db.select({ id: auditFindings.id }).from(auditFindings)
    .innerJoin(audits, eq(auditFindings.auditId, audits.id))
    .where(and(
      eq(auditFindings.organizationId, actor(req).organizationId),
      eq(audits.organizationId, actor(req).organizationId),
      await auditProjectCondition(req, findingScope),
      isNull(auditFindings.deletedAt),
      isNull(audits.deletedAt),
    ));
  const carFindingIds = carScope.unrestricted ? [] : await db.select({ id: auditFindings.id }).from(auditFindings)
    .innerJoin(audits, eq(auditFindings.auditId, audits.id))
    .where(and(
      eq(auditFindings.organizationId, actor(req).organizationId),
      eq(audits.organizationId, actor(req).organizationId),
      await auditProjectCondition(req, carScope),
      isNull(auditFindings.deletedAt),
      isNull(audits.deletedAt),
    ));
  const carIds = carScope.unrestricted ? [] : await db.select({ id: correctiveActionReports.id }).from(correctiveActionReports).where(and(
    eq(correctiveActionReports.organizationId, actor(req).organizationId),
    inArray(correctiveActionReports.auditFindingId, carFindingIds.map((row) => row.id)),
    isNull(correctiveActionReports.deletedAt),
  ));
  const where = and(
    eq(auditEscalationInstances.organizationId, actor(req).organizationId),
    isNull(auditEscalationInstances.deletedAt),
    or(
      findingScope.unrestricted
        ? eq(auditEscalationInstances.recordType, "audit_finding")
        : and(eq(auditEscalationInstances.recordType, "audit_finding"), inArray(auditEscalationInstances.recordId, findingIds.map((row) => row.id))),
      carScope.unrestricted
        ? eq(auditEscalationInstances.recordType, "corrective_action")
        : and(eq(auditEscalationInstances.recordType, "corrective_action"), inArray(auditEscalationInstances.recordId, carIds.map((row) => row.id))),
    ),
  );
  const [rows, count, rules] = await Promise.all([
    db.select().from(auditEscalationInstances).where(where).orderBy(desc(auditEscalationInstances.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditEscalationInstances).where(where),
    db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId)),
  ]);
  res.json(paginated(rows.map((row) => {
    const rule = rules.find((r) => r.id === row.ruleId);
    return { id: row.id, recordType: row.recordType, recordId: row.recordId, priority: rule?.priority ?? "P1", level: row.currentLevel ?? String((rule?.configuration as any)?.level ?? "P1"), dueAt: row.breachedAt ?? new Date(row.startedAt.getTime() + (rule?.slaWorkingDays ?? 0) * 86400000), status: row.status, lastNotifiedAt: row.breachedAt };
  }), Number(count[0]?.count ?? 0), page, limit));
}));
router.get("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const [rows, staffed] = await Promise.all([
    db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId)).orderBy(asc(auditEscalationRules.priority)),
    staffedRoleNames(actor(req).organizationId, auditWorkspaceRoles, auditUserWorkspaceRoles),
  ]);
  res.json(paginated(rows.map((r) => ruleDto(r, staffed)), rows.length, 1, Math.max(1, rows.length)));
}));
router.put("/admin/escalation-rules", asyncHandler(async (req, res) => {
  const data = body<AnyRow[]>(Api.UpdateAuditEscalationRulesBody, req);
  const before = await db.select().from(auditEscalationRules).where(active(auditEscalationRules, actor(req).organizationId));
  await db.update(auditEscalationRules).set({ deletedAt: new Date(), updatedAt: new Date() }).where(active(auditEscalationRules, actor(req).organizationId));
  const rows = data.length ? await db.insert(auditEscalationRules).values(data.map((x) => ({
    id: x.id, organizationId: actor(req).organizationId, triggerKey: x.triggerType, priority: x.priority,
    slaWorkingDays: x.slaWorkingDays, recipientRole: x.recipientRoles[0] ?? "Quality Manager",
    repeatCadenceDays: x.repeatCadenceDays, configuration: { level: x.level, recipientRoles: x.recipientRoles, ccRecipientRoles: x.ccRecipientRoles ?? [] },
    status: x.enabled ? "active" : "inactive",
  }))).returning() : [];
  await auditLog(req, "replace", "escalation_rules", rows[0]?.id ?? actor(req).id, { rules: before }, { rules: rows });
  res.json(paginated(rows.map((x) => ruleDto(x)), rows.length, 1, Math.max(1, rows.length)));
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
  const { page, limit } = pagination(req);
  const rows = await listNotifications(db, "audit", actor(req).organizationId, actor(req).id);
  res.json(paginated(rows.slice((page - 1) * limit, page * limit).map((x) => ({ id: x.id, type: "audit", title: x.title, message: x.body, critical: false, read: Boolean(x.readAt), recordType: x.recordType, recordId: x.recordId, createdAt: x.createdAt, readAt: x.readAt })), rows.length, page, limit));
}));
router.post("/notifications/:id/read", asyncHandler(async (req, res) => {
  const [row] = await db.update(auditNotifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(active(auditNotifications, actor(req).organizationId), eq(auditNotifications.id, String(req.params.id)), eq(auditNotifications.recipientId, actor(req).id))).returning();
  if (!row) throw new HttpError(404, "Notification not found"); res.status(204).end();
}));

export default router;