import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, moduleFieldSettings } from "@workspace/db";
import { HttpError, type AppKey } from "./workspace";

// Catalog of user-controllable form fields per module. This is the single
// source of truth: the admin settings UI renders it (via GET
// /platform/field-settings) and create/update handlers enforce read-only
// entries against it. Field keys must match the API create/update body keys.
//
// `createDefault` is the value the module's create form submits when the user
// has not touched the field; "current-month"/"today" resolve dynamically.
// On create, a read-only field is only rejected when the submitted value
// differs from this default. On update, a read-only field is rejected when the
// submitted value differs from the value currently stored on the record.
// `serverManaged` marks fields the API never persists from the request body
// (UI-only read-only control; enforcement is unnecessary).
export type CatalogField = {
  fieldKey: string;
  label: string;
  createDefault?: unknown;
  serverManaged?: boolean;
};

export type CatalogForm = { formKey: string; label: string; fields: CatalogField[] };

const f = (fieldKey: string, label: string, createDefault?: unknown, serverManaged?: boolean): CatalogField => ({
  fieldKey, label, createDefault, serverManaged,
});

export const FIELD_CATALOG: Record<AppKey, CatalogForm[]> = {
  lessons: [
    {
      formKey: "lesson-form",
      label: "Lesson learned form",
      fields: [
        f("projectId", "Project", ""),
        f("title", "Title", ""),
        f("disciplineId", "Discipline", ""),
        f("categorisationId", "Categorisation", ""),
        f("capturedAt", "Captured at"),
        f("issueCategory", "Issue category", "Minor"),
        f("impact", "Impact", "Positive"),
        f("description", "Description", ""),
        f("reference", "Reference", ""),
        f("isRepeatedIssue", "Repeated issue", false),
        f("repeatCount", "Repeat count", 0),
        f("repeatLocation", "Repeat location", ""),
        f("rootCause", "Root cause", ""),
        f("correction", "Correction", ""),
        f("correctiveAction", "Corrective action", ""),
        f("remarks", "Remarks", ""),
        f("approverId", "Designated approver", ""),
      ],
    },
  ],
  audit: [
    {
      formKey: "schedule",
      label: "Annual audit schedule",
      fields: [
        f("auditTypes", "Audit types", []),
        f("auditCategory", "Audit category", ""),
        f("departmentProject", "Department / project", ""),
        f("location", "Location", ""),
        f("title", "Title", ""),
        f("processProductOwner", "Process / product owner", ""),
        f("plannedStartDate", "Planned start date", ""),
        f("plannedEndDate", "Planned end date", ""),
        f("remarks", "Remarks", ""),
        f("l1Name", "L1 reviewer name", ""),
        f("l1ReviewStatus", "L1 review status", "Pending"),
        f("l1ReviewComments", "L1 review comments", ""),
        f("l2Name", "L2 reviewer name", ""),
        f("l2ReviewStatus", "L2 review status", "Pending"),
        f("l2ReviewComments", "L2 review comments", ""),
        f("memoDescription", "Memo description", ""),
        f("memoCirculation", "Memo circulation", ""),
      ],
    },
    {
      formKey: "plan",
      label: "Audit plan",
      fields: [
        f("scope", "Scope", ""),
        f("criteria", "Criteria", []),
        f("auditDate", "Audit date", ""),
        f("location", "Location", ""),
        f("status", "Status", "Draft"),
        f("objectives", "Objectives", ""),
        f("leadAuditorId", "Lead auditor", ""),
        f("teamMemberIds", "Team members", []),
        f("processOwnerIds", "Process owners", []),
        f("feasibilityNotes", "Feasibility notes", ""),
      ],
    },
    {
      formKey: "audit-execution",
      label: "Audit execution",
      fields: [
        f("title", "Title", ""),
        f("status", "Status", "Planned"),
        f("openingMeeting", "Opening meeting", null),
        f("closingMeeting", "Closing meeting", null),
        f("startedAt", "Started at", null),
        f("closedAt", "Closed at", null),
      ],
    },
    {
      formKey: "finding",
      label: "Audit finding",
      fields: [
        f("title", "Title", ""),
        f("clause", "Clause", ""),
        f("classification", "Classification", ""),
        f("priority", "Priority", ""),
        f("riskLevel", "Risk level", ""),
        f("responsibleDepartments", "Responsible departments", []),
        f("description", "Description", ""),
        f("raisedAt", "Raised at", null),
      ],
    },
    {
      formKey: "car",
      label: "Corrective action response",
      fields: [
        f("rootCause", "Root cause", ""),
        f("correction", "Correction", ""),
        f("correctiveAction", "Corrective action", ""),
        f("ownerId", "Owner", ""),
        f("dueDate", "Due date", ""),
      ],
    },
  ],
  qaqc: [
    {
      formKey: "metric-entry",
      label: "NCR / RFI / RMI metric entry",
      fields: [
        f("projectId", "Project", ""),
        f("period", "Period", "current-month"),
        f("category", "Category", "External NCR"),
        f("issuedCount", "Issued count", 0),
        f("closedCount", "Closed count", 0),
        f("ageing0To15", "Ageing 0-15 days", 0),
        f("ageing15To45", "Ageing 15-45 days", 0),
        f("ageingOver45", "Ageing over 45 days", 0),
      ],
    },
    {
      formKey: "material-inspection",
      label: "Material inspection",
      fields: [
        f("projectId", "Project", ""),
        f("period", "Period", "current-month"),
        f("mirnTotal", "MIRN total", 0),
        f("osdCount", "OSD count", 0),
        f("approved", "Approved", 0),
        f("onHold", "On hold", 0),
        f("rejected", "Rejected", 0),
        f("hazardous", "Hazardous", 0),
        f("handleWithCare", "Handle with care", 0),
      ],
    },
    {
      formKey: "qtbt",
      label: "QTBT talk",
      fields: [
        f("projectId", "Project", ""),
        f("period", "Period", "current-month"),
        f("talkCount", "Talk count", 0),
        f("attendance", "Attendance", 0),
        f("durationMinutes", "Duration (minutes)", 0),
      ],
    },
    {
      formKey: "customer-satisfaction",
      label: "Customer satisfaction",
      fields: [
        f("projectId", "Project", ""),
        f("period", "Period", "current-month"),
        f("serviceRatings", "Service ratings", [3, 3, 3, 3, 3, 3]),
        f("feedback", "Feedback", ""),
      ],
    },
    {
      formKey: "document-governance-log",
      label: "Document governance log",
      fields: [
        f("date", "Date", "today"),
        f("projectId", "Project", ""),
        f("disciplineId", "Discipline", ""),
        f("documentType", "Document type", "Submittal"),
        f("status", "Status", "Under Review"),
        f("pendingWith", "Pending with", "Client"),
        f("reviewDays", "Review days", 0),
        f("pendingDays", "Pending days", 0),
        f("correspondenceCount", "Correspondence count", 0),
      ],
    },
    {
      formKey: "quality-brief",
      label: "Quality brief",
      fields: [
        f("projectId", "Project", ""),
        f("period", "Period", "current-month"),
        f("narrative", "Narrative", ""),
      ],
    },
  ],
};

export function catalogKeys(): Set<string> {
  const keys = new Set<string>();
  for (const [module, forms] of Object.entries(FIELD_CATALOG)) {
    for (const form of forms) {
      for (const field of form.fields) keys.add(`${module}.${form.formKey}.${field.fieldKey}`);
    }
  }
  return keys;
}

export function isAdminUser(user: { platformRole: string; workspaceRoles: string[] }): boolean {
  if (["Super Admin", "Org Admin"].includes(user.platformRole)) return true;
  return user.workspaceRoles.some((role) => /\b(admin|administrator)\b/i.test(role));
}

export function resolveDefault(value: unknown): unknown {
  if (value === "current-month") return new Date().toISOString().slice(0, 7);
  if (value === "today") return new Date().toISOString().slice(0, 10);
  return value;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normValue(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (Array.isArray(value)) return value.map(normValue).map(String).sort();
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .map((key) => [key, normValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;
const MONTH_ONLY = /^\d{4}-\d{2}$/;

export function valuesEqual(a: unknown, b: unknown): boolean {
  const x = normValue(a);
  const y = normValue(b);
  // null/undefined/"" and [] are all "empty" for comparison purposes.
  if (isBlank(x) && isBlank(y)) return true;
  if (typeof x === "string" && typeof y === "string") {
    // Month input ("2026-08") vs stored date ("2026-08-01"): compare at month granularity.
    if (MONTH_ONLY.test(x) && DATE_LIKE.test(y)) return y.slice(0, 7) === x;
    if (MONTH_ONLY.test(y) && DATE_LIKE.test(x)) return x.slice(0, 7) === y;
    if (DATE_LIKE.test(x) && DATE_LIKE.test(y)) {
      // Date-only vs timestamp: compare at the coarser granularity.
      if (x.length === 10 || y.length === 10) return x.slice(0, 10) === y.slice(0, 10);
      return new Date(x).getTime() === new Date(y).getTime();
    }
    return x === y;
  }
  if (typeof x !== typeof y) {
    if (x === "" || y === "") return x === y;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx === ny;
    return false;
  }
  return JSON.stringify(x) === JSON.stringify(y);
}

async function readOnlyFieldKeys(organizationId: string, module: AppKey, formKey: string): Promise<Set<string>> {
  const rows = await db
    .select({ fieldKey: moduleFieldSettings.fieldKey })
    .from(moduleFieldSettings)
    .where(and(
      eq(moduleFieldSettings.organizationId, organizationId),
      eq(moduleFieldSettings.module, module),
      eq(moduleFieldSettings.formKey, formKey),
      eq(moduleFieldSettings.access, "read_only"),
      isNull(moduleFieldSettings.deletedAt),
    ));
  return new Set(rows.map((row) => row.fieldKey));
}

type FieldAccessUser = { organizationId: string; platformRole: string; workspaceRoles: string[] };

// Read-only field keys for a user, with the same admin exemption as
// assertFieldAccess. Used by non-request write paths (AI extraction, bulk
// channels) that need the lock set rather than an HTTP rejection.
export async function readOnlyFields(user: FieldAccessUser, module: AppKey, formKey: string): Promise<Set<string>> {
  if (isAdminUser(user)) return new Set();
  return readOnlyFieldKeys(user.organizationId, module, formKey);
}

// Strip writes to read-only fields from an extracted/imported value bag,
// returning the surviving values plus the skipped field keys. A field is
// skipped when its value differs from the catalog create default — matching
// the create-mode rule in assertFieldAccess. Admins keep everything.
export async function filterReadOnlyValues(
  user: FieldAccessUser,
  module: AppKey,
  formKey: string,
  values: Record<string, unknown>,
): Promise<{ values: Record<string, unknown>; skipped: string[] }> {
  const readOnly = await readOnlyFields(user, module, formKey);
  if (!readOnly.size) return { values, skipped: [] };
  const form = FIELD_CATALOG[module].find((entry) => entry.formKey === formKey);
  const kept: Record<string, unknown> = { ...values };
  const skipped: string[] = [];
  for (const fieldKey of readOnly) {
    if (!(fieldKey in kept)) continue;
    const catalogField = form?.fields.find((entry) => entry.fieldKey === fieldKey);
    if (catalogField?.serverManaged) continue;
    const fallback = catalogField ? resolveDefault(catalogField.createDefault) : undefined;
    if (fallback !== undefined ? valuesEqual(kept[fieldKey], fallback) : isBlank(kept[fieldKey])) continue;
    delete kept[fieldKey];
    skipped.push(fieldKey);
  }
  return { values: kept, skipped };
}

// Reject the request with a 422 naming any read-only field it tries to write.
// - update: rejects fields whose submitted value differs from the stored one
//   (`current` must be the record mapped into body-key space).
// - create: rejects fields whose submitted value differs from the catalog
//   create default (unconfigured default = any non-blank value is a write).
// Platform/workspace administrators are exempt, matching the UI behaviour.
export async function assertFieldAccess(
  req: Request,
  module: AppKey,
  formKey: string,
  opts: { mode: "create" | "update"; current?: Record<string, unknown>; body?: Record<string, unknown> },
): Promise<void> {
  const user = req.currentUser;
  if (!user || isAdminUser(user)) return;
  const readOnly = await readOnlyFieldKeys(user.organizationId, module, formKey);
  if (!readOnly.size) return;
  const body = opts.body ?? ((req.body ?? {}) as Record<string, unknown>);
  const form = FIELD_CATALOG[module].find((entry) => entry.formKey === formKey);
  const blocked: string[] = [];
  for (const fieldKey of readOnly) {
    if (!(fieldKey in body)) continue;
    const catalogField = form?.fields.find((entry) => entry.fieldKey === fieldKey);
    if (catalogField?.serverManaged) continue;
    if (opts.mode === "update") {
      if (opts.current && valuesEqual(body[fieldKey], opts.current[fieldKey])) continue;
      blocked.push(fieldKey);
    } else {
      const fallback = catalogField ? resolveDefault(catalogField.createDefault) : undefined;
      if (fallback !== undefined ? valuesEqual(body[fieldKey], fallback) : isBlank(body[fieldKey])) continue;
      blocked.push(fieldKey);
    }
  }
  if (blocked.length) {
    throw new HttpError(422, `Read-only field(s) cannot be modified: ${blocked.join(", ")}`);
  }
}
