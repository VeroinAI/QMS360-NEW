export type ReportType = "monthly" | "daily" | "csat";
export type ValidationResult = { valid: boolean; errors: string[] };

/** Snapshot differences retain removed named revisions as negative movement. */
export function subtractReportSnapshot(end: any, start: any): any {
  if (typeof end === "number" || (end === undefined && typeof start === "number"))
    return Number(end ?? 0) - Number(start ?? 0);
  if (Array.isArray(end) || Array.isArray(start)) {
    const current = Array.isArray(end) ? end : [];
    const previous = Array.isArray(start) ? start : [];
    if ([...current, ...previous].every(row => row && typeof row.name === "string")) {
      const identity = (row: any) => row.name.trim().toLowerCase();
      const names = [...new Set([...current, ...previous].map(identity))];
      return names.map(name => {
        const currentRow = current.find(row => identity(row) === name);
        const previousRow = previous.find(row => identity(row) === name);
        return { name: currentRow?.name ?? previousRow.name, value: Number(currentRow?.value ?? 0) - Number(previousRow?.value ?? 0) };
      });
    }
    return current.map((item, index) => subtractReportSnapshot(item, previous[index]));
  }
  if (isObject(end) || isObject(start)) {
    const keys = new Set([...Object.keys(end ?? {}), ...Object.keys(start ?? {})]);
    return Object.fromEntries([...keys].map(key => [key, subtractReportSnapshot(end?.[key], start?.[key])]));
  }
  return end;
}
export type MonthlyReportComputed = {
  metrics: Record<string, {
    previousIssued: number; previousClosed: number; issued: number; closed: number;
    accumulatedIssued: number; accumulatedClosed: number; open: number;
    monthlyRate: number; previousAccumulatedRate: number; accumulatedRate: number;
    variance: number; target: number;
  }>;
  pqi: { previous: number; accumulated: number; variance: number; monthly: number };
  material: {
    previousIssued: number; previousClosed: number; issued: number; closed: number;
    accumulatedIssued: number; accumulatedClosed: number; open: number;
    monthlyRate: number; accumulatedRate: number; variance: number;
  };
  manpower: { count: number; approved: number; rejected: number };
  qtbt: { manhours: number; accumulatedTalkCount: number; accumulatedManhours: number };
};
export type DailyReportComputed = {
  disciplines?: Record<string, unknown>;
  disciplineTotals: Record<string, number>;
  pendingTotals: Record<string, number>;
  documentTypes: Record<string, unknown>;
  pending: Record<string, unknown>;
  correspondence: Record<string, unknown>;
  revisions: Record<string, unknown>;
};
export type CsatReportComputed = { averageRating: number; ratings: Record<string, number> };
export type ReportComputed = MonthlyReportComputed | DailyReportComputed | CsatReportComputed;

const METRICS = ["external_ncr", "internal_ncr", "rfi", "rmi"] as const;
const DISCIPLINES = ["Civil", "Mechanical", "Structural", "Electrical", "Instrumentation"] as const;
const DAILY_STATUSES = ["approved", "resubmit", "rejected", "underReview"] as const;
const ENTITIES = ["Client", "Algihaz", "Supplier"] as const;
const PENDING_STATUSES = ["underReview", "A", "B", "C", "D", "E"] as const;
const BUCKETS = ["upTo7", "days8To30", "over30"] as const;
const DOCUMENT_TYPES = ["Drawings", "Material Submittals", "Method Statements", "ITPs", "CVs", "PQP", "IFR", "Vendors"] as const;
const RATINGS = ["quality", "timeline", "communication", "professionalism", "valueForMoney", "issueHandling"] as const;
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numeric = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const pct = (closed: number, issued: number) => issued === 0 && closed === 0 ? 100 : issued === 0 ? 0 : closed / issued * 100;
const round = (n: number) => Number(n.toFixed(2));

function calculateMonthly(data: Record<string, any>, baseline: Record<string, any>, targets: Record<string, unknown>): MonthlyReportComputed {
  const metrics: Record<string, any> = {};
  for (const key of METRICS) {
    const current = isObject(data.metrics?.[key]) ? data.metrics[key] : {};
    const previous = isObject(baseline.metrics?.[key]) ? baseline.metrics[key] : {};
    const prevIssued = Number(previous.accumulatedIssued ?? 0);
    const prevClosed = Number(previous.accumulatedClosed ?? 0);
    const issued = Number(current.issued ?? 0);
    const closed = Number(current.closed ?? 0);
    const accIssued = prevIssued + issued;
    const accClosed = prevClosed + closed;
    const priorRate = pct(prevClosed, prevIssued);
    const monthlyRate = pct(closed, issued);
    const accumulatedRate = pct(accClosed, accIssued);
    metrics[key] = {
      previousIssued: prevIssued, previousClosed: prevClosed, issued, closed,
      accumulatedIssued: accIssued, accumulatedClosed: accClosed,
      open: accIssued - accClosed, monthlyRate: round(monthlyRate),
      previousAccumulatedRate: round(priorRate), accumulatedRate: round(accumulatedRate),
      variance: round(accumulatedRate - priorRate),
      target: Number(targets[key] ?? 100),
    };
  }
  const pqiPrevious = METRICS.reduce((sum, key) => sum + metrics[key].previousAccumulatedRate, 0) / METRICS.length;
  const pqiAccumulated = METRICS.reduce((sum, key) => sum + metrics[key].accumulatedRate, 0) / METRICS.length;
  const pqiMonthly = METRICS.reduce((sum, key) => sum + metrics[key].monthlyRate, 0) / METRICS.length;
  const material = data.material ?? {};
  const matBaseline = baseline.material ?? {};
  const materialIssued = Number(material.issued ?? 0);
  const materialClosed = Number(material.closed ?? 0);
  const materialAccIssued = Number(matBaseline.accumulatedIssued ?? 0) + materialIssued;
  const materialAccClosed = Number(matBaseline.accumulatedClosed ?? 0) + materialClosed;
  const qtbt = data.qtbt ?? {};
  const previousQtbt = baseline.qtbt ?? {};
  const manhours = Number(qtbt.attendance ?? 0) * Number(qtbt.durationMinutes ?? 0) / 60;
  const manpower = Array.isArray(data.manpower) ? data.manpower : [];
  return {
    metrics,
    pqi: { previous: round(pqiPrevious), accumulated: round(pqiAccumulated), variance: round(pqiAccumulated - pqiPrevious), monthly: round(pqiMonthly) },
    material: {
      previousIssued: Number(matBaseline.accumulatedIssued ?? 0),
      previousClosed: Number(matBaseline.accumulatedClosed ?? 0),
      issued: materialIssued, closed: materialClosed, accumulatedIssued: materialAccIssued,
      accumulatedClosed: materialAccClosed, open: materialAccIssued - materialAccClosed,
      monthlyRate: round(pct(materialClosed, materialIssued)),
      accumulatedRate: round(pct(materialAccClosed, materialAccIssued)),
      variance: round(pct(materialAccClosed, materialAccIssued) - pct(Number(matBaseline.accumulatedClosed ?? 0), Number(matBaseline.accumulatedIssued ?? 0))),
    },
    manpower: {
      count: manpower.reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0),
      approved: manpower.reduce((sum: number, row: any) => sum + Number(row.approved ?? 0), 0),
      rejected: manpower.reduce((sum: number, row: any) => sum + Number(row.rejected ?? 0), 0),
    },
    qtbt: {
      manhours: round(manhours), accumulatedTalkCount: Number(previousQtbt.accumulatedTalkCount ?? 0) + Number(qtbt.talkCount ?? 0),
      accumulatedManhours: round(Number(previousQtbt.accumulatedManhours ?? 0) + manhours),
    },
  };
}

function validateMonthly(data: Record<string, any>, baseline: Record<string, any>, submit: boolean, errors: string[]) {
  const requiredNumber = (v: unknown, path: string) => {
    if (submit && !numeric(v)) errors.push(`${path} must be an integer greater than or equal to zero`);
    else if (v !== undefined && !numeric(v)) errors.push(`${path} must be an integer greater than or equal to zero`);
  };
  if (submit && (typeof data.narrative !== "string" || !data.narrative.trim())) errors.push("narrative is required");
  if (data.pqpStatus && !["Approved A", "Approved B", "Approved C", "Under Preparation", "Under Review with Client", "Rejected", "Others"].includes(data.pqpStatus)) errors.push("pqpStatus is invalid");
  if (submit && !data.pqpStatus) errors.push("pqpStatus is required");
  if (data.pqpStatus === "Others" && submit && !String(data.pqpOther ?? "").trim()) errors.push("pqpOther is required when pqpStatus is Others");
  if (data.pqpStatus === "Under Preparation" && data.pqpSubmittedDate) errors.push("pqpSubmittedDate is not allowed while PQP status is Under Preparation");
  if (["Approved A", "Approved B", "Approved C"].includes(data.pqpStatus) && submit && !data.pqpApprovedDate) errors.push("pqpApprovedDate is required for approved PQP status");
  for (const key of ["pqpSubmittedDate", "pqpApprovedDate"]) if (data[key] && !validDate(data[key])) errors.push(`${key} must be a valid date`);
  if (data.reportReference && (!data.reportFrom || !data.reportTo)) errors.push("reportFrom and reportTo are required when reportReference is entered");
  if (data.reportReference && (!validDate(data.reportFrom) || !validDate(data.reportTo))) errors.push("reportFrom and reportTo must be valid dates");
  if (data.reportFrom && data.reportTo && data.reportFrom > data.reportTo) errors.push("reportFrom must not be after reportTo");
  if (submit && !isObject(data.internalAudit)) errors.push("internalAudit is required");
  if (data.internalAudit && typeof data.internalAudit.conducted !== "boolean") errors.push("internalAudit.conducted must be Yes or No");
  if (submit && data.internalAudit && (!data.internalAudit.lastDate || !data.internalAudit.nextDate)) errors.push("internalAudit lastDate and nextDate are required");
  if (data.internalAudit && ((data.internalAudit.lastDate && !validDate(data.internalAudit.lastDate)) || (data.internalAudit.nextDate && !validDate(data.internalAudit.nextDate)))) errors.push("internalAudit dates must be valid dates");
  if (data.meetings !== undefined && !Array.isArray(data.meetings)) errors.push("meetings must be an array");
  for (const [i, row] of (Array.isArray(data.meetings) ? data.meetings : []).entries()) {
    if (!isObject(row)) { errors.push(`meetings.${i} must be an object`); continue; }
    if (row.type && !["Project Management Review Meeting", "Internal Meeting", "External Meeting", "Project Quality Meeting"].includes(row.type)) errors.push(`meetings.${i}.type is invalid`);
    if (row.type && (!row.lastDate || !row.nextDate)) errors.push(`meetings.${i} requires lastDate and nextDate`);
    if ((row.lastDate && !validDate(row.lastDate)) || (row.nextDate && !validDate(row.nextDate))) errors.push(`meetings.${i} dates must be valid dates`);
  }
  if (data.manpower !== undefined && !Array.isArray(data.manpower)) errors.push("manpower must be an array");
  for (const [i, row] of (Array.isArray(data.manpower) ? data.manpower : []).entries()) {
    if (!isObject(row)) { errors.push(`manpower.${i} must be an object`); continue; }
    if (submit && !String(row.department ?? "").trim()) errors.push(`manpower.${i}.department is required`);
    if ((submit || row.count !== undefined) && (!numeric(row.count) || row.count < 1)) errors.push(`manpower.${i}.count must be a positive integer`);
    if (submit && typeof row.approvalRequired !== "boolean") errors.push(`manpower.${i}.approvalRequired is required`);
    else if (row.approvalRequired !== undefined && typeof row.approvalRequired !== "boolean") errors.push(`manpower.${i}.approvalRequired must be a boolean`);
    if (row.approvalRequired) {
      requiredNumber(row.approved, `manpower.${i}.approved`);
      requiredNumber(row.rejected, `manpower.${i}.rejected`);
      if (numeric(row.count) && numeric(row.approved) && numeric(row.rejected) && row.approved + row.rejected > row.count)
        errors.push(`manpower.${i} approved and rejected cannot exceed headcount`);
    } else if ((row.approved ?? 0) !== 0 || (row.rejected ?? 0) !== 0) errors.push(`manpower.${i} approved/rejected must be zero when approval is not required`);
  }
  for (const key of METRICS) {
    const current = data.metrics?.[key] ?? {};
    const previous = baseline.metrics?.[key] ?? {};
    requiredNumber(current.issued, `metrics.${key}.issued`);
    requiredNumber(current.closed, `metrics.${key}.closed`);
    const issued = Number(current.issued ?? 0), closed = Number(current.closed ?? 0);
    if (closed > Number(previous.accumulatedIssued ?? 0) - Number(previous.accumulatedClosed ?? 0) + issued) errors.push(`metrics.${key}.closed exceeds available open items`);
    if (key === "external_ncr" || key === "internal_ncr") {
      if (current.ageing !== undefined && !Array.isArray(current.ageing)) errors.push(`metrics.${key}.ageing must be an array`);
      const ageing = Array.isArray(current.ageing) ? current.ageing : [];
      let total = 0;
      for (const [i, row] of ageing.entries()) {
        if (!isObject(row)) { errors.push(`metrics.${key}.ageing.${i} must be an object`); continue; }
        if (!String(row.department ?? "").trim()) errors.push(`metrics.${key}.ageing.${i}.department is required`);
        if (!["0-15", "15-45", "over45"].includes(row.bucket)) errors.push(`metrics.${key}.ageing.${i}.bucket is invalid`);
        if (!numeric(row.count) || row.count < 1) errors.push(`metrics.${key}.ageing.${i}.count must be a positive integer`);
        total += Number(row.count ?? 0);
      }
      if (submit && total !== Number(previous.accumulatedIssued ?? 0) + issued - Number(previous.accumulatedClosed ?? 0) - closed) errors.push(`metrics.${key}.ageing counts must equal open count`);
    }
  }
  const material = data.material ?? {};
  requiredNumber(material.issued, "material.issued");
  requiredNumber(material.closed, "material.closed");
  for (const key of ["osdMirns", "overage", "shortage", "damage", "defective", "totalItems", "approved", "onHold", "rejectedDoNotUse", "rejectedReturn", "hazardous", "handleWithCare"])
    if (material[key] !== undefined) requiredNumber(material[key], `material.${key}`);
  if (submit && typeof material.osdAvailable !== "boolean") errors.push("material.osdAvailable is required");
  if (material.closed > Number(baseline.material?.accumulatedIssued ?? 0) - Number(baseline.material?.accumulatedClosed ?? 0) + Number(material.issued ?? 0)) errors.push("material.closed exceeds available open MIRNs");
  if (material.osdAvailable && !numeric(material.osdMirns)) errors.push("material.osdMirns is required when OSD is available");
  const tagSum = ["approved", "onHold", "rejectedDoNotUse", "rejectedReturn", "hazardous", "handleWithCare"].reduce((sum, key) => sum + Number(material[key] ?? 0), 0);
  if (material.totalItems !== undefined && submit) {
    for (const key of ["approved", "onHold", "rejectedDoNotUse", "rejectedReturn", "hazardous", "handleWithCare"]) requiredNumber(material[key], `material.${key}`);
    if (tagSum !== Number(material.totalItems ?? 0)) errors.push("material status tags must sum to totalItems");
  }
  const qtbt = data.qtbt ?? {};
  requiredNumber(qtbt.talkCount, "qtbt.talkCount");
  if (Number(qtbt.talkCount ?? 0) > 0) {
    requiredNumber(qtbt.attendance, "qtbt.attendance");
    requiredNumber(qtbt.durationMinutes, "qtbt.durationMinutes");
  }
  for (const section of ["drawings", "submittals"]) {
    const value = data.documents?.[section];
    if (!value) { if (submit) errors.push(`documents.${section} is required`); continue; }
    if (!isObject(value)) { errors.push(`documents.${section} must be an object`); continue; }
    for (const field of ["approved", "resubmitted", "rejected", "underReview", "clientReviewDays", "internalReviewDays"]) requiredNumber(value[field], `documents.${section}.${field}`);
  }
  const departments = ["HSSE", "Quality", "Finance", "Fleet & Facilities Management", "Human Resources", "Group Digital & Technology", "Operations"];
  if (data.qmsReports !== undefined && !Array.isArray(data.qmsReports)) errors.push("qmsReports must be an array");
  for (const [i, row] of (Array.isArray(data.qmsReports) ? data.qmsReports : []).entries()) {
    if (!isObject(row)) { errors.push(`qmsReports.${i} must be an object`); continue; }
    if (!departments.includes(row.department)) errors.push(`qmsReports.${i}.department is invalid`);
    if (!["Manual", "Policy", "SOP", "Form"].includes(row.type)) errors.push(`qmsReports.${i}.type is invalid`);
    if (!["Under Review and Signature", "Approved & Published"].includes(row.status)) errors.push(`qmsReports.${i}.status is invalid`);
  }
}

function validateDaily(data: Record<string, any>, submit: boolean, errors: string[]) {
  const check = (v: unknown, path: string) => {
    if (submit && !numeric(v)) errors.push(`${path} is required and must be a nonnegative integer`);
    else if (v !== undefined && !numeric(v)) errors.push(`${path} must be a nonnegative integer`);
  };
  for (const section of ["drawings", "submittals"]) {
    const block = data.disciplines?.[section];
    for (const discipline of DISCIPLINES) for (const status of DAILY_STATUSES) check(block?.[discipline]?.[status], `disciplines.${section}.${discipline}.${status}`);
    const revisions = data.revisions?.[section];
    if (submit && !Array.isArray(revisions)) errors.push(`revisions.${section} is required`);
    if (Array.isArray(revisions)) {
      const names = new Set<string>();
      revisions.forEach((row: any, i: number) => {
        if (!String(row.name ?? "").trim()) errors.push(`revisions.${section}.${i}.name is required`);
        else if (names.has(String(row.name).trim().toLowerCase())) errors.push(`revisions.${section} revision names must be unique`);
        names.add(String(row.name ?? "").trim().toLowerCase());
        check(row.value, `revisions.${section}.${i}.value`);
      });
    }
  }
  for (const type of DOCUMENT_TYPES) check(data.documentTypes?.[type], `documentTypes.${type}`);
  for (const entity of ENTITIES) for (const status of PENDING_STATUSES) for (const bucket of BUCKETS)
    check(data.pending?.[entity]?.[status]?.[bucket], `pending.${entity}.${status}.${bucket}`);
  for (const field of ["incoming", "outgoing"]) check(data.correspondence?.[field], `correspondence.${field}`);
}

function validateCsat(data: Record<string, any>, submit: boolean, errors: string[]) {
  for (const key of RATINGS) {
    const value = data.ratings?.[key];
    if ((submit && (!Number.isInteger(value) || value < 1 || value > 5)) || (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5))) errors.push(`ratings.${key} must be an integer from 1 to 5`);
  }
  for (const key of ["expectations", "recommend"]) {
    const value = data[key];
    if (submit && !["Yes", "No", "Partially"].includes(value)) errors.push(`${key} must be Yes, No, or Partially`);
    else if (value !== undefined && !["Yes", "No", "Partially"].includes(value)) errors.push(`${key} must be Yes, No, or Partially`);
  }
}

export function calculateReport(reportType: ReportType, data: Record<string, any>, baseline: Record<string, any>, targets: Record<string, unknown> = {}): ReportComputed {
  if (reportType === "monthly") return calculateMonthly(data, baseline, targets);
  if (reportType === "csat") {
    const values = RATINGS.map((key) => Number(data.ratings?.[key] ?? 0));
    return { averageRating: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0, ratings: data.ratings ?? {} };
  }
  const sums: Record<string, number> = {};
  for (const section of ["drawings", "submittals"]) for (const discipline of DISCIPLINES) {
    sums[`${section}.${discipline}`] = DAILY_STATUSES.reduce((sum, status) => sum + Number(data.disciplines?.[section]?.[discipline]?.[status] ?? 0), 0);
  }
  const pendingTotals: Record<string, number> = {};
  for (const entity of ENTITIES) pendingTotals[entity] = PENDING_STATUSES.reduce((sum, status) =>
    sum + BUCKETS.reduce((inner, bucket) => inner + Number(data.pending?.[entity]?.[status]?.[bucket] ?? 0), 0), 0);
  return {
    disciplineTotals: sums, pendingTotals,
    disciplines: data.disciplines ?? {},
    documentTypes: data.documentTypes ?? {},
    pending: data.pending ?? {},
    correspondence: data.correspondence ?? {},
    revisions: data.revisions ?? {},
  };
}

export function validateReportData(reportType: ReportType, data: Record<string, any>, baseline: Record<string, any>, submit: boolean): ValidationResult {
  const errors: string[] = [];
  if (!isObject(data)) return { valid: false, errors: ["data must be an object"] };
  if (reportType === "monthly") validateMonthly(data, baseline ?? {}, submit, errors);
  else if (reportType === "daily") validateDaily(data, submit, errors);
  else if (reportType === "csat") validateCsat(data, submit, errors);
  else errors.push("reportType must be monthly, daily, or csat");
  return { valid: errors.length === 0, errors };
}