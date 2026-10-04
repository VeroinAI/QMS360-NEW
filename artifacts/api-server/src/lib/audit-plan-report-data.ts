export const TO_BE_MAPPED = "To Be Mapped";
type RecordData = Record<string, any>;
export type AuditPlanReportData = {
  title: string; reference: string; auditNumber: string; preparedDate: string;
  lead: string; team: string; auditee: string; scope: string; types: string;
  standards: string; language: string; sheqReference: string;
  start: string; end: string; opening: string; closing: string;
  project: Array<[string, string]>;
  activities: Array<{ section: string; remarks: string; auditee: string; dateTime: string }>;
};
export function mapped(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return TO_BE_MAPPED;
}
function custom(fields: RecordData, ...aliases: string[]) {
  const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const alias of aliases) {
    const entry = Object.entries(fields).find(([key]) => normalize(key) === normalize(alias));
    if (entry && mapped(entry[1]) !== TO_BE_MAPPED) return mapped(entry[1]);
  }
  return TO_BE_MAPPED;
}
export function auditPlanReportData(plan: RecordData, meta: RecordData, schedule: RecordData, project: RecordData | undefined,
  userNames: Map<string, string>, roleNames: Map<string, string>, timeZone: string): AuditPlanReportData {
  const name = (id: unknown) => typeof id === "string" ? mapped(userNames.get(id)) : TO_BE_MAPPED;
  const names = (ids: unknown, source: Map<string, string>) => Array.isArray(ids) && ids.length
    ? ids.map(id => mapped(source.get(id))).join(", ") : TO_BE_MAPPED;
  const date = (value: unknown, withTime = false) => {
    if (!value) return TO_BE_MAPPED;
    if (!withTime && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("-");
    const d = new Date(value as string);
    if (!Number.isFinite(d.getTime())) return TO_BE_MAPPED;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}) }).formatToParts(d);
    const part = (key: string) => parts.find(p => p.type === key)?.value ?? "";
    return `${part("day")}-${part("month")}-${part("year")}${withTime ? `\n${part("hour")}:${part("minute")}` : ""}`;
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
    reference: number, auditNumber: number, preparedDate: date(plan.createdAt),
    lead: name(meta.leadAuditorId ?? plan.teamMemberIds?.[0]), team: names(plan.teamMemberIds, userNames),
    auditee: meta.auditeeRoleIds?.length ? names(meta.auditeeRoleIds, roleNames) : name(meta.auditeeId ?? meta.processOwnerIds?.[0]),
    scope: mapped(meta.qaqcScope ?? plan.scope), types: Array.isArray(types) && types.length ? types.join(", ") : mapped(plan.criteria),
    standards: mapped(schedule.qaqcClauses), language: mapped(meta.auditLanguage),
    sheqReference: mapped(meta.qaqcReference || schedule.qaqcReference),
    start: date(meta.startDateTime ?? plan.auditDate ?? schedule.plannedStartDate),
    end: date(meta.endDateTime ?? schedule.plannedEndDate),
    opening: date(meta.openingMeetingDateTime, true), closing: date(meta.closingMeetingDateTime, true),
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
    activities: activityRows.map((row: RecordData) => ({ section: mapped(row.section), remarks: mapped(row.remarks),
      auditee: name(row.auditeeId), dateTime: date(meta.activityDateTime, true) })),
  };
}