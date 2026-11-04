import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDateFormatResolver } from "@workspace/spreadsheet-dates";
beforeEach(() => setDateFormatResolver(() => "DD-MM-YYYY"));
afterEach(() => setDateFormatResolver(() => "DD/MM/YYYY"));
import sharp from "sharp";
import { PDFDocument, PDFPage, PDFName, PDFDict } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { exportQaqcEmailReportPdf, exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";

const report: QaqcReportExport = {
  id:"synthetic-daily",organizationId:"synthetic-org",projectId:"synthetic-project",
  projectName:"Signature verification",createdById:"preparer",createdByName:"Actual Preparer",
  submittedAt:"2026-10-29T11:32:00Z",organizationTimezone:"Asia/Riyadh",
  reportType:"daily",period:"2026-10-29",state:"approved",data:{},computed:{},
  baseline:{__dailyApproval:{version:1,cycle:2,stages:[
    {level:1,candidates:[{id:"reviewer",name:"Actual Reviewer"}]},
    {level:2,candidates:[{id:"approver",name:"Actual Approver"}]},
  ],history:[
    {cycle:1,level:1,userId:"old-reviewer",decision:"approve",at:"2026-10-28T10:00:00Z"},
    {cycle:2,level:2,userId:"approver",decision:"approve",at:"2026-10-29T13:17:00Z"},
    {cycle:2,level:1,userId:"reviewer",decision:"approve",at:"2026-10-29T13:16:00Z"},
  ]}},
};
async function signed() {
  const png=await sharp(Buffer.from('<svg width="250" height="60"><path d="M10 50 Q30 0 55 40 T110 20 T170 30 L240 20" fill="none" stroke="#223366" stroke-width="3"/></svg>')).png().toBuffer();
  return {...report,userSignatures:Object.fromEntries(["preparer","reviewer","approver","old-reviewer","unrelated"].map(id=>[id,png]))};
}
describe("Daily report and dashboard signatures",()=>{
  it("associates images with actual signer IDs, not names, assigned users or old cycles",async()=>{
    const mapped=await buildDailyReportDocument(await signed());
    expect(mapped.signatures.size).toBe(3);
    expect([...mapped.signatures.keys()].map(cell=>cell.textContent)).toEqual([
      "PREPARED BYActual Preparer","REVIEWED BYActual Reviewer","APPROVED BYActual Approver",
    ]);
    const unsigned=await buildDailyReportDocument(report);
    expect(unsigned.signatures.size).toBe(0);
    const pending=await buildDailyReportDocument({...await signed(),state:"submitted",
      baseline:{__dailyApproval:{version:1,cycle:3,stages:[{level:1,candidates:[{id:"reviewer",name:"Assigned Only"}]}],history:[]}}});
    expect(pending.signatures.size).toBe(1);
    expect(pending.signoffTable.textContent).not.toContain("REVIEWED BY");
    expect(pending.signoffTable.textContent).not.toContain("APPROVED BY");
  });
  it.each(["report","dashboard"] as const)("embeds all signatures in %s downloads and email attachments with matching sign-off data",async(layout)=>{
    const input=await signed();
    const draw=vi.spyOn(PDFPage.prototype,"drawText");
    const image=vi.spyOn(PDFPage.prototype,"drawImage");
    try {
      const download=await exportQaqcReportPdf(input,{templateId:layout==="report"?"daily-submission":"daily-dashboard"});
      const texts=draw.mock.calls.map(call=>call[0]).join(" ").replace(/\s+/g," ");
      expect(texts).toContain("PREPARED BY");expect(texts).toContain("SUBMITTED ON");
      expect(texts).toContain("REVIEWED BY");expect(texts).toContain("REVIEWED ON");
      expect(texts).toContain("APPROVED BY");expect(texts).toContain("APPROVED ON");
      for(const time of ["29-10-2026 14:32","29-10-2026 16:16","29-10-2026 16:17"]) expect(texts).toContain(time);
      expect(texts.indexOf("Actual Reviewer")).toBeLessThan(texts.indexOf("Actual Approver"));
      expect(texts).not.toContain("REPORT ID");
      // Dashboard branding also draws images. Match the synthetic signature's
      // original dimensions, not unrelated template logos/artwork.
      const signatureCalls=()=>image.mock.calls.filter(([source])=>source.width===250&&source.height===60);
      expect(signatureCalls()).toHaveLength(3);
      for(const [,options] of signatureCalls()) {
        expect(options!.width).toBeLessThanOrEqual(150);
        expect(options!.height).toBeLessThanOrEqual(38);
      }
      image.mockClear();
      const email=await exportQaqcEmailReportPdf(input,layout);
      expect(signatureCalls()).toHaveLength(3);
      const pdf=await PDFDocument.load(download),mailPdf=await PDFDocument.load(email);
      expect(mailPdf.getPageCount()).toBe(pdf.getPageCount());
      const lastPage=pdf.getPages().at(-1)!;
      const signatureObjects=lastPage.node.Resources()?.lookupMaybe(PDFName.of("XObject"),PDFDict);
      expect(signatureObjects?.keys()).toHaveLength(3);
      if(layout==="dashboard") {
        expect(pdf.getPageCount()).toBe(5);
        expect(pdf.getPages().at(-1)!.getSize()).toEqual(pdf.getPage(0).getSize());
      }
      await mkdir("../../generated-artifacts",{recursive:true});
      await writeFile(`../../generated-artifacts/daily-${layout}-signatures-preview.pdf`,download);
    } finally {draw.mockRestore();image.mockRestore();}
  },60000);
});
