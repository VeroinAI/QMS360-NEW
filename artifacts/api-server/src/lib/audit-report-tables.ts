import type { AuditReportTable } from "@workspace/api-zod";
import { auditIsComplete } from "./audit-consolidated-report";
import { mapAuditFindingRegister, registerJson as json } from "./audit-finding-register-mapping";
import { carDueDate, findingDateValue } from "./car-dates";
import { carPendingWith } from "./car-register-presentation";

type Row = Record<string, any>;
export type ReportKey = "open-vs-closed" | "findings-log" | "car-status" | "schedule";
export const reportKeys: ReportKey[] = ["open-vs-closed", "findings-log", "car-status", "schedule"];
export type ReportData = {
  audits: Row[]; plans: Row[]; schedules: Row[]; findings: Row[]; cars: Row[];
  users: Row[]; projects: Row[]; labels: Row[]; evidence: Row[]; events: Row[]; escalations: Row[];
  viewerId: string; fullAuditIds: Set<string>; now: string;
  scheduleIds?: Set<string>;
};
const definitions: Record<ReportKey, { title: string; labels: string[]; dates: number[]; numbers: number[] }> = {
  "open-vs-closed": {
    title: "Open vs Closed Audits",
    labels: ["Audit Schedule", "Audit Reference Number", "Audit Title", "Audit Type", "Audit Category", "Project/Department", "Location", "Audit Lead", "Start Date", "End Date", "Audit Status", "Number of OFIs", "Number of Minor NCs", "Number of Moderate NCs", "Number of Major NCs", "Open CAR Count", "Closed CAR Count", "Closure Delay (Days)"],
    dates: [8, 9], numbers: [11, 12, 13, 14, 15, 16, 17],
  },
  "findings-log": {
    title: "Findings Log",
    labels: ["Findings Reference Number", "Audit Number", "Audit Title", "Finding Date", "Project/Department", "Audit Lead", "Finding Description", "Finding Type", "Reference Clause", "Evidence Attachment Available", "Responsible Owner", "CAR Number", "CAR Status", "Target Closure Date", "Actual Closure Date", "Open Days", "Escalation Level", "Finding Status"],
    dates: [3, 13, 14], numbers: [15],
  },
  "car-status": {
    title: "CAR Status & Closure",
    labels: ["CAR Number", "Audit Number", "Finding ID", "Project/Department", "Action Taker Name", "Finding Description", "Risk Level", "Classification", "Due Date", "Root Cause Submitted", "Corrective Action", "Evidence Submitted", "CAR Status", "Reviewer Decision", "Closed within ACD", "Closure Date", "Closure Delay (Days)", "Escalation Level", "Current Owner"],
    dates: [8, 15], numbers: [16],
  },
  schedule: {
    title: "Annual Audit Schedule",
    labels: ["Audit Schedule", "Audit Number", "Audit Title", "Audit Type", "Category", "Project/Department", "Location", "Process/Product Owner", "Start Date", "End Date", "L1 Approval Status", "L2 Approval Status", "Memo Released Date", "Audit Plan Sent Date", "Remarks"],
    dates: [8, 9, 12, 13], numbers: [],
  },
};
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
const day = (v: unknown) => {
  const value = v instanceof Date ? v.toISOString() : text(v);
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = value.slice(0, 10);
  return Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ? date : null;
};
export const reportDays = (from: unknown, to: unknown) => {
  const a = day(from), b = day(to);
  return a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000)) : null;
};
const status = (value: unknown) => text(value)?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? null;
const isClosed = (v: unknown) => ["closed", "verified"].includes(String(v).toLowerCase());
export function buildAuditReportTable(report: ReportKey, data: ReportData, options: {
  year?: number; search?: string; page: number; limit: number; all?: boolean;
}): AuditReportTable {
  const definition = definitions[report];
  const names = new Map(data.users.map(user => [user.id, user.fullName]));
  const person = (id: unknown) => id ? names.get(String(id)) ?? null : null;
  const label = (group: string, value: unknown) => {
    const v = text(value);
    if (!v) return null;
    return data.labels.find(row => row.group === group && [row.id, row.value, row.label].includes(v))?.label
      ?? (/^[0-9a-f-]{36}$/i.test(v) ? null : v);
  };
  const byId = (rows: Row[], id: unknown) => rows.find(row => row.id === id);
  const scheduleFor = (audit: Row) => byId(data.schedules, byId(data.plans, audit.auditPlanId)?.auditScheduleId);
  const source = (schedule: Row | undefined, projectId?: string | null) => {
    if (projectId) return byId(data.projects, projectId)?.name ?? null;
    const meta = json(schedule?.status);
    const ids = list(meta.projectIds);
    return ids.length ? ids.map(id => byId(data.projects, id)?.name).filter(Boolean).join(", ") || null
      : label("departments", meta.departmentProject);
  };
  const parent = (schedule: Row | undefined) => byId(data.schedules, json(schedule?.status).parentId);
  const eventDate = (id: string | undefined, actions: string[], completedOnly = false) => data.events
    .filter(event => event.entityId === id && actions.includes(event.action)
      && (!completedOnly || auditIsComplete(event.after?.workflowState ?? "") && !auditIsComplete(event.before?.workflowState ?? "")))
    .map(event => day(event.createdAt)).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const evidenceIds = new Set(data.evidence.filter(file => file.status === "stored").map(file => file.id));
  const hasEvidence = (ids: unknown, recordIds: string[], types: string[]) => list(ids).some(id => evidenceIds.has(id))
    || data.evidence.some(file => file.status === "stored" && recordIds.includes(file.recordId) && types.includes(file.recordType));
  const escalation = (ids: string[]) => {
    const latest = data.escalations.filter(row => ids.includes(row.recordId) && !row.resolvedAt)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    return text(latest?.currentLevel);
  };
  const carStatus = (car: Row) => {
    const meta = json(car.effectivenessNotes);
    return car.workflowState === "rejected" && ["query", "rework"].includes(String(meta.reviewOutcome))
      ? `Returned for ${meta.reviewOutcome}` : status(car.workflowState);
  };
  const scopedFindings = data.audits.flatMap(audit => {
    const plan = byId(data.plans, audit.auditPlanId), schedule = scheduleFor(audit);
    const pm = json(plan?.status), sm = json(schedule?.status);
    const own = data.findings.filter(finding => finding.auditId === audit.id);
    const owners = new Map<string, string[]>();
    for (const finding of own) owners.set(finding.id, data.cars.filter(car => car.auditFindingId === finding.id)
      .flatMap(car => car.ownerId ? [car.ownerId] : []));
    return mapAuditFindingRegister(audit.checklistState, own as any, {
      auditExecutionId: audit.id, auditId: text(sm.qaqcReference), auditTitle: text(json(audit.status).title) ?? audit.referenceNumber,
      projectDepartment: source(schedule, audit.projectId), auditTeamLeadId: text(pm.leadAuditorId),
      auditTeamLeadName: person(pm.leadAuditorId), fullVisibility: data.fullAuditIds.has(audit.id),
      viewerId: data.viewerId, teamIds: list(plan?.teamMemberIds), names, owners, label,
    }).map(row => {
      const itemId = row.id.split(":").at(-1);
      const item = row.source === "checklist" && Array.isArray(audit.checklistState)
        ? audit.checklistState.find((x: Row) => x.id === itemId) : null;
      const finding = row.source === "legacy" ? own.find(f => f.id === itemId)
        : own.find(f => f.evidence?.sourceChecklistItemId === itemId);
      const cars = finding ? data.cars.filter(car => car.auditFindingId === finding.id) : [];
      return { ...row, audit, schedule, item, finding, cars, findingDate: day(findingDateValue(item, finding)),
        description: text(item?.auditFindings) ?? text(item?.findingDescription) ?? row.description };
    });
  });
  const rows: Array<{ id: string; year: number | null; values: unknown[] }> = [];
  if (report === "schedule") {
    for (const schedule of data.schedules.filter(row => !json(row.status).programme && (!data.scheduleIds || data.scheduleIds.has(row.id)))) {
      const sm = json(schedule.status), programme = parent(schedule), programmeMeta = json(programme?.status);
      const plans = data.plans.filter(plan => plan.auditScheduleId === schedule.id);
      const sent = plans.map(plan => eventDate(plan.id, ["send_for_audit"])).filter((date): date is string => !!date).sort().at(-1);
      rows.push({ id: schedule.id, year: schedule.year, values: [
        programme?.title, sm.auditNumber, schedule.title, list(sm.auditTypes).map(type => label("audit_types", type)).filter(Boolean).join(", "),
        label("audit_categories", sm.auditCategory), source(schedule, schedule.projectId), sm.location,
        person(schedule.ownerId) ?? person(sm.processProductOwner)
          ?? (typeof sm.processProductOwner === "string" && !/^[0-9a-f-]{36}$/i.test(sm.processProductOwner) ? text(sm.processProductOwner) : null),
        day(sm.plannedStartDate), day(sm.plannedEndDate), sm.l1ReviewStatus ?? programmeMeta.l1ReviewStatus,
        sm.l2ReviewStatus ?? programmeMeta.l2ReviewStatus,
        day(sm.memoReleasedAt ?? programmeMeta.memoReleasedAt) ?? eventDate(programme?.id, ["release_memo", "send_memo", "memo_released"]),
        sent, sm.remarks,
      ] });
    }
  } else if (report === "open-vs-closed") {
    for (const audit of data.audits) {
      const schedule = scheduleFor(audit), sm = json(schedule?.status), plan = byId(data.plans, audit.auditPlanId), pm = json(plan?.status);
      const findings = scopedFindings.filter(row => row.audit.id === audit.id), cars = findings.flatMap(row => row.cars);
      const count = (classification: string) => findings.filter(row => row.findingType?.toLowerCase() === classification).length;
      rows.push({ id: audit.id, year: schedule?.year ?? null, values: [
        parent(schedule)?.title, sm.qaqcReference ?? pm.qaqcReference, text(json(audit.status).title) ?? schedule?.title ?? audit.referenceNumber,
        list(sm.auditTypes).map(type => label("audit_types", type)).filter(Boolean).join(", "), label("audit_categories", sm.auditCategory),
        source(schedule, audit.projectId), sm.location ?? plan?.location, person(pm.leadAuditorId),
        day(sm.plannedStartDate ?? pm.startDateTime), day(sm.plannedEndDate ?? pm.endDateTime),
        auditIsComplete(audit.workflowState) ? "Closed" : status(audit.workflowState),
        count("ofi"), count("minor nc"), count("moderate nc"), count("major nc"),
        cars.filter(car => car.workflowState !== "closed").length, cars.filter(car => car.workflowState === "closed").length,
        reportDays(sm.plannedEndDate, auditIsComplete(audit.workflowState)
          ? eventDate(audit.id, ["complete", "mark_complete", "update"], true) : data.now),
      ] });
    }
  } else for (const row of scopedFindings) {
    if (report === "car-status" && !row.cars.length) continue;
    for (const car of row.cars.length ? row.cars : [null]) {
      const meta = json(car?.effectivenessNotes);
      const due = car ? day(car.extensionStatus === "approved" && car.extensionDueDate
        ? car.extensionDueDate : carDueDate(row.item?.auditFinding ?? row.finding?.classification,
          findingDateValue(row.item, row.finding), car.dueDate)) : null;
      const closed = car?.workflowState === "closed";
      const closedAt = closed ? day(meta.closedAt) : null;
      const findingClosed = isClosed(row.item?.findingStatus ?? row.finding?.status);
      const findingClosure = closedAt ?? (findingClosed ? day(row.item?.closedAt ?? row.finding?.evidence?.closedAt) : null);
      const ids = [car?.id, row.finding?.id].filter((id): id is string => !!id);
      const linkedEvidence = hasEvidence(row.item?.evidenceIds ?? row.finding?.evidence?.evidenceIds,
        [row.finding?.id].filter(Boolean), ["finding", "audit_finding"]);
      const shared = { id: `${row.id}:${car?.id ?? "no-car"}`, year: row.schedule?.year ?? null };
      if (report === "findings-log") rows.push({ ...shared, values: [
        row.findingNumber, json(row.schedule?.status).auditNumber, row.auditTitle, row.findingDate,
        row.projectDepartment, row.auditTeamLeadName, row.description, row.findingType, row.clauseReference,
        linkedEvidence ? "Yes" : "No", row.actionTakers.map(person => person.name).filter(Boolean).join(", "),
        meta.carNumber, car ? carStatus(car) : null, due, findingClosure,
        reportDays(row.findingDate, closed || findingClosed ? findingClosure : data.now), escalation(ids),
        car ? closed ? "Closed" : "Open" : findingClosed ? status(row.item?.findingStatus ?? row.finding?.status) : status(row.finding?.status === "active" ? "Open" : row.item?.findingStatus ?? row.finding?.status),
      ] });
      else if (car) {
        const route = meta.carApproval as Row | undefined;
        const pending = route?.status === "Pending approval" ? route.steps?.[route.index] : undefined;
        const lead = person(json(byId(data.plans, row.audit.auditPlanId)?.status).leadAuditorId);
        const owner = row.actionTakers.map(person => person.name).filter(Boolean).join(", ") || person(car.ownerId);
        const reviewers = (pending?.approvers ?? []).map((p: Row) => person(p.id) ?? text(p.name)).filter(Boolean);
        rows.push({ ...shared, values: [
          meta.carNumber, json(row.schedule?.status).auditNumber, row.findingNumber, row.projectDepartment, owner,
          row.description, row.riskLevel, row.findingType, due, text(car.rootCause) ? "Yes" : "No", car.correctiveAction,
          hasEvidence(null, [car.id], ["car", "corrective_action_report"]) ? "Yes" : "No", carStatus(car),
          status(meta.reviewOutcome), closed && closedAt && due ? closedAt <= due ? "Yes" : "No" : null,
          closedAt, reportDays(due, closed ? closedAt : data.now), escalation(ids),
          carPendingWith(car.workflowState, owner, lead, !!route, reviewers),
        ] });
      }
    }
  }
  const search = options.search?.trim().toLowerCase();
  const availableYears = [...new Set(rows.map(row => row.year)
    .filter((year): year is number => typeof year === "number" && Number.isInteger(year)))]
    .sort((a, b) => b - a);
  const filtered = rows.filter(row => (!options.year || row.year === options.year)
    && (!search || row.values.some(value => String(value ?? "").toLowerCase().includes(search))));
  return {
    title: definition.title,
    columns: definition.labels.map((label, i) => ({ label, kind: definition.dates.includes(i) ? "date" : definition.numbers.includes(i) ? "number" : "text" })),
    rows: (options.all ? filtered : filtered.slice((options.page - 1) * options.limit, options.page * options.limit))
      .map(row => ({ id: row.id, values: row.values.map(value => value == null || value === "" ? null : String(value)) })),
    total: filtered.length, page: options.page, limit: options.limit, generatedAt: new Date(), availableYears,
  };
}
