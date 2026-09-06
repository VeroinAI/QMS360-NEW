import {
  useGetAuditFieldControls,
  useGetCurrentUser,
  useGetLessonsFieldControls,
  useGetQaqcFieldControls,
} from "@workspace/api-client-react";
import type { FieldControlSetting } from "@workspace/api-client-react";
import {
  fieldControlRegistry,
  getFormDefinition,
  type FieldControlAppKey,
  type FieldDefinition,
  type FormDefinition,
} from "@workspace/field-controls";

// The registry of controllable forms/fields lives in @workspace/field-controls
// (shared with the api-server, which validates admin field-control writes
// against it). Re-exported here so existing imports keep working.
export { fieldControlRegistry, getFormDefinition };
export type { FieldControlAppKey, FieldDefinition, FormDefinition };
export type FieldControlFormKey = string;


// Matches the admin detection used by the app shell and requireAdmin on the API.
export function useIsAdmin(): boolean {
  const user = useGetCurrentUser();
  return ["Super Admin", "Org Admin"].includes(user.data?.platformRole ?? "")
    || (user.data?.workspaceRoles?.some((role) => /\b(admin|administrator)\b/i.test(role)) ?? false);
}

export type FieldProps = { disabled: boolean; required: boolean };

// Returns the saved field-control matrix for one form. Admins always get
// fully editable/optional behaviour; anything not configured defaults the same way.
export function useFieldControls(appKey: FieldControlAppKey, formKey: string) {
  const enabled = (key: FieldControlAppKey): any => ({ query: { enabled: appKey === key } });
  const qaqc = useGetQaqcFieldControls(enabled("qaqc"));
  const lessons = useGetLessonsFieldControls(enabled("lessons"));
  const audit = useGetAuditFieldControls(enabled("audit"));
  const isAdmin = useIsAdmin();
  const query = appKey === "qaqc" ? qaqc : appKey === "lessons" ? lessons : audit;
  const form: Record<string, FieldControlSetting> = (query.data?.[formKey] ?? {}) as Record<string, FieldControlSetting>;

  const fieldProps = (fieldKey: string): FieldProps => {
    if (isAdmin) return { disabled: false, required: false };
    const setting = form[fieldKey];
    return {
      disabled: setting?.access === "read_only",
      required: setting?.requirement === "mandatory",
    };
  };

  return {
    isAdmin,
    isLoading: query.isLoading,
    fieldProps,
    mandatoryFieldKeys: () => (isAdmin ? [] : Object.keys(form).filter((key) => form[key]?.requirement === "mandatory")),
  };
}
