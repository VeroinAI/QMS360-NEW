export const auditPlanDateFields = [
  { key: "startDateTime", label: "Start Date & Time" },
  { key: "endDateTime", label: "End Date & Time" },
  { key: "openingMeetingDateTime", label: "Opening Meeting" },
  { key: "closingMeetingDateTime", label: "Closing Meeting" },
] as const;
export type AuditPlanDateKey = typeof auditPlanDateFields[number]["key"];

function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const displayDay = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
export function getAuditPlanDateRange(from: unknown, to: unknown) {
  const sourceDay = (value: unknown) => {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
    return plannedDate(value);
  };
  from = sourceDay(from); to = sourceDay(to);
  if (!validDay(from) || !validDay(to) || to < from) return null;
  return {
    from, to, label: `${displayDay(from)} to ${displayDay(to)} (inclusive)`,
    min: `${from}T00:00`, max: `${to}T23:59`,
  };
}
/** Planned timestamps retain their saved calendar day, including explicit suffixes. */
function calendarDay(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  return plannedDate(value);
}
export function validateAuditPlanDates(
  values: Partial<Record<AuditPlanDateKey, unknown>>, from: unknown, to: unknown,
): Record<string, string> {
  const range = getAuditPlanDateRange(from, to);
  if (!range) return { scheduleId: "The selected audit must have valid From Date and To Date values. Update or reload the audit before saving this plan." };
  const errors: Record<string, string> = {};
  for (const { key, label } of auditPlanDateFields) {
    const value = values[key];
    if (value == null || value === "") continue; // Required-field validation supplies the empty-field message.
    const day = calendarDay(value);
    if (!day) errors[key] = `${label}: enter a valid date and time within ${range.label}.`;
    else if (day < range.from || day > range.to) {
      errors[key] = `${label} must fall within ${range.label}, using the selected audit's From Date and To Date.`;
    }
  }
  return errors;
}

/** Calendar days and wall-clock inputs stay in their saved timezone, never UTC-shifted. */
export function plannedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value.slice(0, 10)
    || Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 59
    || Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return null;
  return value.slice(0, 10);
}

export type DatedActivity = {
  id?: string; section?: string; remarks?: string; auditeeId?: string;
  plannedStartDateTime?: string; plannedEndDateTime?: string; legacyDateTimeDerived?: boolean;
};

/** Project nested values into both existing field-control stores without first-row collapse. */
export function planActivityFieldValues(source: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(source.activities)) return source;
  const rows = source.activities as DatedActivity[];
  const values = (key: keyof DatedActivity) => rows.map(row => `${row.id ?? ""}:${String(row[key] ?? "")}`);
  return {
    ...source, activitySection: values("section"), activityRemarks: values("remarks"),
    activityAuditeeId: rows.map(row => `${row.id ?? ""}:${String((row as DatedActivity & { auditeeIds?: string[] }).auditeeIds ?? row.auditeeId ?? "")}`),
    activityRoleIds: rows.map(row => `${row.id ?? ""}:${JSON.stringify((row as DatedActivity & { roleIds?: string[] }).roleIds ?? [])}`),
    activityPlannedStartDateTime: values("plannedStartDateTime"),
    activityPlannedEndDateTime: values("plannedEndDateTime"),
    // Retain existing administrators' shared date locks over BOTH new controls.
    activityDateTime: rows.map(row => `${row.id ?? ""}:${row.plannedStartDateTime ?? ""}/${row.plannedEndDateTime ?? ""}`),
  };
}

/** An idempotent create response must acknowledge the submitted dated rows, not merely the same ID. */
export function auditPlanReplayMatches(incoming: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  const projection = (plan: Record<string, unknown>) => ({
    id: plan.id,
    scheduleId: plan.scheduleId,
    dates: ["startDateTime", "endDateTime", "openingMeetingDateTime", "closingMeetingDateTime"].map(key => plan[key] ?? ""),
    activities: (Array.isArray(plan.activities) ? plan.activities as DatedActivity[] : []).map(row => ({
      id: row.id, section: row.section, remarks: row.remarks, auditeeId: row.auditeeId,
      plannedStartDateTime: row.plannedStartDateTime ?? "", plannedEndDateTime: row.plannedEndDateTime ?? "",
    })),
  });
  return JSON.stringify(projection(incoming)) === JSON.stringify(projection(saved));
}

/** Only an actually saved shared timestamp is eligible for the legacy fallback. */
export function datedActivities<T extends DatedActivity>(rows: T[], shared?: string): T[] {
  return rows.map(row => {
    const legacy = !row.plannedStartDateTime && !row.plannedEndDateTime && Boolean(shared);
    return legacy ? { ...row, plannedStartDateTime: shared, plannedEndDateTime: shared, legacyDateTimeDerived: true } : { ...row };
  });
}

export function auditPlanDateErrors(
  plan: Record<string, unknown>, bounds: { plannedStartDate?: unknown; plannedEndDate?: unknown },
  rows: DatedActivity[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const from = plannedDate(bounds.plannedStartDate), to = plannedDate(bounds.plannedEndDate);
  if (!from || !to || from > to) {
    errors.scheduleId = "The linked Audit has unavailable or invalid planned dates. Correct the Audit date range before saving or sending this plan.";
    return errors;
  }
  const check = (key: string, label: string, value: unknown) => {
    const day = plannedDate(value);
    if (!day || typeof value !== "string" || !value.includes("T")) errors[key] = `${label}: enter a valid date and time.`;
    else if (day < from || day > to) errors[key] = `${label} must be within the linked Audit dates (${from} through ${to}, inclusive).`;
  };
  const order = (key: string, label: string, start: unknown, end: unknown) => {
    // Compare saved wall-clock values rather than converting to UTC calendar dates.
    const clock = (value: string) => {
      const [, seconds = "00", fraction = ""] = /T\d{2}:\d{2}(?::(\d{2})(?:\.(\d{1,9}))?)?/.exec(value) ?? [];
      return `${value.slice(0, 16)}:${seconds}.${fraction.padEnd(9, "0")}`;
    };
    if (typeof start === "string" && typeof end === "string" && plannedDate(start) && plannedDate(end)
      && clock(end) < clock(start)) errors[key] = `${label} must be on or after its start.`;
  };
  for (const [key, label] of [
    ["startDateTime", "Plan Start"], ["endDateTime", "Plan End"],
    ["openingMeetingDateTime", "Opening Meeting"], ["closingMeetingDateTime", "Closing Meeting"],
  ]) check(key, label, plan[key]);
  order("endDateTime", "Plan End", plan.startDateTime, plan.endDateTime);
  order("closingMeetingDateTime", "Closing Meeting", plan.openingMeetingDateTime, plan.closingMeetingDateTime);
  if (!rows.length) errors.activities = "Add at least one activity with Planned Start and Planned End.";
  rows.forEach((row, index) => {
    const prefix = `activity-${row.id ?? index}`;
    check(`${prefix}-plannedStartDateTime`, `Activity ${index + 1} Planned Start`, row.plannedStartDateTime);
    check(`${prefix}-plannedEndDateTime`, `Activity ${index + 1} Planned End`, row.plannedEndDateTime);
    order(`${prefix}-plannedEndDateTime`, `Activity ${index + 1} Planned End`, row.plannedStartDateTime, row.plannedEndDateTime);
  });
  return errors;
}
