import { describe, expect, it } from 'vitest';
import { MATERIAL_TAGS, normaliseAdditionalMetrics, validateAdditionalMetrics } from './additional-metrics-validation';
import { METRICS, calcMonthly, type Obj } from './reporting-types';
import { editAssessmentData, resetAssessmentReview } from './assessment-editing';

const valid = (): Obj => ({
  material: { issued: 0, closed: 0, osdAvailable: false },
  qtbt: { talkCount: 0 },
  documents: Object.fromEntries(['drawings', 'submittals'].map(key => [key, { approved: 0, resubmitted: 0, rejected: 0, underReview: 0, clientReviewDays: 0, internalReviewDays: 0 }])),
  qmsReports: [],
  narrative: 'Reviewed monthly quality.',
});

describe('additional Metrics fields', () => {
  it('allows zero mandatory counts, optional blanks and an unconfirmed draft', () => {
    expect(validateAdditionalMetrics(valid())).toEqual([]);
    expect(normaliseAdditionalMetrics(valid())).toMatchObject({ assessmentConfirmationRequired: true, qmsDepartmentInput: 'sow' });
  });
  it('enforces material issued/closed integers and outstanding availability', () => {
    for (const bad of [undefined, null, '', -1, 0.5, NaN, Infinity]) {
      expect(validateAdditionalMetrics({ ...valid(), material: { issued: bad, closed: 0, osdAvailable: false } }).join(' ')).toContain('Issued this Month');
      expect(validateAdditionalMetrics({ ...valid(), material: { issued: 0, closed: bad, osdAvailable: false } }).join(' ')).toContain('Closed this Month');
    }
    const baseline = { material: { accumulatedIssued: 10, accumulatedClosed: 8 } };
    expect(validateAdditionalMetrics({ ...valid(), material: { issued: 1, closed: 3, osdAvailable: false } }, baseline)).toEqual([]);
    expect(validateAdditionalMetrics({ ...valid(), material: { issued: 1, closed: 4, osdAvailable: false } }, baseline).join(' ')).toContain('available open MIRNs');
  });
  it('requires OSD choice and OSD MIRNs only for Yes, zero is valid', () => {
    const data = valid();
    delete data.material.osdAvailable;
    expect(validateAdditionalMetrics(data).join(' ')).toContain('select Yes or No');
    data.material.osdAvailable = true;
    expect(validateAdditionalMetrics(data).join(' ')).toContain('No. of MIRNs with OSD');
    data.material.osdMirns = 0;
    expect(validateAdditionalMetrics(data)).toEqual([]);
    data.material.osdAvailable = false;
    data.material.osdMirns = -1;
    expect(validateAdditionalMetrics(data)).toEqual([]);
    expect(normaliseAdditionalMetrics(data).material.osdMirns).toBe(0);
    expect(data.material.osdMirns).toBe(-1);
  });
  it.each(['overage', 'shortage', 'damage', 'defective', 'totalItems'])('keeps %s optional but validates supplied values, including when OSD is No', key => {
    const data = valid();
    data.material[key] = -1;
    expect(validateAdditionalMetrics(data)).toHaveLength(1);
    data.material[key] = 0;
    expect(validateAdditionalMetrics(data)).toEqual([]);
  });
  it('clears disabled status counts in the payload without clearing editable form values', () => {
    const data = valid();
    for (const k of MATERIAL_TAGS) data.material[k] = 3;
    data.material.totalItems = 0;
    const clean = normaliseAdditionalMetrics(data);
    expect(validateAdditionalMetrics(clean)).toEqual([]);
    for (const k of MATERIAL_TAGS) {
      expect(clean.material[k]).toBe(0);
      expect(data.material[k]).toBe(3);
    }
  });
  it('keeps the server status-total guard and validates active status counters', () => {
    const data = valid();
    data.material.totalItems = 4;
    data.material.approved = 3;
    expect(validateAdditionalMetrics(data).join(' ')).toContain('status tags total 3');
    data.material.onHold = 1;
    expect(validateAdditionalMetrics(data)).toEqual([]);
    data.material.onHold = 0.5;
    expect(validateAdditionalMetrics(data).join(' ')).toContain('onHold must be an integer');
  });
  it('requires QTBT attendees and duration only when the session count is positive', () => {
    const data = valid();
    data.qtbt.talkCount = 1;
    expect(validateAdditionalMetrics(data)).toHaveLength(2);
    data.qtbt.attendance = 0;
    data.qtbt.durationMinutes = 0;
    expect(validateAdditionalMetrics(data)).toEqual([]);
    data.qtbt.talkCount = 0;
    data.qtbt.attendance = -1;
    expect(validateAdditionalMetrics(data)).toHaveLength(1);
  });
  it('uses participant-hours and carries forward talk counts/manhours', () => {
    const data = valid();
    data.qtbt = { talkCount: 2, attendance: 12, durationMinutes: 45 };
    expect(calcMonthly(data, { qtbt: { accumulatedTalkCount: 3, accumulatedManhours: 5 } }).qtbt).toMatchObject({ manhours: 9, accTalks: 5, accManhours: 14 });
  });
  it('requires all four document statuses and both review times for both fixed types', () => {
    for (const group of ['drawings', 'submittals']) for (const field of ['approved', 'resubmitted', 'rejected', 'underReview', 'clientReviewDays', 'internalReviewDays']) {
      const data = valid();
      delete data.documents[group][field];
      expect(validateAdditionalMetrics(data)).toHaveLength(1);
      data.documents[group][field] = 0.5;
      expect(validateAdditionalMetrics(data)).toHaveLength(1);
    }
  });
  it('validates each added QMS row against the supplied dropdown choices', () => {
    const data = valid();
    data.qmsReports = [{}];
    expect(validateAdditionalMetrics(data)).toHaveLength(3);
    data.qmsReports = [{ department: 'HSSE', type: 'Manual', status: 'Approved & Published' }];
    expect(validateAdditionalMetrics(data)).toEqual([]);
    data.qmsReports[0].department = 'Unlisted';
    expect(validateAdditionalMetrics(data)).toHaveLength(1);
    data.qmsReports = {};
    expect(validateAdditionalMetrics(data).join(' ')).toContain('list of rows');
  });
  it('requires final text for save but allows first suggestion with a blank assessment', () => {
    const data = { ...valid(), narrative: '  ' };
    expect(validateAdditionalMetrics(data)).toEqual(['Quality Assessment Brief is required.']);
    expect(validateAdditionalMetrics(data, {}, false)).toEqual([]);
  });
});

describe('assessment review lifecycle', () => {
  it.each([[['narrative'], 'New assessment'], [['metrics', 'rfi', 'issued'], 4], [['material', 'osdAvailable'], true], [['qmsReports'], []]])('invalidates confirmation on edits at %s', (path, value) => {
    const data = { ...valid(), assessmentConfirmationRequired: true, assessmentConfirmed: true };
    expect(editAssessmentData(data, path as (string | number)[], value).assessmentConfirmed).toBe(false);
    expect(data.assessmentConfirmed).toBe(true);
  });
  it('allows explicit confirmation and protects legacy forms from new confirmation requirements', () => {
    expect(editAssessmentData({ assessmentConfirmed: false }, ['assessmentConfirmed'], true, true).assessmentConfirmed).toBe(true);
    expect(editAssessmentData({ narrative: 'Old' }, ['narrative'], 'New')).not.toHaveProperty('assessmentConfirmed');
    expect(resetAssessmentReview({ assessmentConfirmationRequired: true, assessmentConfirmed: true }).assessmentConfirmed).toBe(false);
  });
  it('requires renewed confirmation before submitting a marked monthly report, not before saving a draft', () => {
    const data = { ...valid(), assessmentConfirmationRequired: true, metrics: Object.fromEntries(METRICS.map(([key]) => [key, { issued: 0, closed: 0 }])) };
    expect(calcMonthly(data, {}).issues.join(' ')).toContain('Review and confirm');
    expect(validateAdditionalMetrics(data)).toEqual([]);
    expect(calcMonthly({ ...data, assessmentConfirmed: true }, {}).issues.join(' ')).not.toContain('Review and confirm');
  });
});