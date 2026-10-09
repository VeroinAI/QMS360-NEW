import { afterEach, describe, expect, it } from 'vitest';
import { getExcelDateNumberFormat, parseSpreadsheetDate, setDateFormatResolver, type DateFormat } from '@workspace/spreadsheet-dates';
import { dateImportError, explicitHeaderDateFormat, importDateOptions } from './import-date-options';

const use = (f: DateFormat) => setDateFormatResolver(() => f);
afterEach(() => use('DD/MM/YYYY'));

describe('import date options', () => {
  it('reads the same text differently under DD/MM and MM/DD', () => {
    use('DD/MM/YYYY');
    expect(parseSpreadsheetDate('03/04/2026', importDateOptions(['From Date']))).toBe('2026-04-03');
    use('MM/DD/YYYY');
    expect(parseSpreadsheetDate('03/04/2026', importDateOptions(['From Date']))).toBe('2026-03-04');
  });
  it('uses the explicit header annotation instead of guessing', () => {
    use('DD/MM/YYYY');
    const options = importDateOptions(['From Date (MM/DD/YYYY)']);
    expect(explicitHeaderDateFormat(['From Date (MM/DD/YYYY)'])).toBe('MM/DD/YYYY');
    expect(parseSpreadsheetDate('03/04/2026', options)).toBe('2026-03-04');
  });
  it('keeps unambiguous ISO input working in every format', () => {
    use('MM-DD-YYYY');
    expect(parseSpreadsheetDate('2026-04-03', importDateOptions([]))).toBe('2026-04-03');
  });
  it('rejects impossible dates and names the selected format', () => {
    use('MM/DD/YYYY');
    expect(parseSpreadsheetDate('13/01/2026', importDateOptions([]))).toBeNull();
    expect(dateImportError('Period')).toContain('MM/DD/YYYY');
  });
  it('maps the format to a native Excel number format', () => {
    expect(getExcelDateNumberFormat('MM/DD/YYYY')).toBe('mm/dd/yyyy');
    expect(getExcelDateNumberFormat('YYYY-MM-DD')).toBe('yyyy-mm-dd');
  });
});
