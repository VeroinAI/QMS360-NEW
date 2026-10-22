/** Master-owned source text shared by Audit number previews and allocation.
 * Counter identities remain project/department UUIDs, never this editable text.
 */
export function auditProjectNumberSourceValue(customFields: Record<string, unknown> | null | undefined): string {
  const additional = customFields?.qmsAdditionalData as Record<string, unknown> | null | undefined;
  const value = additional?.contractProjectNumber;
  return typeof value === "string" ? value.trim() : "";
}

export function auditDepartmentNumberSourceValue(metadata: Record<string, unknown> | null | undefined): string {
  const value = metadata?.costId;
  return typeof value === "string" ? value.trim() : "";
}
