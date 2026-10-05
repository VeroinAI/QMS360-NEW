import { describe, expect, it } from 'vitest';
import { applicationSection } from './application-section';

describe('application sidebar context', () => {
  it.each(['audit', 'qaqc', 'lessons'] as const)('keeps %s settings and nested tabs inside their application', app => {
    for (const path of [`/${app}`, `/${app}/overview`, `/settings/${app}`, `/settings/${app}/roles`, `/settings/${app}/access`, `/settings/${app}/form-fields`]) {
      expect(applicationSection(path)).toBe(app);
    }
  });
  it.each(['/', '/executive', '/sync', '/cockpit', '/feedback'])('preserves system navigation on %s', path => {
    expect(applicationSection(path)).toBeNull();
  });
  it('updates the context when navigating between Audit, its settings, and another application', () => {
    expect(['/audit', '/settings/audit', '/settings/audit/roles', '/audit/schedules', '/settings/qaqc', '/lessons']
      .map(applicationSection)).toEqual(['audit', 'audit', 'audit', 'audit', 'qaqc', 'lessons']);
  });
});