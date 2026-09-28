type CategoryOption = {
  value: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export function linkedAuditTypes(category: CategoryOption): string[] {
  const values = category.metadata?.auditTypeValues;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

export function categoryOptionsForAuditType<T extends CategoryOption>(categories: T[], auditType: string): T[] {
  if (!auditType) return [];
  // Existing installations have no links yet. Keep their choices available until
  // an administrator starts configuring type/category associations.
  const hasLinks = categories.some(category => linkedAuditTypes(category).length > 0);
  if (!hasLinks) return categories;
  return categories.filter(category => linkedAuditTypes(category).includes(auditType));
}