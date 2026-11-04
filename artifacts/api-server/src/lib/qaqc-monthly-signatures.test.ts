import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFPage, PDFName, PDFDict } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { buildMonthlyReportDocument } from "./qaqc-monthly-report-template";
import { exportQaqcEmailReportPdf, exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";

const report: QaqcReportExport = {
  id:"synthetic-monthly",organizationId:"synthetic-org",projectId:"synthetic-project",
  projectName:"Monthly signature verification",submittedById:"submitter",submittedByName:"Actual Submitter",
  submittedByDesignation:"Line Engineer",submittedAt:"2026-11-01T10:00:00Z",
  reportType:"monthly",period:"2026-10-01",state:"approved",data:{assessmentConfirmed:true},computed:{},
  baseline:{__monthlyApproval:{version:1,cycle:2,stages:[
    {level:1,candidates:[{id:"reviewer",name:"Actual Reviewer"}]},
    {level:2,candidates:[{id:"approver",name:"Actual Approver"}]},
  ],history:[
    {cycle:1,level:1,userId:"old-reviewer",decision:"approve",at:"2026-10-28T10:00:00Z"},
    {cycle:2,level:2,userId:"approver",decision:"approve",at:"2026-11-02T14:00:00Z"},
    {cycle:2,level:1,userId:"reviewer",decision:"approve",at:"2026-11-01T13:00:00Z"},
  ]}},
};
async function signed() {
  const png=await sharp(Buffer.from('<svg width="250" height="60"><path d="M10 50 Q30 0 55 40 T110 20 T170 30 L240 20" fill="none" stroke="#223366" stroke-width="3"/></svg>')).png().toBuffer();
  return {...report,baseline:structuredClone(report.baseline),userSignatures:Object.fromEntries(["submitter","reviewer","approver","old-reviewer","unrelated"].map(id=>[id,png]))};
}
describe("Monthly report and dashboard signatures",()=>{
  it("maps the actual submitter and current-cycle approvals by user ID and retains confirmation and designation",async()=>{
    const mapped=await buildMonthlyReportDocument(await signed());
    expect(mapped.signatures.size).toBe(3);
    expect([...mapped.signatures.keys()].map(cell=>cell.textContent)).toEqual([
      "SUBMITTED BYActual SubmitterLine Engineer","REVIEWED BYActual Reviewer","APPROVED BYActual Approver",
    ]);
    expect(mapped.signoffTable.textContent).toContain("Reviewed and confirmed");
    const unsigned=await buildMonthlyReportDocument(report);
    expect(unsigned.signatures.size).toBe(0);
  });
  it("never adds signatures for assigned users or approvals from a prior sent-back cycle",async()=>{
    const input=await signed();
    const workflow=input.baseline.__monthlyApproval as any;
    workflow.history=workflow.history.filter((e:any)=>e.cycle===1);
    const mapped=await buildMonthlyReportDocument({...input,state:"submitted"});
    expect(mapped.signatures.size).toBe(1);
    expect(mapped.signoffTable.textContent).not.toContain("REVIEWED BY");
    expect(mapped.signoffTable.textContent).not.toContain("APPROVED BY");
  });
  it.each(["report","dashboard"] as const)("renders signatures and matching dates in %s downloads and email attachments",async(layout)=>{
    const input=await signed(),draw=vi.spyOn(PDFPage.prototype,"drawText"),image=vi.spyOn(PDFPage.prototype,"drawImage");
    try {
      const download=await exportQaqcReportPdf(input,{templateId:layout==="report"?"monthly-metrics":"monthly-dashboard"});
      const texts=draw.mock.calls.map(call=>call[0]).join(" ").replace(/\s+/g," ");
      for(const label of ["SUBMITTED BY","SUBMITTED ON","REVIEWED BY","REVIEWED ON","APPROVED BY","APPROVED ON",
        "Actual Submitter","Actual Reviewer","Actual Approver","01-11-2026","02-11-2026"]) expect(texts).toContain(label);
      expect(texts.indexOf("Actual Reviewer")).toBeLessThan(texts.indexOf("Actual Approver"));
      expect(texts).not.toContain("Report ID");
      const signatureCalls=()=>image.mock.calls.filter(([source])=>source.width===250&&source.height===60);
      expect(signatureCalls()).toHaveLength(3);
      for(const [,options] of signatureCalls()) {
        expect(options!.width).toBeLessThanOrEqual(150);expect(options!.height).toBeLessThanOrEqual(38);
      }
      image.mockClear();
      const email=await exportQaqcEmailReportPdf(input,layout);
      expect(signatureCalls()).toHaveLength(3);
      const pdf=await PDFDocument.load(download),mailPdf=await PDFDocument.load(email);
      expect(mailPdf.getPageCount()).toBe(pdf.getPageCount());
      expect(mailPdf.getPages().map(p=>p.getSize())).toEqual(pdf.getPages().map(p=>p.getSize()));
      expect(pdf.getPages().at(-1)!.node.Resources()?.lookupMaybe(PDFName.of("XObject"),PDFDict)?.keys()).toHaveLength(3);
      if(layout==="dashboard") {
        expect(pdf.getPageCount()).toBe(6);
        expect(pdf.getPages().at(-1)!.getSize()).toEqual(pdf.getPage(0).getSize());
        expect(texts).toContain("Page 6 of 6");
      }
      await mkdir("../../generated-artifacts",{recursive:true});
      await writeFile(`../../generated-artifacts/monthly-${layout}-signatures-preview.pdf`,download);
    } finally {draw.mockRestore();image.mockRestore();}
  },60000);
});
