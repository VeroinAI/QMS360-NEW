/** QMS-managed classifications override source metadata without changing Drona. */
export function projectDashboardDimensions(customFields: unknown, sourceBusinessUnit?: string | null) {
  const fields = customFields && typeof customFields === "object" ? customFields as Record<string, any> : {};
  const additional = fields.qmsAdditionalData && typeof fields.qmsAdditionalData === "object"
    ? fields.qmsAdditionalData as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "Unassigned";
  const value = (key: string, legacy: unknown) =>
    text(Object.prototype.hasOwnProperty.call(additional, key) ? additional[key] : legacy);
  return {
    sbg: value("sbg", fields.sbg ?? fields.SBG ?? fields.strategicBusinessGroup),
    bu: value("bu", sourceBusinessUnit ?? fields.businessUnit ?? fields.bu),
    projectGroup: value("projectGroup", fields.projectGroup ?? fields.project_group),
  };
}
