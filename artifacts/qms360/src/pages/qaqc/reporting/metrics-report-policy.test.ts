import { describe, expect, it } from 'vitest';
import { canEditMetricsDocument, metricsDocumentHref } from './metrics-report-policy';

describe('Metrics document actions', () => {
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
