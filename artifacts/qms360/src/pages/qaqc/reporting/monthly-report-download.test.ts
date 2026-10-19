import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportMonthlyReportPdf } from './monthly-report-download';

const api = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ exportQaqcSowReport: api }));
beforeEach(() => vi.clearAllMocks());

describe('Shared monthly report PDF export', () => {
  it('requests the approved monthly PDF layout for the saved report', async () => {
    const response = { blob: new Blob(['pdf'], { type: 'application/pdf' }) };
    api.mockResolvedValueOnce(response);
    expect(await exportMonthlyReportPdf('monthly-1')).toBe(response);
    expect(api).toHaveBeenCalledWith('monthly-1', { templateId: 'monthly-metrics' }, { headers: { Accept: 'application/pdf' } });
  });
  it('propagates export errors to the callers instead of downloading another layout', async () => {
    api.mockRejectedValueOnce(new Error('Export denied'));
    await expect(exportMonthlyReportPdf('monthly-1')).rejects.toThrow('Export denied');
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('connects the editor and landing downloads to the same exporter without changing Excel', () => {
    const editor = readFileSync(new URL('./report-editor.tsx', import.meta.url), 'utf8');
    const list = readFileSync(new URL('./metrics-report-list.tsx', import.meta.url), 'utf8');
    expect(editor).toContain('exportMonthlyReportPdf(report.id)');
    expect(list).toContain('exportMonthlyReportPdf(r.id)');
    expect(editor).not.toContain('PdfTemplatePicker');
    expect(editor).toContain("exportQaqcSowReport(report.id, undefined, { headers: { Accept: XLSX_MIME } })");
  });
});
