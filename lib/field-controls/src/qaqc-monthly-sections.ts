/** Stable permission identifiers; the numbering belongs to the entry screen only. */
export const monthlySections = [
  { id: "project", label: "1. Project Details", fields: [] },
  { id: "pqp", label: "2. PQP Status", fields: ["pqpStatus", "pqpOther", "pqpSubmittedDate", "pqpApprovedDate"] },
  { id: "reference", label: "3. Report Reference", fields: ["reportReference", "reportFrom", "reportTo"] },
  { id: "meetings", label: "4. Meetings Conducted", fields: ["meetings"] },
  { id: "internal_audit", label: "5. QMS Internal Audit", fields: ["internalAudit"] },
  { id: "manpower", label: "6. Quality Manpower", fields: ["manpower", "manpowerDepartmentInput"] },
  { id: "metrics", label: "7. QA/QC Metric Details", fields: ["metrics"] },
  { id: "pqi", label: "8. PQI Calculation (read-only)", fields: [] },
  { id: "material", label: "9. Material Inspection", fields: ["material"] },
  { id: "qtbt", label: "10. Quality Toolbox Talk (QTBT)", fields: ["qtbt"] },
  { id: "training", label: "11. Training", fields: ["training"] },
  { id: "documents", label: "12. Project Monthly Document Status", fields: ["documents"] },
  { id: "qms_reports", label: "13. QMS Report", fields: ["qmsReports", "qmsReportRemarks", "qmsDepartmentInput"] },
  { id: "assessment", label: "14. Quality Assessment Brief", fields: ["narrative", "assessmentConfirmed"] },
] as const;
export type MonthlySectionId = typeof monthlySections[number]["id"];
export const monthlySectionsConfiguredKey = "qaqc.monthly_sections.configured";
export const monthlySectionKey = (id: string) => `qaqc.monthly_section_${id}.create_edit`;
export const monthlySectionForField = (field: string) =>
  monthlySections.find(section => (section.fields as readonly string[]).includes(field))?.id;
export const canMaintainMonthlyField = (field: string, editable: readonly string[]) =>
  field === "noUpdates"
    ? monthlySections.filter(s => s.fields.length > 0).every(s => editable.includes(s.id))
    : editable.includes(monthlySectionForField(field) ?? "");
export const monthlySectionPermissions = [
  { key: monthlySectionsConfiguredKey, name: "Use section-specific monthly report permissions" },
  ...monthlySections.filter(s => s.id !== "pqi").map(s => ({ key: monthlySectionKey(s.id), name: `Monthly report: maintain ${s.label}` })),
];

/** Restrict payloads as well as controls; unknown/historical fields remain server-owned in section mode. */
export function monthlySectionPayload(data: Record<string, any>, editable: readonly string[]) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => {
    return canMaintainMonthlyField(key, editable);
  }));
}
