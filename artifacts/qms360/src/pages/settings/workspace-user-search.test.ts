import { describe, expect, it } from 'vitest';
import type { WorkspaceUser } from '@workspace/api-client-react';
import { matchesWorkspaceUserSearch } from './workspace-user-search';

const user: WorkspaceUser = {
  id: 'example-user',
  username: 'example.login',
  fullName: 'Example User',
  email: 'abc@xyz.com',
  platformRole: 'Employee',
  status: 'Active',
  workspaceRoles: [
    { id: 'lead-role', name: 'Audit Team Lead / Auditor', active: true, systemDefault: false, permissions: [] },
    { id: 'reviewer-role', name: 'L2 Approval Role', active: true, systemDefault: false, permissions: [] },
  ],
};

describe('Users & Access search', () => {
  it.each(['Example User', 'example.login', 'abc@xyz.com'])('preserves matching by %s', search => {
    expect(matchesWorkspaceUserSearch(user, search)).toBe(true);
  });

  it.each(['Audit Team Lead', 'Auditor', 'L2 Approval', '  AUDIT TEAM LEAD  '])('matches workspace role %s', search => {
    expect(matchesWorkspaceUserSearch(user, search)).toBe(true);
  });

  it('does not match roles that are not assigned to this user', () => {
    expect(matchesWorkspaceUserSearch(user, 'Program Manager')).toBe(false);
  });

  it('keeps all users when the search is empty or whitespace', () => {
    expect(matchesWorkspaceUserSearch(user, '')).toBe(true);
    expect(matchesWorkspaceUserSearch(user, '   ')).toBe(true);
  });

  it('supports users with no roles and no email', () => {
    const withoutRoles = { ...user, email: null, workspaceRoles: [] };
    expect(matchesWorkspaceUserSearch(withoutRoles, 'Example User')).toBe(true);
    expect(matchesWorkspaceUserSearch(withoutRoles, 'Auditor')).toBe(false);
  });
});