import { describe, expect, it } from 'vitest';
import { uniqueProjectRoles } from './project-role-options';

describe('Project Additional Data role options', () => {
  it('combines all application role names once, trimming and sorting them', () => {
    expect(uniqueProjectRoles([
      { name: 'QAQC Representative', active: true },
      { name: 'Audit Lead', active: true },
      { name: 'Lessons Owner', active: true },
      { name: ' audit lead ', active: true },
      { name: 'Inactive role', active: false },
      { name: '  ', active: true },
    ])).toEqual(['Audit Lead', 'Lessons Owner', 'QAQC Representative']);
  });
  it('handles no roles without adding placeholder roles', () => {
    expect(uniqueProjectRoles([])).toEqual([]);
  });
});
