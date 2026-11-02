import type { QaqcReportExport } from "./qaqc-reporting-export";
import { dailyDashboardData } from "./qaqc-daily-dashboard-data";
import { exportPresentationDashboardPdf } from "./qaqc-monthly-dashboard-pdf";
import { PDFDocument } from "pdf-lib";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { renderQaqcWordDocument } from "./qaqc-monthly-report-pdf";
import { children, W } from "./qaqc-monthly-report-template";

export async function exportDailyDashboardPdf(report: QaqcReportExport) {
  const dashboard=await exportPresentationDashboardPdf({
    mapped: dailyDashboardData(report),
    template: "qaqc-daily-dashboard-template.pptx", pages: 4,
    title: `Daily Document Governance Dashboard — ${report.projectName ?? "To be mapped"} — ${report.period}`,
    footer: "Algihaz · Daily Document Governance Dashboard", kind: "daily",
  });
  const pdf=await PDFDocument.load(dashboard);
  const {body,signoffTable,signatures,project,date}=await buildDailyReportDocument(report);
  // Reuse the report's exact signatory mapping and row styles. Keep all charts
  // intact and allow long approval chains to flow onto additional pages.
  for(const block of children(body)) {
    if(block!==signoffTable && block.localName!=="sectPr") body.removeChild(block);
  }
  const heading=body.ownerDocument!.createElementNS(W,"w:p");
  const run=body.ownerDocument!.createElementNS(W,"w:r");
  const text=body.ownerDocument!.createElementNS(W,"w:t");
  text.textContent=`Daily Submission sign-off — ${project} — ${date}`;
  run.appendChild(text);heading.appendChild(run);body.insertBefore(heading,signoffTable);
  const signoff=await PDFDocument.load(await renderQaqcWordDocument(body,{
    title:"Daily Submission sign-off",subject:"Daily dashboard sign-off",
    footer:"Algihaz · Daily Document Governance Dashboard · Sign-off",
    signatures,pageSize:pdf.getPages()[0]!.getSize(),pageNumberOffset:pdf.getPageCount(),
  }));
  for(const page of await pdf.copyPages(signoff,signoff.getPageIndices())) pdf.addPage(page);
  return Buffer.from(await pdf.save());
}
