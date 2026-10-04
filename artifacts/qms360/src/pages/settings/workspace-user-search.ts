import type { WorkspaceUser } from '@workspace/api-client-react';

export function matchesWorkspaceUserSearch(
  user: Pick<WorkspaceUser, 'fullName' | 'username' | 'email' | 'workspaceRoles'>,
  search: string,
): boolean {
  const text = [
    user.fullName,
    user.username,
    user.email ?? '',
    ...user.workspaceRoles.map(role => role.name),
  ].join(' ').toLowerCase();
  return text.includes(search.trim().toLowerCase());
}