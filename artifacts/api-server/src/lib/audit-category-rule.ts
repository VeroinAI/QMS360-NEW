/** The standard Product/Process split overrides configurable category links.
 * Unknown/custom audit types continue to use master-data links. */
export function standardAuditCategories(auditType: string): string[] | undefined {
  const type = auditType.trim().toLowerCase();
  if (type === "quality internal product audit" || type === "product audit") return ["project"];
  if (type === "quality internal process audit" || type === "process audit") {
    return ["business unit", "regional office", "warehouse"];
  }
  return undefined;
}
