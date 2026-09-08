import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, organizationSettings } from "@workspace/db";
import { unknownFieldControlKeys } from "@workspace/field-controls";
import { FIELD_CATALOG, isAdminUser, resolveDefault, valuesEqual } from "./field-access";
import { HttpError, type AppKey } from "./workspace";

export type FieldControlSetting = { access: "editable" | "read_only"; requirement: "optional" | "mandatory" };
export type FieldControlsMatrix = Record<string, Record<string, FieldControlSetting>>;

// Reject a field-control matrix that references form or field keys outside the
// shared registry (a mistyped key would otherwise be stored and silently never
// apply, leaving the admin believing a form is locked when it is not).
export function assertKnownFieldControlKeys(appKey: AppKey, matrix: FieldControlsMatrix): void {
  const unknown = unknownFieldControlKeys(appKey, matrix);
  if (unknown.length) {
    throw new HttpError(422, `Unknown field control key(s): ${unknown.join(", ")}`);
  }
}

// Field-control matrices live in the shared organization_settings.branding JSON payload
// under the `fieldControls` key, shaped { [appKey]: { [formKey]: { [fieldKey]: setting } } }.
export async function readFieldControls(organizationId: string, appKey: string): Promise<FieldControlsMatrix> {
  const [settings] = await db.select({ branding: organizationSettings.branding }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  return (((settings?.branding as any)?.fieldControls?.[appKey]) ?? {}) as FieldControlsMatrix;
}

export async function writeFieldControls(organizationId: string, appKey: string, matrix: FieldControlsMatrix): Promise<FieldControlsMatrix | undefined> {
  const [existing] = await db.select().from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  const before = (existing?.branding as any)?.fieldControls?.[appKey] as FieldControlsMatrix | undefined;
  const branding = {
    ...(existing?.branding ?? {}),
    fieldControls: { ...((existing?.branding as any)?.fieldControls ?? {}), [appKey]: matrix },
  };
  if (existing) {
    await db.update(organizationSettings).set({ branding, updatedAt: new Date() }).where(eq(organizationSettings.id, existing.id));
  } else {
    await db.insert(organizationSettings).values({ organizationId, branding });
  }
  return before;
}

// ---------------------------------------------------------------------------
// Server-side enforcement of the field-control matrix (Admin Settings → Form
// Fields). The UI disables read-only inputs and blocks saving while mandatory
// fields are empty, but that is only client-side: assertFieldControls applies
// the same rules to create/update API calls so crafted requests (curl,
// devtools) cannot write read-only fields or skip mandatory ones. Platform and
// workspace administrators are exempt, matching the UI bypass.
// ---------------------------------------------------------------------------

// The registry's form keys differ from the FIELD_CATALOG keys for these forms.
const FORM_KEY_ALIASES: Record<string, string> = {
  "qaqc.metric": "metric-entry",
  "qaqc.document-log": "document-governance-log",
};

// Specs for registry fields the FIELD_CATALOG does not cover, or whose
// create-time defaults / blank semantics differ from it. Keyed
// "app.form.field". `bodyKeys` maps a logical field to the request-body keys
// carrying its value (GPS is captured as a lat/lng pair). `createDefault` may
// be a function for values computed at render time in the UI (current year…).
type ExtraFieldSpec = {
  bodyKeys?: string[];
  createDefault?: unknown | (() => unknown);
  serverManaged?: boolean;
  mandatoryWhen?: (body: Record<string, unknown>) => boolean;
  isEmpty?: (value: unknown) => boolean;
};

const EXTRA_FIELD_SPECS: Record<string, ExtraFieldSpec> = {
  "lessons.lesson-form.gps": {
    bodyKeys: ["gpsLat", "gpsLng"],
    isEmpty: (value) => !Array.isArray(value) || value.some((part) => part === null || part === undefined || part === ""),
  },
  // Repeat details only apply once the issue is marked as repeated (mirrors the UI's conditional checks).
  "lessons.lesson-form.repeatCount": {
    mandatoryWhen: (body) => body.isRepeatedIssue === true,
    isEmpty: (value) => typeof value !== "number" || value < 1,
  },
  "lessons.lesson-form.repeatLocation": { mandatoryWhen: (body) => body.isRepeatedIssue === true },
  "audit.schedule.year": { createDefault: () => new Date().getFullYear() },
  "audit.schedule.projectIds": { createDefault: [] },
  "audit.schedule.ownerId": { createDefault: "" },
  "audit.schedule.qaqcReference": { createDefault: () => `QAM-IA/${String(new Date().getFullYear()).slice(-2)}-` },
  "audit.schedule.auditNumber": { createDefault: () => `AUD-${new Date().getFullYear()}-` },
  "audit.schedule.qaqcScope": { createDefault: "System and Process audits against ISO 9001:2015" },
  "audit.schedule.qaqcClauses": { createDefault: "ISO 9001 — All clauses" },
  // The finding form preselects these LOV values; the catalog defaults are blank.
  "audit.finding.classification": { createDefault: "Observation" },
  "audit.finding.priority": { createDefault: "P6" },
  "audit.finding.riskLevel": { createDefault: "Low" },
};

type ResolvedFieldSpec = {
  bodyKeys: string[];
  createDefault?: unknown | (() => unknown);
  serverManaged: boolean;
  mandatoryWhen?: (body: Record<string, unknown>) => boolean;
  isEmpty?: (value: unknown) => boolean;
};

function resolveFieldSpec(appKey: AppKey, formKey: string, fieldKey: string): ResolvedFieldSpec {
  const extra = EXTRA_FIELD_SPECS[`${appKey}.${formKey}.${fieldKey}`];
  const catalogFormKey = FORM_KEY_ALIASES[`${appKey}.${formKey}`] ?? formKey;
  const catalogField = FIELD_CATALOG[appKey]
    ?.find((form) => form.formKey === catalogFormKey)
    ?.fields.find((field) => field.fieldKey === fieldKey);
  return {
    bodyKeys: extra?.bodyKeys ?? [fieldKey],
    createDefault: extra && "createDefault" in extra ? extra.createDefault : catalogField?.createDefault,
    serverManaged: extra?.serverManaged ?? catalogField?.serverManaged ?? false,
    mandatoryWhen: extra?.mandatoryWhen,
    isEmpty: extra?.isEmpty,
  };
}

function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function createDefaultValue(spec: ResolvedFieldSpec): unknown {
  const value = spec.createDefault;
  return typeof value === "function" ? (value as () => unknown)() : resolveDefault(value);
}

// Reject the request with a 422 naming any read-only field it writes or any
// mandatory field it leaves empty.
// - update: a read-only field is rejected when its submitted value differs from
//   the stored one (`current` must be the record mapped into body-key space);
//   a mandatory field is checked against the submitted value, falling back to
//   the stored one when the key is absent from the body.
// - create: a read-only field is rejected when its submitted value differs from
//   the create-time default the UI would send (unknown default = any non-blank
//   value is a write); a mandatory field must be present and non-blank.
export async function assertFieldControls(
  req: Request,
  appKey: AppKey,
  formKey: string,
  opts: { mode: "create" | "update"; current?: Record<string, unknown>; body?: Record<string, unknown> },
): Promise<void> {
  const user = req.currentUser;
  if (!user || isAdminUser(user)) return;
  const form = (await readFieldControls(user.organizationId, appKey))[formKey];
  if (!form) return;
  const body = opts.body ?? ((req.body ?? {}) as Record<string, unknown>);
  const readOnlyWrites: string[] = [];
  const missingMandatory: string[] = [];
  for (const [fieldKey, setting] of Object.entries(form)) {
    const spec = resolveFieldSpec(appKey, formKey, fieldKey);
    if (spec.serverManaged) continue;
    const presentIn = (source: Record<string, unknown> | undefined) =>
      spec.bodyKeys.some((key) => source && key in source && source[key] !== undefined);
    const valueFrom = (source: Record<string, unknown> | undefined) =>
      spec.bodyKeys.length > 1 ? spec.bodyKeys.map((key) => source?.[key]) : source?.[spec.bodyKeys[0]!];

    if (setting?.access === "read_only" && presentIn(body)) {
      if (opts.mode === "update") {
        const changed = spec.bodyKeys.some((key) =>
          key in body && body[key] !== undefined && !valuesEqual(body[key], opts.current?.[key]));
        if (changed) readOnlyWrites.push(fieldKey);
      } else {
        const fallback = createDefaultValue(spec);
        const value = valueFrom(body);
        const matchesDefault = fallback !== undefined
          ? valuesEqual(value, fallback)
          : spec.isEmpty ? spec.isEmpty(value) : isBlankValue(value);
        if (!matchesDefault) readOnlyWrites.push(fieldKey);
      }
    }

    if (setting?.requirement === "mandatory") {
      if (spec.mandatoryWhen && !spec.mandatoryWhen(body)) continue;
      const value = valueFrom(presentIn(body) ? body : opts.current);
      const empty = spec.isEmpty ? spec.isEmpty(value) : isBlankValue(value);
      if (empty) missingMandatory.push(fieldKey);
    }
  }
  if (readOnlyWrites.length) {
    throw new HttpError(422, `Read-only field(s) cannot be modified: ${readOnlyWrites.join(", ")}`);
  }
  if (missingMandatory.length) {
    throw new HttpError(422, `Mandatory field(s) must not be empty: ${missingMandatory.join(", ")}`);
  }
}
