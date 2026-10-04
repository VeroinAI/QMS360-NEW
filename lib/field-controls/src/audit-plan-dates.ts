export const auditPlanDateFields = [
  { key: "startDateTime", label: "Start Date & Time" },
  { key: "endDateTime", label: "End Date & Time" },
  { key: "openingMeetingDateTime", label: "Opening Meeting" },
  { key: "closingMeetingDateTime", label: "Closing Meeting" },
  { key: "activityDateTime", label: "Date / Time of Activity" },
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
    if (typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value))) return new Date(value).toISOString().slice(0, 10);
    return value;
  };
  from = sourceDay(from); to = sourceDay(to);
  if (!validDay(from) || !validDay(to) || to < from) return null;
  return {
    from, to, label: `${displayDay(from)} to ${displayDay(to)} (inclusive)`,
    min: `${from}T00:00`, max: `${to}T23:59`,
  };
}
/** Local form values are calendar dates; explicit-offset/API instants follow the existing UTC storage contract. */
function calendarDay(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== "string" || !validDay(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? new Date(value).toISOString().slice(0, 10) : value.slice(0, 10);
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