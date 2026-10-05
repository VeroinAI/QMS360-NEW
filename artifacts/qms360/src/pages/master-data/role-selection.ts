import type { MasterDataRoleAssignment } from '@workspace/api-client-react';
export const roleKey = (role: MasterDataRoleAssignment) => `${role.application}:${role.roleId}`;
export function toggleRole(roles: MasterDataRoleAssignment[], role: MasterDataRoleAssignment, checked: boolean) {
  const others = roles.filter(item => roleKey(item) !== roleKey(role));
  return checked ? [...others, role] : others;
}