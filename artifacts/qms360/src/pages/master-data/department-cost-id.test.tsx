import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterDataValue } from '@workspace/api-client-react';
import { ValueDialog } from './index';

const mocks = vi.hoisted(() => ({
  update: vi.fn(), create: vi.fn(), invalidate: vi.fn(),
  save: undefined as (() => void) | undefined,
}));
vi.mock('@workspace/api-client-react', () => ({
  useCreateMasterDataValue: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateMasterDataValue: () => ({ mutate: mocks.update, isPending: false }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./role-picker', () => ({ MasterDataRolePicker: () => null }));
vi.mock('@/components/ui/dialog', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Box, DialogContent: Box, DialogHeader: Box, DialogTitle: Box,
    DialogDescription: Box, DialogFooter: Box };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => {
    if (children === 'Save value') mocks.save = onClick;
    return <button disabled={disabled}>{children}</button>;
  },
}));

const record: MasterDataValue = {
  id: 'dept-row', groupId: 'department-group', value: 'Civil', label: 'Civil',
  active: true, sortOrder: 0,
  metadata: { costId: '  001-CIV/A  ', assignedRoles: [], legacyNote: 'keep this' },
};
const show = (groupCode = 'departments', value: MasterDataValue | null = record) =>
  renderToStaticMarkup(<ValueDialog groupId="department-group" groupCode={groupCode}
    groupScope="global" auditTypes={[]} value={value} close={() => {}} />);

beforeEach(() => { vi.clearAllMocks(); mocks.save = undefined; });

describe('Department Master Cost ID', () => {
  it.each(['departments', 'department', 'Department Master'])('shows a text field for %s', code => {
    const html = show(code);
    expect(html).toContain('for="department-cost-id"');
    expect(html).toContain('id="department-cost-id"');
    expect(html).toContain('type="text"');
    expect(html).toContain('001-CIV/A');
  });
  it('allows new departments to leave Cost ID blank', () => {
    expect(show('departments', null)).toContain('id="department-cost-id"');
  });
  it('does not add the field to unrelated masters', () => {
    expect(show('disciplines')).not.toContain('id="department-cost-id"');
  });
  it('sends the Cost ID as text and preserves unrelated metadata when editing', () => {
    show();
    mocks.save!();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: record.id, data: expect.objectContaining({
        metadata: { costId: '001-CIV/A', assignedRoles: [], legacyNote: 'keep this' },
      }),
    }), expect.any(Object));
  });
  it('sends an explicit empty string when an existing Cost ID is cleared', () => {
    show('departments', { ...record, metadata: { ...record.metadata, costId: '' } });
    mocks.save!();
    expect(mocks.update.mock.calls[0][0].data.metadata.costId).toBe('');
    expect(mocks.update.mock.calls[0][0].data.metadata.legacyNote).toBe('keep this');
  });
});
