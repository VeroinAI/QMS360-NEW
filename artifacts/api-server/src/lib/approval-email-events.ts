type Event = {
  app: string;
  entityType: string;
  action: string;
  record?: Record<string, any>;
};

export const finalApprovalEmailEvents = {
  "audit.audit.approved_final": "Audit · Audit Report · Final Approval",
  "audit.corrective_action_report.approved_final": "Audit · CAR · Final Approval",
  "audit.corrective_action_report.approved_final_extension": "Audit · CAR Extension · Final Approval",
  "qaqc.monthly_report.approved_final": "QA/QC · Monthly Report · Final Approval",
  "qaqc.daily_report.approved_final": "Document Governance · Daily Submission · Final Approval",
};

/** Keep domain history unchanged; classify email events from the saved review result. */
export function approvalEmailEvent<T extends Event>(event: T): T {
  const record = event.record ?? {};
  if (event.app === "qaqc" && event.entityType === "qaqc_report" && event.action === "approve"
    && record.state === "approved" && ["monthly", "daily"].includes(record.reportType)) {
    return { ...event, entityType: `${record.reportType}_report`, action: "approved_final" };
  }
  if (event.app !== "audit") return event;
  if (event.entityType === "audit" && event.action === "approve_report") {
    let metadata: any = {};
    try { metadata = typeof record.status === "string" ? JSON.parse(record.status) : record.status; } catch { /* Legacy non-JSON status is not approval evidence. */ }
    if (metadata?.reportApproval?.status === "Approved") return { ...event, action: "approved_final" };
  }
  if (event.entityType === "corrective_action_report") {
    if (event.action === "accept" && record.workflowState === "closed") return { ...event, action: "approved_final" };
    if (event.action === "approve_extension" && record.extensionStatus === "approved")
      return { ...event, action: "approved_final_extension" };
  }
  return event;
}

/** Old approval rules keep working until an explicit final-stage rule supersedes them. */
export function legacyFinalApprovalEvent(eventType: string): string | undefined {
  return ({
    "audit.audit.approved_final": "audit.audit.approve_report",
    "audit.corrective_action_report.approved_final": "audit.corrective_action_report.accept",
    "audit.corrective_action_report.approved_final_extension": "audit.corrective_action_report.approve_extension",
    "qaqc.monthly_report.approved_final": "qaqc.qaqc_report.approve",
    "qaqc.daily_report.approved_final": "qaqc.qaqc_report.approve",
  } as Record<string, string>)[eventType];
}
