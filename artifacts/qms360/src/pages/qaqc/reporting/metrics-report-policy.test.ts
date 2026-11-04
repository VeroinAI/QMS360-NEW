import { describe, expect, it } from 'vitest';
import { canEditMetricsDocument, canSubmitMetricsDocument, metricsDocumentHref } from './metrics-report-policy';

describe('Metrics document actions', () => {
  it('requires an identified authorized submitter, not the original creator', () => {
    for (const state of ['draft', 'sent_back']) {
      expect(canSubmitMetricsDocument(state, true, 'creator')).toBe(true);
      expect(canSubmitMetricsDocument(state, true, 'different-submitter')).toBe(true);
      expect(canSubmitMetricsDocument(state, false, 'different-submitter')).toBe(false);
      expect(canSubmitMetricsDocument(state, true, undefined)).toBe(false);
    }
    for (const state of ['submitted', 'approved', '', undefined])
      expect(canSubmitMetricsDocument(state, true, 'different-submitter')).toBe(false);
  });
  it('allows authorized draft and sent-back editing', () => {
    for (const state of ['draft', 'sent_back']) {
      expect(canEditMetricsDocument(state, true)).toBe(true);
      expect(canEditMetricsDocument(state, false)).toBe(false);
    }
    for (const state of ['submitted', 'approved', '', undefined])
      expect(canEditMetricsDocument(state, true)).toBe(false);
  });
  it('keeps Display read-only even for authorized draft and sent-back editors', () => {
    for (const state of ['draft', 'sent_back'])
      expect(canEditMetricsDocument(state, true, true)).toBe(false);
  });
  it('routes authorized drafts and sent-back reports to editing and other documents to Display', () => {
    for (const state of ['draft', 'sent_back']) {
      expect(metricsDocumentHref('report-id', state, true)).toBe('/qaqc/metrics/reports/report-id');
      expect(metricsDocumentHref('report-id', state, false)).toBe('/qaqc/metrics/reports/report-id?mode=view');
    }
    for (const state of ['submitted', 'approved'])
      expect(metricsDocumentHref('report-id', state, true)).toBe('/qaqc/metrics/reports/report-id?mode=view');
  });
});
