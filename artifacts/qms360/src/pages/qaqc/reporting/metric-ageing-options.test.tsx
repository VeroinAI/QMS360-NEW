import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicateNcrAgeingRows, ncrAgeingBucketUsed } from '@workspace/field-controls';
import { FormCtx } from './form-kit';
import { MetricDetailsForm } from './metric-details-form';

const selects = vi.hoisted(() => [] as Array<{ value: string; onValueChange: (value: string) => void }>);
vi.mock('@/components/ui/select', () => ({
  Select: (props: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => {
    selects.push(props);
    return <div>{props.children}</div>;
  },
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  SelectValue: () => <span>Select</span>,
  SelectItem: ({ value, disabled, children }: { value: string; disabled?: boolean; children: ReactNode }) =>
    <span data-option={value} aria-disabled={!!disabled}>{children}</span>,
}));
const rows = [
  { department: 'Civil', bucket: '0-15', count: 1 },
  { department: 'Mechanical', bucket: '0-15', count: 2 },
  { department: 'Civil', bucket: '15-45', count: 3 },
];
function render(ageing = rows) {
  const set = vi.fn();
  const html = renderToStaticMarkup(<FormCtx.Provider value={{
    data: { metrics: { external_ncr: { ageing }, internal_ncr: { ageing: [{ department: 'Civil', bucket: '0-15', count: 1 }] } } },
    readOnly: false, set, fc: () => ({ disabled: false, required: false }), departments: ['Civil', 'Mechanical'],
  }}><MetricDetailsForm Tile={({ children }) => <div>{children}</div>} /></FormCtx.Provider>);
  return { html, set };
}
beforeEach(() => { selects.length = 0; });

describe('NCR ageing bucket choices', () => {
  it('grays out used buckets but retains the current row selection and unused buckets', () => {
    const { html } = render();
    const start = html.indexOf('data-report-field="metrics.external_ncr.ageing.0.bucket"');
    const end = html.indexOf('data-report-field="metrics.external_ncr.ageing.0.count"');
    const bucket = html.slice(start, end);
    expect(bucket).toContain('data-option="0-15" aria-disabled="false"');
    expect(bucket).toContain('data-option="15-45" aria-disabled="true"');
    expect(bucket).toContain('data-option="over45" aria-disabled="false"');
  });
  it('clears a conflicting bucket when a department change would create a duplicate', () => {
    const { set } = render();
    selects.find(select => select.value === 'Mechanical')!.onValueChange('Civil');
    expect(set).toHaveBeenCalledWith(['metrics', 'external_ncr', 'ageing', 1],
      { ...rows[1], department: 'Civil', bucket: '' });
  });
  it('keeps a valid bucket when a department changes without a conflict', () => {
    const { set } = render();
    selects.find(select => select.value === 'Mechanical')!.onValueChange('Electrical');
    expect(set).toHaveBeenCalledWith(['metrics', 'external_ncr', 'ageing', 1],
      { ...rows[1], department: 'Electrical' });
  });
  it('releases a bucket when its other row is removed or changed', () => {
    expect(ncrAgeingBucketUsed(rows, 0, 'Civil', '15-45')).toBe(true);
    expect(ncrAgeingBucketUsed(rows.slice(0, 2), 0, 'Civil', '15-45')).toBe(false);
    expect(ncrAgeingBucketUsed([...rows.slice(0, 2), { ...rows[2], bucket: 'over45' }], 0, 'Civil', '15-45')).toBe(false);
  });
  it('does not block another department and ignores incomplete rows in duplicate checks', () => {
    expect(ncrAgeingBucketUsed(rows, 1, 'Mechanical', '15-45')).toBe(false);
    expect(duplicateNcrAgeingRows([{ department: '', bucket: '0-15' }, { department: '', bucket: '0-15' }])).toEqual([]);
    expect(duplicateNcrAgeingRows([{ department: 'Civil', bucket: '' }, { department: 'Civil', bucket: '' }])).toEqual([]);
  });
  it('keeps legacy duplicates visible so they can be corrected without deleting data', () => {
    const duplicates = [{ ...rows[0] }, { ...rows[0], count: 7 }];
    expect(duplicateNcrAgeingRows(duplicates)).toEqual([{ index: 1, firstIndex: 0 }]);
    expect(render(duplicates).html).toContain('data-option="0-15" aria-disabled="true"');
  });
});
