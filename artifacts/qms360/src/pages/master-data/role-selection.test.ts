import { describe, expect, it } from 'vitest';
import { roleKey, toggleRole } from './role-selection';
const audit = { application: 'audit' as const, roleId: 'same-id' };
const lessons = { application: 'lessons' as const, roleId: 'same-id' };
describe('Master Data role selections', () => {
  it('supports one or multiple roles and keeps application identity', () => {
    expect(toggleRole([], audit, true)).toEqual([audit]);
    expect(toggleRole([audit], lessons, true)).toEqual([audit, lessons]);
    expect(roleKey(audit)).not.toBe(roleKey(lessons));
  });
  it('does not duplicate roles and supports removing one or the last role', () => {
    expect(toggleRole([audit], audit, true)).toEqual([audit]);
    expect(toggleRole([audit, lessons], audit, false)).toEqual([lessons]);
    expect(toggleRole([audit], audit, false)).toEqual([]);
  });
  it('does not mutate loaded assignments while editing or cancelling', () => {
    const saved = [audit];
    toggleRole(saved, lessons, true);
    expect(saved).toEqual([audit]);
  });
});