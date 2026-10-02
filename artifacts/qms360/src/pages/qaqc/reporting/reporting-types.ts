// Local typing for the generic QAQC SOW report payloads (see .local/qaqc-sow-contract.md).
// Calculated values are always derived; they are previewed on the client and never written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
export type DeepReadonly<T> = T extends (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ReportType = 'monthly' | 'daily' | 'csat';

export const METRICS: [string, string][] = [['external_ncr', 'External NCR'], ['internal_ncr', 'Internal NCR'], ['rfi', 'RFI'], ['rmi', 'RMI']];
export const PQP_STATUSES = ['Approved A', 'Approved B', 'Approved C', 'Under Preparation', 'Under Review with Client', 'Rejected', 'Others'];
export const MEETING_TYPES = ['Project Management Review Meeting', 'Internal Meeting', 'External Meeting', 'Project Quality Meeting'];
export const QMS_TYPES = ['Manual', 'Policy', 'SOP', 'Form'];
export const QMS_STATUSES = ['Under Review and Signature', 'Approved & Published'];
export const AGEING_BUCKETS: [string, string][] = [['0-15', '0-15 days'], ['15-45', '15-45 days'], ['over45', 'Over 45 days']];
export const DISCIPLINES = ['Civil', 'Mechanical', 'Structural', 'Electrical', 'Instrumentation'];
export const DISC_STATUSES: [string, string][] = [['approved', 'Approved'], ['resubmit', 'Resubmit'], ['rejected', 'Rejected'], ['underReview', 'Under review']];
export const DOC_TYPES = ['Drawings', 'Material Submittals', 'Method Statements', 'ITPs', 'CVs', 'PQP', 'IFR', 'Vendors'];
export const ENTITIES = ['Client', 'Algihaz', 'Supplier'];
export const PEND_STATUSES: [string, string][] = [['underReview', 'Under review'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']];
export const PEND_BUCKETS: [string, string][] = [['upTo7', 'Up to 7 days'], ['days8To30', '8-30 days'], ['over30', 'Over 30 days']];
export const CSAT_RATINGS: [string, string][] = [['quality', 'Quality'], ['timeline', 'Timeline'], ['communication', 'Communication'], ['professionalism', 'Professionalism'], ['valueForMoney', 'Value for money'], ['issueHandling', 'Issue handling']];
export const OUTCOMES = ['Yes', 'No', 'Partially'];

export const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sum = (xs: unknown[]) => xs.reduce<number>((a, x) => a + num(x), 0);
const rate = (closed: number, issued: number) => (issued === 0 && closed === 0 ? 100 : issued ? (closed / issued) * 100 : 0);
export const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');

export const QMS_DEPARTMENTS = ['HSSE', 'Quality', 'Finance', 'Fleet & Facilities Management', 'Human Resources', 'Group Digital & Technology', 'Operations'];
const isNum = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// Mirrors the server model: baseline.metrics[k].accumulatedIssued/Closed, baseline.material, baseline.qtbt.
export function monthlyBaseline(b: Obj | undefined, key: string) {
  const s: Obj = b?.metrics?.[key] ?? {};
  return { issued: num(s.accumulatedIssued), closed: num(s.accumulatedClosed) };
}

export function calcMonthly(d: Obj, baseline: Obj | undefined, target?: Obj) {
  const issues: string[] = [];
  const metrics: Record<string, Obj> = {};
  for (const [k, label] of METRICS) {
    const m: Obj = d.metrics?.[k] ?? {};
    const prev = monthlyBaseline(baseline, k);
    const issued = num(m.issued), closed = num(m.closed);
    const accIssued = prev.issued + issued, accClosed = prev.closed + closed;
    const open = accIssued - accClosed;
    const prevRate = rate(prev.closed, prev.issued);
    const accRate = rate(accClosed, accIssued);
    const ageSum = sum((m.ageing ?? []).map((r: Obj) => r.count));
    if (!isNum(m.issued) || !isNum(m.closed)) issues.push(`${label}: issued and closed are required.`);
    if (closed > prev.issued - prev.closed + issued) issues.push(`${label}: closed exceeds outstanding availability.`);
    if ((k === 'external_ncr' || k === 'internal_ncr') && ageSum !== open) issues.push(`${label}: ageing counts (${ageSum}) must equal open count (${open}).`);
    metrics[k] = { prevIssued: prev.issued, prevClosed: prev.closed, accIssued, accClosed, open, monthlyRate: rate(closed, issued), prevRate, accRate, variance: accRate - prevRate, ageSum, target: target?.[k] };
  }
  const avg = (f: string) => sum(METRICS.map(([k]) => metrics[k]![f])) / 4;
  const pqi = { prior: avg('prevRate'), current: avg('accRate'), monthly: avg('monthlyRate'), diff: avg('accRate') - avg('prevRate') };
  const mat: Obj = d.material ?? {};
  const mb: Obj = baseline?.material ?? {};
  const mPrevI = num(mb.accumulatedIssued), mPrevC = num(mb.accumulatedClosed);
  const material = { prevIssued: mPrevI, prevClosed: mPrevC, accIssued: mPrevI + num(mat.issued), accClosed: mPrevC + num(mat.closed), open: mPrevI + num(mat.issued) - mPrevC - num(mat.closed), monthlyRate: rate(num(mat.closed), num(mat.issued)), accRate: rate(mPrevC + num(mat.closed), mPrevI + num(mat.issued)) };
  if (!isNum(mat.issued) || !isNum(mat.closed)) issues.push('Material: issued and closed are required.');
  if (num(mat.closed) > mPrevI - mPrevC + num(mat.issued)) issues.push('Material: closed exceeds available open MIRNs.');
  if (typeof mat.osdAvailable !== 'boolean') issues.push('Material: state whether OSD is available.');
  const tagSum = sum([mat.approved, mat.onHold, mat.rejectedDoNotUse, mat.rejectedReturn, mat.hazardous, mat.handleWithCare]);
  if (mat.totalItems !== undefined && tagSum !== num(mat.totalItems)) issues.push(`Material tags total ${tagSum} but MIRN total items is ${num(mat.totalItems)}.`);
  const q: Obj = d.qtbt ?? {};
  if (!isNum(q.talkCount)) issues.push('QTBT: talks held is required.');
  const manhours = (num(q.attendance) * num(q.durationMinutes)) / 60;
  const bq: Obj = baseline?.qtbt ?? {};
  const qtbt = { manhours, accTalks: num(bq.accumulatedTalkCount) + num(q.talkCount), accManhours: num(bq.accumulatedManhours) + manhours };
  const manpower = { total: sum((d.manpower ?? []).map((r: Obj) => r.count)), approved: sum((d.manpower ?? []).map((r: Obj) => r.approved)), rejected: sum((d.manpower ?? []).map((r: Obj) => r.rejected)) };
  for (const g of ['drawings', 'submittals']) for (const f of ['approved', 'resubmitted', 'rejected', 'underReview', 'clientReviewDays', 'internalReviewDays']) if (!isNum(d.documents?.[g]?.[f])) { issues.push(`Documents (${g}): all counts and review days are required.`); break; }
  if (!d.pqpStatus) issues.push('PQP status is required.');
  if (d.pqpStatus === 'Others' && !String(d.pqpOther ?? '').trim()) issues.push('Describe the PQP status when Others is selected.');
  if (String(d.pqpStatus ?? '').startsWith('Approved') && !d.pqpApprovedDate) issues.push('PQP approved date is required for an approved PQP.');
  if (d.reportReference && (!d.reportFrom || !d.reportTo)) issues.push('Report from and to dates are required when a reference is entered.');
  if (d.reportFrom && d.reportTo && d.reportFrom > d.reportTo) issues.push('Report from date must not be after the to date.');
  if (typeof d.internalAudit?.conducted !== 'boolean' || !d.internalAudit?.lastDate || !d.internalAudit?.nextDate) issues.push('Internal audit: conducted, last date and next date are required.');
  for (const [i, r] of (d.meetings ?? []).entries()) if (r.type && (!r.lastDate || !r.nextDate)) issues.push(`Meeting ${i + 1}: last and next dates are required.`);
  for (const [i, r] of (d.manpower ?? []).entries()) { if (!String(r.department ?? '').trim()) issues.push(`Manpower row ${i + 1}: department is required.`); if (num(r.count) < 1) issues.push(`Manpower row ${i + 1}: headcount must be positive.`); }
  for (const [k] of METRICS.slice(0, 2)) for (const [i, r] of (d.metrics?.[k]?.ageing ?? []).entries()) { if (!String(r.department ?? '').trim()) issues.push(`${k} ageing row ${i + 1}: department is required.`); if (num(r.count) < 1) issues.push(`${k} ageing row ${i + 1}: count must be positive.`); }
  if (!String(d.narrative ?? '').trim()) issues.push('Final assessment narrative is required.');
  return { metrics, pqi, material, tagSum, qtbt, manpower, issues };
}

export function calcDaily(d: Obj) {
  const disc: Record<string, Record<string, number>> = {};
  for (const cat of ['drawings', 'submittals']) for (const dn of DISCIPLINES) {
    const r: Obj = d.disciplines?.[cat]?.[dn] ?? {};
    disc[`${cat}.${dn}`] = { total: sum(DISC_STATUSES.map(([s]) => r[s])) };
  }
  const pending: Record<string, number> = {};
  for (const e of ENTITIES) pending[e] = sum(PEND_STATUSES.flatMap(([s]) => PEND_BUCKETS.map(([b]) => d.pending?.[e]?.[s]?.[b])));
  const issues: string[] = [];
  const names = [...(d.revisions?.drawings ?? []), ...(d.revisions?.submittals ?? [])];
  for (const cat of ['drawings', 'submittals']) {
    const seen = new Set<string>();
    for (const r of d.revisions?.[cat] ?? []) { const n = String(r.name ?? '').trim().toLowerCase(); if (!n) issues.push(`A ${cat} revision needs a name.`); else if (seen.has(n)) issues.push(`Duplicate ${cat} revision name: ${r.name}.`); seen.add(n); }
  }
  void names;
  const missing = dailyPaths().filter(p => p.reduce<any>((a, k) => (a == null ? undefined : a[k]), d) === undefined).length;
  if (missing) issues.push(`${missing} current numeric fields are still blank. Enter values or use Zero-fill.`);
  return { disc, pending, pendingTotal: sum(Object.values(pending)), issues };
}

export function dailyPaths(): (string | number)[][] {
  const out: (string | number)[][] = [];
  for (const cat of ['drawings', 'submittals']) for (const dn of DISCIPLINES) for (const [s] of DISC_STATUSES) out.push(['disciplines', cat, dn, s]);
  for (const t of DOC_TYPES) out.push(['documentTypes', t]);
  for (const e of ENTITIES) for (const [s] of PEND_STATUSES) for (const [b] of PEND_BUCKETS) out.push(['pending', e, s, b]);
  out.push(['correspondence', 'incoming'], ['correspondence', 'outgoing']);
  return out;
}

export function zeroFill(type: ReportType, d: Obj): Obj {
  const z = (x: any): any => (typeof x === 'number' ? 0 : Array.isArray(x) ? x.map(z) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, z(v)])) : x);
  if (type === 'daily') {
    const out: Obj = { ...z(d), noUpdates: true };
    for (const p of dailyPaths()) { let o = out; p.slice(0, -1).forEach(k => { o[k] = o[k] ?? {}; o = o[k]; }); o[p[p.length - 1]!] = 0; }
    for (const c of ['drawings', 'submittals']) out.revisions = { ...out.revisions, [c]: (d.revisions?.[c] ?? []).map((r: Obj) => ({ ...r, value: 0 })) };
    return out;
  }
  const out: Obj = z(d);
  out.noUpdates = true;
  out.metrics = out.metrics ?? {};
  for (const [k] of METRICS) out.metrics[k] = { ...out.metrics[k], issued: 0, closed: 0 };
  out.qtbt = { talkCount: 0, attendance: 0, durationMinutes: 0 };
  return out;
}

export const defaultData = (t: ReportType): Obj =>
  t === 'monthly' ? { noUpdates: false, meetings: MEETING_TYPES.map(type => ({ type, lastDate: '', nextDate: '' })), internalAudit: { conducted: false }, manpower: [], metrics: {}, material: {}, qtbt: {}, documents: { drawings: {}, submittals: {} }, qmsReports: [], narrative: '' }
  : t === 'daily' ? { noUpdates: false, revisions: { drawings: [], submittals: [] } }
  : { ratings: {}, expectations: '', recommend: '' };

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const defaultPeriod = (t: ReportType) => (t !== 'monthly' ? todayIso() : `${todayIso().slice(0, 7)}-01`);
