import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { XMLSerializer } from "@xmldom/xmldom";
import { mkdir, writeFile } from "node:fs/promises";
import { buildMonthlyReportDocument, children, monthlyDate } from "./qaqc-monthly-report-template";
import { exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";
import { calculateReport } from "./qaqc-reporting-model";

const data = {
  pqpStatus: "Approved B", pqpSubmittedDate: "2026-09-03", pqpApprovedDate: "2026-09-08",
  reportReference: "CLIENT-SEP-01", reportFrom: "2026-09-01", reportTo: "2026-09-30",
  meetings: [{ type:"Internal Meeting",lastDate:"2026-10-10",nextDate:"2026-11-10" }],
  internalAudit: {conducted:true,lastDate:"2026-09-15",nextDate:"2026-12-15"},
  manpower: [{department:"Civil",count:3,approvalRequired:true},{department:"Mechanical",count:2,approvalRequired:false}],
  metrics: Object.fromEntries(["external_ncr","internal_ncr","rfi","rmi"].map(key=>[key,{issued:5,closed:3,ageing:[{department:"Civil",bucket:"0-15",count:2}]}])),
  material: {issued:5,closed:3,osdAvailable:true,osdMirns:1,overage:2,shortage:1,damage:0,defective:0,totalItems:10,approved:5,onHold:1,rejectedDoNotUse:1,rejectedReturn:1,hazardous:1,handleWithCare:1},
  qtbt: {talkCount:2,attendance:20,durationMinutes:15},
  documents: {
    drawings:{approved:10,resubmitted:2,rejected:1,underReview:3,clientReviewDays:6.4,internalReviewDays:2.8,remarks:"Actual drawing remarks"},
    submittals:{approved:8,resubmitted:1,rejected:1,underReview:2,clientReviewDays:5,internalReviewDays:2,remarks:"Actual submittal remarks"},
  },
  qmsReports:[{department:"Quality",type:"SOP",documentName:"Actual Document",status:"Approved & Published",remarks:"Actual QMS remarks"}],
  narrative:"Actual assessment supplied by the report author.",assessmentConfirmed:true,
};
const baseline={metrics:{external_ncr:{accumulatedIssued:8,accumulatedClosed:6}},material:{accumulatedIssued:10,accumulatedClosed:8},qtbt:{accumulatedTalkCount:3,accumulatedManhours:12}};
const report: QaqcReportExport={
  id:"preview-report",organizationId:"example-org",projectId:"example-project",
  projectName:"Example Construction Project",costCentre:"CC-900",period:"2026-10-01",state:"draft",reportType:"monthly",
  data,computed:calculateReport("monthly",data,baseline,{}),baseline,
  submittedByName:"Report Submitter",submittedAt:"2026-10-31T12:00:00Z",
};
async function mapped(r=report) {
  const result=await buildMonthlyReportDocument(r);
  return { ...result, xml:new XMLSerializer().serializeToString(result.body), text:result.body.textContent! };
}
describe("Customer Word monthly metrics report",()=>{
  it("maps actual identity, assessment, dates, manpower and details without illustrative data",async()=>{
    const {text,xml}=await mapped();
    for(const value of ["Example Construction Project","CC-900","October 2026","Actual assessment","CLIENT-SEP-01","03-09-2026","Report Submitter","31-10-2026","Actual Document","Actual drawing remarks","Actual submittal remarks","Actual QMS remarks"])expect(text).toContain(value);
    for(const sample of ["Al Nakheel","CC-2041","Sample User","stable quality performance","NCR ageing reviewed","QMS-DC-2026-10","FOR REVIEW ONLY","6 of 9 active","Structural shop drawings"])expect(text).not.toContain(sample);
    expect(xml).toContain('w:fill="582C83"');expect(xml).toContain('w:fill="F3EFF7"');
  });
  it("keeps unmatched fields explicit, does not invent incompatible ageing bands or signatory titles",async()=>{
    const {body}=await mapped();
    const tables=children(body,"tbl");
    const meeting=tables.find(t=>t.textContent?.includes("Meeting type"))!;
    expect(meeting.textContent).toContain("10-10-2026To be mappedTo be mapped");
    const ageing=tables.find(t=>t.textContent?.includes("NCR type"))!;
    expect(ageing.textContent).toContain("2To be mappedTo be mappedTo be mapped");
    const qms=tables.find(t=>t.textContent?.includes("Document Name")&&t.textContent?.includes("Actual Document"))!;
    expect(qms.textContent).toContain("QualitySOPActual DocumentApproved & PublishedActual QMS remarks");
  });
  it("handles no meetings/reports, inapplicable fields and unconfirmed drafts truthfully",async()=>{
    const {text}=await mapped({...report,data:{...data,meetings:[],qmsReports:[],pqpStatus:"Under Preparation",internalAudit:{conducted:false},material:{...data.material,osdAvailable:false},assessmentConfirmed:false},submittedAt:null,submittedByName:null});
    expect(text).toContain("No meeting added");expect(text).toContain("No QMS document register rows added");
    expect(text).toContain("Not applicable");expect(text).toContain("Not confirmed");
    expect(text).not.toContain("Reviewed and confirmed");
    expect(text).not.toContain("Weekly Quality Review");
  });
  it("prints reconciliation mismatches in red without changing or blocking saved data",async()=>{
    const {xml,text}=await mapped({...report,data:{...data,material:{...data.material,totalItems:1}}});
    expect(text).toContain("✖ Status tags total 10 ≠ Total items in MIRNs 1");expect(xml).toContain('w:val="C0392B"');
    expect(data.material.totalItems).toBe(10);
  });
  it("replaces section 11 with the five input-screen columns, preserving styling and missing markers",async()=>{
    const {body,text}=await mapped({...report,data:{...data,qmsReports:[...data.qmsReports,{department:"HSSE",type:"Form",documentName:"Missing status document"}]}});
    expect(text).toContain("11   QMS Document Register");
    expect(text).not.toContain("QMS Reports");
    const table=children(body,"tbl").find(t=>t.textContent?.includes("Document Name"))!;
    const tableRows=children(table,"tr");
    expect(children(tableRows[0]!,"tc").map(c=>c.textContent)).toEqual(["Department","Type","Document Name","Status","Remarks"]);
    expect(children(tableRows[2]!,"tc").map(c=>c.textContent)).toEqual(["HSSE","Form","Missing status document","To be mapped","To be mapped"]);
    expect(tableRows.every(r=>children(r,"tc").length===5)).toBe(true);
    const xml=new XMLSerializer().serializeToString(table);
    expect(xml).toContain('w:fill="582C83"');
    expect(xml).not.toContain("Reference no.");
    expect(xml).not.toContain("QMS-DC-2026-10");
  });
  it("maps the supplied NCR ageing references without splitting incompatible saved bands",async()=>{
    const metrics={
      external_ncr:{issued:9,closed:0,ageing:[{bucket:"0-15",count:1},{bucket:"0-15",count:2},{bucket:"15-45",count:4},{bucket:"over45",count:2}]},
      internal_ncr:{issued:0,closed:0,ageing:[]},
    };
    const r={...report,data:{...data,metrics},baseline:{},computed:calculateReport("monthly",{...data,metrics},{},{})};
    const {body}=await mapped(r);
    const table=children(body,"tbl").find(t=>t.textContent?.includes("NCR type"))!;
    const values=children(table,"tr").slice(1).map(row=>children(row,"tc").map(c=>c.textContent));
    expect(values[0]).toEqual(["External NCR","3","To be mapped","To be mapped","To be mapped","9","✔ 9 / 9"]);
    expect(values[1]).toEqual(["Internal NCR","0","To be mapped","To be mapped","To be mapped","0","✔ 0 / 0"]);
    if (!("metrics" in r.computed)) throw new Error("Expected monthly calculations");
    const mismatch=await mapped({...r,computed:{...r.computed,metrics:{...r.computed.metrics,external_ncr:{...r.computed.metrics.external_ncr,open:8}}}});
    expect(mismatch.text).toContain("✖ 9 / 8");
  });
  it("escapes arbitrary user text in XML and preserves long multiline narratives",async()=>{
    const {text,xml}=await mapped({...report,data:{...data,narrative:"Safety <review> & quality\n".repeat(100)}});
    expect(xml).toContain("&lt;review&gt; &amp;");expect(text.match(/Safety/g)).toHaveLength(100);
  });
  it("keeps a missing field distinct from actual zero",async()=>{
    const {text}=await mapped({...report,computed:{},data:{},baseline:{}});
    expect(text).toContain("To be mapped");expect(text).not.toContain("90.4");expect(text).not.toContain("88.7");
    expect(monthlyDate("2026-10-03")).toBe("03-10-2026");
  });
  it("downloads a valid styled PDF through the existing exporter and writes a visual fixture",async()=>{
    const bytes=await exportQaqcReportPdf(report,{templateId:"monthly-metrics"});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    expect(pdf.getTitle()).toContain("Example Construction Project");
    expect(pdf.getPages().every(p=>Math.abs(p.getWidth()-595.3)<1)).toBe(true);
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/qaqc-monthly-template-preview.pdf",bytes);
  });
  it("flows large narratives and repeated rows without losing content or hanging",async()=>{
    const bytes=await exportQaqcReportPdf({...report,data:{...data,narrative:"Long narrative for pagination verification. ".repeat(180),meetings:Array.from({length:35},()=>data.meetings[0]),qmsReports:Array.from({length:30},()=>data.qmsReports[0])}},{templateId:"monthly-metrics"});
    const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBeGreaterThan(6);
    await writeFile("../../generated-artifacts/qaqc-monthly-overflow-preview.pdf",bytes);
  },30000);
});
