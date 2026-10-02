import { AGEING_BUCKETS, MEETING_TYPES, METRICS, PQP_STATUSES, monthlyBaseline, type Obj } from './reporting-types';

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';
const integer = (v: unknown, min = 0) => typeof v === 'number' && Number.isInteger(v) && v >= min;
const date = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};

// Scoped to the Metrics entry page; full monthly submission keeps
// its existing, additional validations.
export function validateMetricsEntry(data: Obj, baseline: Obj = {}): string[] {
  const issues: string[] = [];
  const checkDate = (value: unknown, label: string, required = false) => {
    if (!hasValue(value)) { if (required) issues.push(`${label} is required.`); }
    else if (!date(value)) issues.push(`${label} must be a valid date.`);
  };
  if (!PQP_STATUSES.includes(data.pqpStatus)) issues.push('Select a PQP status.');
  if (data.pqpStatus === 'Others' && !String(data.pqpOther ?? '').trim()) issues.push('Describe the other PQP status.');
  if (data.pqpStatus !== 'Under Preparation') checkDate(data.pqpSubmittedDate, 'PQP Submission Date');
  if (['Approved A', 'Approved B', 'Approved C'].includes(data.pqpStatus)) checkDate(data.pqpApprovedDate, 'PQP Approval Date', true);
  const reference = !!String(data.reportReference ?? '').trim();
  checkDate(data.reportFrom, 'Report Date (from)', reference);
  checkDate(data.reportTo, 'Report Date (To)', reference);
  if (date(data.reportFrom) && date(data.reportTo) && data.reportFrom > data.reportTo) issues.push('Report Date (from) must not be after Report Date (To).');
  for (const [i, row] of (data.meetings ?? []).entries()) {
    const label = `Meeting ${i + 1}`;
    if (row.type && !MEETING_TYPES.includes(row.type)) issues.push(`${label}: select a valid meeting type.`);
    if (!row.type && (row.lastDate || row.nextDate)) issues.push(`${label}: select a meeting type for these dates.`);
    checkDate(row.lastDate, `${label} Report Date (from)`, !!row.type);
    checkDate(row.nextDate, `${label} Report Date (To)`, !!row.type);
    if (date(row.lastDate) && date(row.nextDate) && row.lastDate > row.nextDate) issues.push(`${label}: from date must not be after to date.`);
  }
  if (typeof data.internalAudit?.conducted !== 'boolean') issues.push('Select Yes or No for Is Internal Audit Conducted.');
  checkDate(data.internalAudit?.lastDate, 'Last Internal Audit Conducted Date', true);
  checkDate(data.internalAudit?.nextDate, 'Next Internal Audit Conducted Date', true);
  if (!(data.manpower ?? []).length) issues.push('Add at least one Quality Manpower row.');
  for (const [i, row] of (data.manpower ?? []).entries()) {
    const label = `Quality Manpower ${i + 1}`;
    if (!String(row.department ?? '').trim()) issues.push(`${label}: Department is required.`);
    if (!integer(row.count, 1)) issues.push(`${label}: Nos must be an integer greater than zero.`);
    if (typeof row.approvalRequired !== 'boolean') issues.push(`${label}: select whether client approval is required.`);
    if (row.approvalRequired) {
      if (!integer(row.approved)) issues.push(`${label}: approved count must be an integer greater than or equal to zero.`);
      if (!integer(row.rejected)) issues.push(`${label}: rejected count must be an integer greater than or equal to zero.`);
      // Preserve the existing server guard rather than allow a save that fails.
      if (integer(row.approved) && integer(row.rejected) && integer(row.count, 1) && row.approved + row.rejected > row.count) issues.push(`${label}: approved and rejected counts cannot exceed Nos.`);
    }
  }
  for (const [key, label] of METRICS) {
    const metric = data.metrics?.[key] ?? {};
    if (!integer(metric.issued)) issues.push(`${label}: Issued this Month must be an integer greater than or equal to zero.`);
    if (!integer(metric.closed)) issues.push(`${label}: Closed this Month must be an integer greater than or equal to zero.`);
    const previous = monthlyBaseline(baseline, key);
    const validCounts = integer(metric.issued) && integer(metric.closed);
    if (validCounts && metric.closed > previous.issued - previous.closed + metric.issued)
      issues.push(`${label}: Closed this Month cannot exceed the available open items from last month plus items issued this month.`);
    if (key !== 'external_ncr' && key !== 'internal_ncr') continue;
    if (metric.ageing !== undefined && !Array.isArray(metric.ageing)) {
      issues.push(`${label}: ageing must contain a list of rows.`);
      continue;
    }
    const ageing: Obj[] = metric.ageing ?? [];
    let total = 0;
    let validAgeing = true;
    for (const [i, row] of ageing.entries()) {
      const rowLabel = `${label} ageing ${i + 1}`;
      if (!String(row?.department ?? '').trim()) issues.push(`${rowLabel}: select a BU / Department.`);
      if (!AGEING_BUCKETS.some(([value]) => value === row?.bucket)) issues.push(`${rowLabel}: select an Ageing Bucket.`);
      if (!integer(row?.count, 1)) {
        issues.push(`${rowLabel}: Count must be an integer greater than zero.`);
        validAgeing = false;
      } else total += row.count;
    }
    if (validCounts && validAgeing) {
      const open = previous.issued + metric.issued - previous.closed - metric.closed;
      if (total !== open) issues.push(`${label}: ageing counts (${total}) must equal Open NCRs (${open}).`);
    }
  }
  return issues;
}

export function normaliseMetricsEntry(data: Obj): Obj {
  return {
    ...data,
    manpowerDepartmentInput: 'text',
    ...(data.pqpStatus === 'Under Preparation' ? { pqpSubmittedDate: '' } : {}),
    ...(!['Approved A', 'Approved B', 'Approved C'].includes(data.pqpStatus) ? { pqpApprovedDate: '' } : {}),
  };
}