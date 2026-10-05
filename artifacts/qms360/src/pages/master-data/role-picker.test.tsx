import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MasterDataRolePicker } from './role-picker';
const { query } = vi.hoisted(() => ({ query: {
  isLoading: false, isError: false,
  data: { items: [
    { id: 'audit-role', application: 'audit', name: 'Audit Lead', active: true },
    { id: 'qaqc-role', application: 'qaqc', name: 'QA/QC Manager', active: true },
  ] } as { items: { id: string; application: string; name: string; active: boolean }[] } | undefined,
  refetch: vi.fn(),
} }));
vi.mock('@workspace/api-client-react', () => ({ useListMasterDataRoles: () => query }));
beforeEach(() => { query.isLoading = false; query.isError = false; });
describe('Master Data Roles field', () => {
  it('shows Audit roles only in an Audit-scoped group and restores the selection', () => {
    const html = renderToStaticMarkup(<MasterDataRolePicker scope="audit"
      value={[{ application: 'audit', roleId: 'audit-role' }]} onChange={() => {}} />);
    expect(html).toContain('Assigned Roles (optional)');
    expect(html).toContain('Audit Lead');
    expect(html).not.toContain('QA/QC Manager');
    expect(html).toContain('1 role selected');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain('do not change permissions or dropdown visibility');
  });
  it('shows multiple application roles in a global group', () => {
    const html = renderToStaticMarkup(<MasterDataRolePicker scope="global" value={[]} onChange={() => {}} />);
    expect(html).toContain('Audit Lead');
    expect(html).toContain('QA/QC Manager');
    expect(html).toContain('0 roles selected');
  });
  it('shows unavailable selections explicitly rather than dropping them', () => {
    const html = renderToStaticMarkup(<MasterDataRolePicker scope="audit"
      value={[{ application: 'audit', roleId: 'deleted-role' }]} onChange={() => {}} />);
    expect(html).toContain('Unavailable role');
    expect(html).toContain('Remove this selection before saving');
    expect(html).toContain('1 role selected');
  });
});