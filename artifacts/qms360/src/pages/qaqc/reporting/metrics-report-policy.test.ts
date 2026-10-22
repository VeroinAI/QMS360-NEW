import { describe, expect, it } from 'vitest';
import { canEditMetricsDocument, canSubmitMetricsDocument, metricsDocumentHref } from './metrics-report-policy';

describe('Metrics document actions', () => {
  it('requires an identified creator, draft state and submission permission', () => {
    expect(canSubmitMetricsDocument('draft', true, 'owner', 'owner')).toBe(true);
    expect(canSubmitMetricsDocument('draft', false, 'owner', 'owner')).toBe(false);
    expect(canSubmitMetricsDocument('draft', true, 'other', 'owner')).toBe(false);
    expect(canSubmitMetricsDocument('draft', true, undefined, undefined)).toBe(false);
    for (const state of ['submitted', 'approved', 'sent_back', undefined])
      expect(canSubmitMetricsDocument(state, true, 'owner', 'owner')).toBe(false);
  });
  it('allows only authorized draft editing', () => {
    expect(canEditMetricsDocument('draft', true)).toBe(true);
    expect(canEditMetricsDocument('draft', false)).toBe(false);
    for (const state of ['submitted', 'approved', 'sent_back', '', undefined])
      expect(canEditMetricsDocument(state, true)).toBe(false);
  });
  it('keeps Display read-only even for authorized draft editors', () => {
    expect(canEditMetricsDocument('draft', true, true)).toBe(false);
  });
  it('routes authorized drafts to editing and all other documents to Display', () => {
    expect(metricsDocumentHref('report-id', 'draft', true)).toBe('/qaqc/metrics/reports/report-id');
    for (const state of ['submitted', 'approved', 'sent_back'])
      expect(metricsDocumentHref('report-id', state, true)).toBe('/qaqc/metrics/reports/report-id?mode=view');
    expect(metricsDocumentHref('report-id', 'draft', false)).toBe('/qaqc/metrics/reports/report-id?mode=view');
  });
});
