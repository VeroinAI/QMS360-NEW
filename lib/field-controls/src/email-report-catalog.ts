/** Server/client allowlist: never accept file paths or arbitrary report URLs. */
export type EmailReportId = "lesson_pdf" | "qaqc_report_pdf" | "audit_schedule_pdf" | "audit_plan_pdf" | "audit_report_pdf" | "audit_report_pptx";
export function emailReportOptions(eventType: string): Array<{ value: EmailReportId; label: string }> {
  const [app, entity, action] = eventType.split(".");
  if (!action || action === "delete") return [];
  if (app === "lessons" && entity === "lesson_form")
    return [{ value: "lesson_pdf", label: "Lesson Learned form (PDF)" }];
  if (app === "qaqc" && ["qaqc_report", "monthly_report", "daily_report"].includes(entity))
    return [{ value: "qaqc_report_pdf", label: entity === "monthly_report" ? "Monthly QA/QC report (PDF)"
      : entity === "daily_report" ? "Daily Submission report (PDF)" : "Event's Monthly / Daily / CSAT report (PDF)" }];
  if (app !== "audit") return [];
  if (entity === "audit_programme" || entity === "audit_schedule")
    return [{ value: "audit_schedule_pdf", label: "Event's Audit Programme / Schedule (PDF)" }];
  if (entity === "audit_plan") return [{ value: "audit_plan_pdf", label: "Audit Plan (PDF)" }];
  if (entity === "audit" && ["complete", "approve_report", "approved_final", "send_back_report"].includes(action))
    return [
      { value: "audit_report_pdf", label: "Completed Audit report (PDF)" },
      { value: "audit_report_pptx", label: "Completed Audit report (PowerPoint)" },
    ];
  return [];
}

export function validEmailReportSelection(eventType: string, selection: unknown) {
  return selection === undefined || selection === null || selection === ""
    || emailReportOptions(eventType).some(option => option.value === selection);
}

/** An explicit empty multi-selection overrides an older saved single selection. */
export function selectedEmailReports(config?: { reportAttachments?: string[]; reportAttachment?: string | null } | null): string[] {
  return [...new Set(config?.reportAttachments ?? (config?.reportAttachment ? [config.reportAttachment] : []))];
}

export function validEmailReportSelections(eventType: string, selections: unknown) {
  return selections === undefined || (Array.isArray(selections) && selections.length <= 10
    && selections.every(selection => typeof selection === "string" && selection.length > 0 && validEmailReportSelection(eventType, selection)));
}
