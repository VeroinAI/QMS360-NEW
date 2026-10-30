import { and, eq, isNull } from "drizzle-orm";
import { db, lessonLearnedForms } from "@workspace/db";
import { validEmailReportSelection } from "@workspace/field-controls";
import { storeEmailReportAttachment, type EmailReportAttachment } from "./email-attachments";
import { withOrganizationDateFormat } from "./date-format";

export type EmailReportRequest = { selection: string; eventType: string; entityId: string };

/** Only trusted record identifiers, never a file supplied by a rule administrator. */
export async function generateEmailReport(organizationId: string, request: EmailReportRequest): Promise<EmailReportAttachment> {
  if (!request || typeof request.selection !== "string" || !request.selection
    || typeof request.eventType !== "string" || !validEmailReportSelection(request.eventType, request.selection)
    || typeof request.entityId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(request.entityId)) {
    throw new Error("Invalid event-specific email report request");
  }
  const format = request.selection.endsWith("_pptx") ? "pptx" : "pdf";
  const bytes = await withOrganizationDateFormat(organizationId, async () => {
    if (request.selection === "lesson_pdf") {
      const [lesson] = await db.select().from(lessonLearnedForms).where(and(
        eq(lessonLearnedForms.organizationId, organizationId), eq(lessonLearnedForms.id, request.entityId),
        isNull(lessonLearnedForms.deletedAt),
      )).limit(1);
      if (!lesson) throw new Error("Lesson Learned form not found in the event organization");
      const { listEvidence } = await import("./evidence");
      const { lessonReportPdf } = await import("../routes/lessons");
      return lessonReportPdf(lesson, await listEvidence(db, "lessons", organizationId, "lesson_form", lesson.id) as any);
    }
    if (request.selection === "qaqc_report_pdf" || request.selection === "qaqc_dashboard_pdf") {
      const { qaqcReportForEmail } = await import("../routes/qaqc-reporting-tools");
      const { exportQaqcReportPdf } = await import("./qaqc-reporting-export");
      const report = await qaqcReportForEmail(organizationId, request.entityId);
      const entity = request.eventType.split(".")[1];
      if (entity !== "qaqc_report" && entity !== `${report.reportType}_report`)
        throw new Error("Email event does not match the QA/QC report type");
      if (request.selection === "qaqc_dashboard_pdf") {
        if (report.reportType !== "monthly" && report.reportType !== "daily")
          throw new Error("This QA/QC report has no dashboard PDF");
        return exportQaqcReportPdf(report, { templateId: `${report.reportType}-dashboard` });
      }
      const templateId = report.reportType === "monthly" ? "monthly-metrics"
        : report.reportType === "daily" ? "daily-submission" : "csat-form";
      return exportQaqcReportPdf(report, { templateId });
    }
    const { auditPlanEmailPdf, auditScheduleEmailPdf, auditExecutionEmailReport } = await import("../routes/audit");
    if (request.selection === "audit_plan_pdf") return auditPlanEmailPdf(organizationId, request.entityId);
    if (request.selection === "audit_schedule_pdf") return auditScheduleEmailPdf(organizationId, request.entityId);
    return auditExecutionEmailReport(organizationId, request.entityId, format);
  });
  return storeEmailReportAttachment(organizationId, `${request.selection}-${request.entityId}`, Buffer.from(bytes), format);
}
