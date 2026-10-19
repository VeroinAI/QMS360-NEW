import { exportQaqcSowReport } from '@workspace/api-client-react';

/** Both monthly download entry points use the approved Word-based PDF layout. */
export function exportMonthlyReportPdf(reportId: string) {
  return exportQaqcSowReport(reportId, { templateId: 'monthly-metrics' }, { headers: { Accept: 'application/pdf' } });
}
