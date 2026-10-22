import type { QaqcReportExport } from "./qaqc-reporting-export";
import { dailyDashboardData } from "./qaqc-daily-dashboard-data";
import { exportPresentationDashboardPdf } from "./qaqc-monthly-dashboard-pdf";

export function exportDailyDashboardPdf(report: QaqcReportExport) {
  return exportPresentationDashboardPdf({
    mapped: dailyDashboardData(report),
    template: "qaqc-daily-dashboard-template.pptx", pages: 4,
    title: `Daily Document Governance Dashboard — ${report.projectName ?? "To be mapped"} — ${report.period}`,
    footer: "Algihaz · Daily Document Governance Dashboard", kind: "daily",
  });
}
