import { formatDate } from "@workspace/spreadsheet-dates";
import { datedActivities, plannedDate } from "@workspace/field-controls";
export const TO_BE_MAPPED = "To be mapped";
export const NO_DATA = "-";
type RecordData = Record<string, any>;
export type AuditPlanReportData = {
  title: string; reference: string; auditNumber: string; preparedDate: string;
  lead: string; team: string; auditee: string; scope: string; types: string;
  programManager: string;
  preparedBySignature?: Uint8Array;
  programManagerSignature?: Uint8Array;
  standards: string; language: string; sheqReference: string;
  start: string; end: string; opening: string; closing: string;
  startRemark: string; endRemark: string; openingRemark: string; closingRemark: string;
  revision: string;
  project: Array<[string, string]>;
  activities: Array<{ section: string; remarks: string; auditee: string; dateTime: string; plannedStart?: string; plannedEnd?: string; legacyDateTimeDerived?: boolean }>;
};
function actualValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
export function mapped(value: unknown): string {
  return actualValue(value) ?? NO_DATA;
}
function custom(fields: RecordData, ...aliases: string[]) {
  const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const alias of aliases) {
    const entry = Object.entries(fields).find(([key]) => normalize(key) === normalize(alias));
    const value = entry && actualValue(entry[1]);
    if (value !== undefined) return value;
  }
  return NO_DATA;
}
export function auditPlanReportData(plan: RecordData, meta: RecordData, schedule: RecordData, project: RecordData | undefined,
  userNames: Map<string, string>, roleNames: Map<string, string>, timeZone: string, creatorId?: string,
  activityLabels: ReadonlyMap<string, string> = new Map()): AuditPlanReportData {
  const name = (id: unknown) => typeof id === "string" ? mapped(userNames.get(id)) : NO_DATA;
  const names = (ids: unknown, source: Map<string, string>) => Array.isArray(ids) && ids.length
    ? ids.map(id => mapped(source.get(id))).join(", ") : NO_DATA;
  const instantDate = (value: unknown) => {
    if (value == null || value === "") return NO_DATA;
    const d = new Date(value as string);
    if (!Number.isFinite(d.getTime())) return NO_DATA;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
    const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
    return formatDate(`${part("year")}-${part("month")}-${part("day")}`);
  };
  const date = (value: unknown, withTime = false) => {
    // Planned values are calendar/wall-clock inputs, even if a historical client added an offset.
    // Actual instants (for example preparation time) use instantDate instead.
    const saved = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value;
    if (typeof saved !== "string" || !plannedDate(saved) || (withTime && !saved.includes("T"))) return NO_DATA;
    return `${formatDate(saved.slice(0, 10))}${withTime ? `\n${saved.slice(11, 16)}` : ""}`;
  };
  const fields = project?.customFields ?? {};
  const activityRows = Array.isArray(meta.activities) && meta.activities.length ? meta.activities : [{
    section: meta.activitySection ?? plan.location, remarks: meta.activityRemarks ?? meta.feasibilityNotes,
    auditeeId: meta.activityAuditeeId ?? meta.auditeeId ?? meta.processOwnerIds?.[0],
  }];
  const number = mapped(schedule.auditNumber);
  let types = meta.auditTypes;
  if (!Array.isArray(types) || !types.length) {
    try { types = JSON.parse(plan.criteria); }
    catch { types = plan.criteria ? [plan.criteria] : []; }
  }
  return {
    title: mapped(project?.name ?? meta.auditTitle ?? plan.scope),
    reference: mapped(meta.planNumber ?? schedule.auditNumber), auditNumber: number, preparedDate: instantDate(plan.createdAt),
    lead: name(meta.leadAuditorId ?? plan.teamMemberIds?.[0]), team: names(plan.teamMemberIds, userNames),
    programManager: name(creatorId),
    auditee: meta.auditeeRoleIds?.length ? names(meta.auditeeRoleIds, roleNames) : name(meta.auditeeId ?? meta.processOwnerIds?.[0]),
    scope: mapped(meta.qaqcScope ?? plan.scope), types: Array.isArray(types) && types.length ? types.join(", ") : mapped(plan.criteria),
    standards: mapped(schedule.qaqcClauses), language: mapped(meta.auditLanguage),
    sheqReference: mapped(meta.qaqcReference || schedule.qaqcReference),
    start: date(meta.startDateTime ?? plan.auditDate ?? schedule.plannedStartDate),
    end: date(meta.endDateTime ?? schedule.plannedEndDate),
    opening: date(meta.openingMeetingDateTime, true), closing: date(meta.closingMeetingDateTime, true),
    startRemark: mapped(meta.startDateTimeRemark), endRemark: mapped(meta.endDateTimeRemark),
    openingRemark: mapped(meta.openingMeetingDateTimeRemark), closingRemark: mapped(meta.closingMeetingDateTimeRemark),
    // No persisted revision field or revision workflow exists for Audit Plans.
    revision: TO_BE_MAPPED,
    project: [
      ["Project Name", mapped(project?.name)],
      ["Contract #", custom(fields, "contractNumber", "contractNo", "contract #")],
      ["Client", custom(fields, "client", "clientName")], ["Consultant", custom(fields, "consultant", "consultantName")],
      ["Main contractor", custom(fields, "mainContractor", "mainContractorName")],
      ["Project Manager", custom(fields, "projectManager", "projectManagerName", "pmName")],
      ["TCC", custom(fields, "tcc", "tccDate")], ["PAC", custom(fields, "pac", "pacDate")],
      ["FAC", custom(fields, "fac", "facDate")], ["Contract Value", custom(fields, "contractValue")],
      ["Contract Signed Date", custom(fields, "contractSignedDate")], ["PTS #", custom(fields, "ptsNumber", "ptsNo", "pts #")],
    ],
    activities: datedActivities<RecordData>(activityRows, meta.activityDateTime).map((row: RecordData) => {
      const start = date(row.plannedStartDateTime, true), end = date(row.plannedEndDateTime, true);
      return { section: mapped(activityLabels.get(row.section) || row.section), remarks: mapped(row.remarks), auditee: names(row.roleIds, roleNames),
        plannedStart: start, plannedEnd: end, legacyDateTimeDerived: row.legacyDateTimeDerived,
        dateTime: `Planned Start: ${start}\nPlanned End: ${end}${row.legacyDateTimeDerived ? "\nDerived from saved legacy date/time" : ""}` };
    }),
  };
}