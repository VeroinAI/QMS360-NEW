/** Dashboard classifications come exclusively from Project Master Additional Data. */
export function projectDashboardDimensions(customFields: unknown) {
  const fields = customFields && typeof customFields === "object" ? customFields as Record<string, any> : {};
  const additional = fields.qmsAdditionalData && typeof fields.qmsAdditionalData === "object"
    ? fields.qmsAdditionalData as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "Unassigned";
  return {
    sbg: text(additional.sbg),
    bu: text(additional.bu),
    projectGroup: text(additional.projectGroup),
  };
}
