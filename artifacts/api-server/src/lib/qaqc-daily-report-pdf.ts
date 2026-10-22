import type { QaqcReportExport } from "./qaqc-reporting-export";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { renderQaqcWordDocument } from "./qaqc-monthly-report-pdf";

export async function exportDailySubmissionPdf(report:QaqcReportExport) {
  const {body,project,date}=await buildDailyReportDocument(report);
  return renderQaqcWordDocument(body,{
    title:`Daily Document Governance Report — ${project} — ${date}`,
    subject:"Daily submission report",
    footer:`Algihaz · Daily Document Governance Report · ${project} · ${date}`,
  });
}
