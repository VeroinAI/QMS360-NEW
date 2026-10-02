import { QMS_DEPARTMENTS, QMS_STATUSES, QMS_TYPES, num, type Obj } from './reporting-types';

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
export const MATERIAL_TAGS = ['approved', 'onHold', 'rejectedDoNotUse', 'rejectedReturn', 'hazardous', 'handleWithCare'] as const;

export function validateAdditionalMetrics(data: Obj, baseline?: Obj, requireBrief = true): string[] {
  const issues: string[] = [];
  const requiredInt = (value: unknown, label: string) => {
    if (!integer(value)) issues.push(`${label} must be an integer greater than or equal to zero.`);
  };
  const optionalInt = (value: unknown, label: string) => {
    if (value != null) requiredInt(value, label);
  };
  const m = data.material ?? {};
  requiredInt(m.issued, 'Material: Issued this Month');
  requiredInt(m.closed, 'Material: Closed this Month');
  const previous = baseline?.material ?? {};
  if (integer(m.issued) && integer(m.closed) && m.closed > num(previous.accumulatedIssued) - num(previous.accumulatedClosed) + m.issued)
    issues.push('Material: Closed this Month cannot exceed available open MIRNs.');
  if (typeof m.osdAvailable !== 'boolean') issues.push('Material: select Yes or No for OSD Available.');
  if (m.osdAvailable === true) requiredInt(m.osdMirns, 'Material: No. of MIRNs with OSD');
  for (const [key, label] of [['overage', 'Total Overage Quantity'], ['shortage', 'Total Shortage Qty'], ['damage', 'Total Damage Qty'], ['defective', 'Total Defective Qty'], ['totalItems', 'Total No. of Material/Items in MIRN']])
    optionalInt(m[key!], `Material: ${label}`);
  if (integer(m.totalItems) && m.totalItems > 0) {
    for (const key of MATERIAL_TAGS) optionalInt(m[key], `Material: ${key}`);
    const tagSum = MATERIAL_TAGS.reduce((sum, key) => sum + num(m[key]), 0);
    if (tagSum !== m.totalItems) issues.push(`Material: status tags total ${tagSum} must equal total items ${m.totalItems}.`);
  }
  const q = data.qtbt ?? {};
  requiredInt(q.talkCount, 'QTBT: Total Nos of QTBT this Month');
  const qtbtInt = num(q.talkCount) > 0 ? requiredInt : optionalInt;
  qtbtInt(q.attendance, 'QTBT: No. of attendees');
  qtbtInt(q.durationMinutes, 'QTBT: Duration (minutes)');
  for (const [key, label] of [['drawings', 'Drawings'], ['submittals', 'Submittals']]) {
    const d = data.documents?.[key!] ?? {};
    for (const [field, title] of [['approved', 'Approved'], ['resubmitted', 'Re-submitted'], ['rejected', 'Rejected'], ['underReview', 'Under Review'], ['clientReviewDays', 'Average Client Review Time'], ['internalReviewDays', 'Average Review Time (Algihaz)']])
      requiredInt(d[field!], `${label}: ${title}`);
  }
  if (data.qmsReports != null && !Array.isArray(data.qmsReports)) issues.push('QMS Report must contain a list of rows.');
  for (const [i, r] of (Array.isArray(data.qmsReports) ? data.qmsReports : []).entries()) {
    const row = r ?? {};
    if (!QMS_DEPARTMENTS.includes(row.department)) issues.push(`QMS Report ${i + 1}: select a valid Department.`);
    if (!QMS_TYPES.includes(row.type)) issues.push(`QMS Report ${i + 1}: select a valid Type.`);
    if (!QMS_STATUSES.includes(row.status)) issues.push(`QMS Report ${i + 1}: select a valid Status.`);
  }
  if (requireBrief && !String(data.narrative ?? '').trim()) issues.push('Quality Assessment Brief is required.');
  return issues;
}

export function normaliseAdditionalMetrics(data: Obj): Obj {
  const material = { ...(data.material ?? {}) };
  if (material.osdAvailable === false) material.osdMirns = 0;
  if (material.totalItems == null || material.totalItems === 0) {
    for (const key of MATERIAL_TAGS) material[key] = 0;
  }
  return { ...data, material, qmsDepartmentInput: 'sow', assessmentConfirmationRequired: true };
}