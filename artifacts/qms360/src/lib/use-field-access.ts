import { useGetCurrentUser, useGetFieldSettings } from '@workspace/api-client-react';

export type FieldAccessModule = 'qaqc' | 'lessons' | 'audit';

// Resolves the org-wide field access settings for a module. Administrators
// always see editable fields; everyone else gets fields an admin marked
// read-only rendered disabled (the API enforces the same rule on writes).
export function useFieldAccess(module: FieldAccessModule) {
  const settings = useGetFieldSettings();
  const user = useGetCurrentUser();
  const isAdmin =
    ['Super Admin', 'Org Admin'].includes(user.data?.platformRole ?? '') ||
    (user.data?.workspaceRoles ?? []).some((role) => /\b(admin|administrator)\b/i.test(role));
  const forms = settings.data?.modules.find((entry) => entry.module === module)?.forms ?? [];
  const readOnly = (formKey: string, fieldKey: string) =>
    !isAdmin &&
    forms.find((form) => form.formKey === formKey)?.fields.find((field) => field.fieldKey === fieldKey)?.access === 'read_only';
  return { readOnly, isAdmin, isLoading: settings.isLoading };
}
