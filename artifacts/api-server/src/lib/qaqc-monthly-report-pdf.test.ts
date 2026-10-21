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
  submittedByName:"Report Submitter",submittedByDesignation:"Corporate QA/QC Manager",submittedAt:"2026-10-31T12:00:00Z",
  monthlyDownloadPqi:{average:37.5,projectCount:2},
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
  it("keeps unmatched fields explicit without inventing meeting outcomes or signatory titles",async()=>{
    const {body}=await mapped();
    const tables=children(body,"tbl");
    const meeting=tables.find(t=>t.textContent?.includes("Meeting type"))!;
    expect(children(meeting,"tr").map(row=>children(row,"tc").map(c=>c.textContent)))
      .toEqual([["Meeting type","Date"],["Internal Meeting","10-10-2026"]]);
    expect(meeting.textContent).not.toMatch(/Participants|Key outcome/);
    const ageing=tables.find(t=>t.textContent?.includes("NCR type"))!;
    expect(children(children(ageing,"tr")[1]!,"tc").map(c=>c.textContent).slice(1,4)).toEqual(["2","0","0"]);
    const qms=tables.find(t=>t.textContent?.includes("Document Name")&&t.textContent?.includes("Actual Document"))!;
    expect(qms.textContent).toContain("QualitySOPActual DocumentApproved & PublishedActual QMS remarks");
  });
  it("prints the live average with its report count and removes the old pending explanation",async()=>{
    const {text}=await mapped();
    expect(text).toContain("37.5 (Total monthly report for reporting period (October, 2026) submitted -> 2)");
    expect(text).not.toContain("Total monthly report for project is");
    expect(text).not.toContain("stays pending until every");
    const none=await mapped({...report,monthlyDownloadPqi:{average:null,projectCount:0}});
    expect(none.text).toContain("No submitted reports (Total monthly report for reporting period (October, 2026) submitted -> 0)");
    const zero=await mapped({...report,monthlyDownloadPqi:{average:0,projectCount:1}});
    expect(zero.text).toContain("0.0 (Total monthly report for reporting period (October, 2026) submitted -> 1)");
    const missingScore=await mapped({...report,monthlyDownloadPqi:{average:null,projectCount:1}});
    expect(missingScore.text).toContain("— (Total monthly report for reporting period (October, 2026) submitted -> 1)");
    const differentMonth=await mapped({...report,period:"2027-01-01"});
    expect(differentMonth.text).toContain("reporting period (January, 2027) submitted -> 2");
  });
  it("prints the submitter's saved designation and keeps missing designations explicit",async()=>{
    const submittedBy = (body: Awaited<ReturnType<typeof mapped>>["body"]) =>
      children(body,"tbl").find(t=>t.textContent?.includes("SUBMITTED BY"))!;
    const actual = await mapped();
    const cells = children(children(submittedBy(actual.body),"tr")[0]!,"tc");
    expect(children(cells[1]!,"p").map(p=>p.textContent))
      .toEqual(["SUBMITTED BY","Report Submitter","Corporate QA/QC Manager"]);
    for (const designation of [undefined,null,"","   "]) {
      const missing = await mapped({...report,submittedByDesignation:designation});
      const missingCells = children(children(submittedBy(missing.body),"tr")[0]!,"tc");
      expect(children(missingCells[1]!,"p")[2]!.textContent).toBe("—");
    }
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
  it("removes Share of total from MIRN status rows while preserving counts, total, width and styling",async()=>{
    const {body,text}=await mapped();
    const table=children(body,"tbl").find(t=>t.textContent?.includes("Status tag"))!;
    const values=children(table,"tr").map(row=>children(row,"tc").map(cell=>cell.textContent));
    expect(values).toEqual([
      ["Status tag","No. of items"],["Approved","5"],["On Hold / Quarantine","1"],
      ["Rejected – Do Not Use","1"],["Rejected – Return to Supplier","1"],
      ["Hazardous Material","1"],["Handle & Store with Care","1"],["Total","10"],
    ]);
    expect(text).not.toContain("Share of total");
    const xml=new XMLSerializer().serializeToString(table);
    expect(xml).toContain('w:w="7138"');
    expect(xml).toContain('w:w="2500"');
    expect(xml).toContain('w:fill="582C83"');
    expect(xml).toContain('w:fill="F3EFF7"');
  });
  it("replaces section 11 with the five input-screen columns, preserving styling and missing markers",async()=>{
    const {body,text}=await mapped({...report,data:{...data,qmsReports:[...data.qmsReports,{department:"HSSE",type:"Form",documentName:"Missing status document"}]}});
    expect(text).toContain("11   QMS Document Register");
    expect(text).not.toContain("QMS Reports");
    const table=children(body,"tbl").find(t=>t.textContent?.includes("Document Name"))!;
    const tableRows=children(table,"tr");
    expect(children(tableRows[0]!,"tc").map(c=>c.textContent)).toEqual(["Department","Type","Document Name","Status","Remarks"]);
    expect(children(tableRows[2]!,"tc").map(c=>c.textContent)).toEqual(["HSSE","Form","Missing status document","—","—"]);
    expect(tableRows.every(r=>children(r,"tc").length===5)).toBe(true);
    const xml=new XMLSerializer().serializeToString(table);
    expect(xml).toContain('w:fill="582C83"');
    expect(xml).not.toContain("Reference no.");
    expect(xml).not.toContain("QMS-DC-2026-10");
  });
  it("uses the entry screen's ageing buckets, summing departments separately for each NCR type",async()=>{
    const metrics={
      external_ncr:{issued:9,closed:0,ageing:[{bucket:"0-15",count:1},{bucket:"0-15",count:2},{bucket:"15-45",count:4},{bucket:"over45",count:2}]},
      internal_ncr:{issued:0,closed:0,ageing:[]},
    };
    const r={...report,data:{...data,metrics},baseline:{},computed:calculateReport("monthly",{...data,metrics},{},{})};
    const {body}=await mapped(r);
    const table=children(body,"tbl").find(t=>t.textContent?.includes("NCR type"))!;
    const values=children(table,"tr").slice(1).map(row=>children(row,"tc").map(c=>c.textContent));
    expect(children(children(table,"tr")[0]!,"tc").map(c=>c.textContent)).toEqual(["NCR type","0-15 days","15-45 days","Over 45 days","Total aged","Total vs Open"]);
    expect(values[0]).toEqual(["External NCR","3","4","2","9","✔ 9 / 9"]);
    expect(values[1]).toEqual(["Internal NCR","0","0","0","0","✔ 0 / 0"]);
    expect(table.textContent).not.toMatch(/16–30|31–60|> 60/);
    if (!("metrics" in r.computed)) throw new Error("Expected monthly calculations");
    const mismatch=await mapped({...r,computed:{...r.computed,metrics:{...r.computed.metrics,external_ncr:{...r.computed.metrics.external_ncr,open:8}}}});
    expect(mismatch.text).toContain("✖ 9 / 8");
    expect(mismatch.xml).toContain('w:val="C0392B"');
    const missing=await mapped({...report,data:{...data,metrics:{external_ncr:{issued:0,closed:0}}}});
    const missingTable=children(missing.body,"tbl").find(t=>t.textContent?.includes("NCR type"))!;
    expect(children(children(missingTable,"tr")[1]!,"tc").map(c=>c.textContent).slice(1)).toEqual(Array(5).fill("—"));
  });
  it("escapes arbitrary user text in XML and preserves long multiline narratives",async()=>{
    const {text,xml}=await mapped({...report,data:{...data,narrative:"Safety <review> & quality\n".repeat(100)}});
    expect(xml).toContain("&lt;review&gt; &amp;");expect(text.match(/Safety/g)).toHaveLength(100);
  });
  it("renders the no-submissions message in the PDF without substituting a zero average",async()=>{
    const bytes=await exportQaqcReportPdf({...report,monthlyDownloadPqi:{average:null,projectCount:0}},{templateId:"monthly-metrics"});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/qaqc-monthly-empty-average-preview.pdf",bytes);
  },30000);
  it("keeps a missing field distinct from actual zero",async()=>{
    const {text}=await mapped({...report,computed:{},data:{},baseline:{}});
    expect(text).toContain("—");expect(text).not.toContain("To be mapped");
    expect(text).not.toContain("90.4");expect(text).not.toContain("88.7");
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(monthlyDate("2026-10-03")).toBe("03-10-2026");
    // Other report types import this helper and retain their existing fallback.
    expect(monthlyDate(undefined)).toBe("To be mapped");
    expect(monthlyDate(undefined,"—")).toBe("—");
  });
  it("uses dashes for missing mapped text, dates, quantities and baseline values without hiding actual zeros",async()=>{
    const partialData = {
      pqpStatus:"Rejected", narrative:"   ",
      material:{issued:5,closed:5,osdAvailable:true,osdMirns:0,overage:999,approved:0},
      qtbt:{talkCount:5,attendance:5,durationMinutes:5},
    };
    const partial: QaqcReportExport = {...report,costCentre:null,submittedByName:null,
      submittedByDesignation:null,submittedAt:null,monthlyDownloadPqi:undefined,
      data:partialData,baseline:{},computed:calculateReport("monthly",partialData,{},{})};
    const {body,text,xml}=await mapped(partial);
    expect(text).not.toContain("To be mapped");
    const tables=children(body,"tbl");
    const osd=tables.find(t=>t.textContent?.includes("OSD available"))!;
    expect(children(osd,"tr").map(row=>children(row,"tc").map(c=>c.textContent))).toEqual([
      ["OSD available","Yes","MIRNs with OSD","0"],
      ["Total overage qty","999","Total shortage qty","—"],
      ["Total damage qty","—","Total defective qty","—"],
    ]);
    const qtbt=tables.find(t=>t.textContent?.includes("Number of talks"))!;
    expect(children(children(qtbt,"tr")[1]!,"tc")[1]!.textContent).toBe("—");
    expect(children(children(qtbt,"tr")[2]!,"tc")[1]!.textContent).toBe("—");
    const pqp=tables.find(t=>t.textContent?.includes("PQP status"))!;
    expect(children(children(pqp,"tr")[0]!,"tc")[3]!.textContent).toBe("—");
    expect(xml).toContain('w:fill="582C83"');
    expect(xml).toContain('w:fill="F3EFF7"');
    const pdf=await exportQaqcReportPdf(partial,{templateId:"monthly-metrics"});
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/qaqc-monthly-missing-data-preview.pdf",pdf);
  },30000);
  it("keeps conditional not-applicable rules and literal user content unchanged",async()=>{
    const {body,text}=await mapped({...report,data:{...data,
      narrative:"Author note: To be mapped is the issue reported.",
      material:{...data.material,osdAvailable:false},
      internalAudit:{conducted:false},pqpStatus:"Under Preparation"}});
    expect(text).toContain("Author note: To be mapped is the issue reported.");
    const osd=children(body,"tbl").find(t=>t.textContent?.includes("OSD available"))!;
    expect(children(osd,"tr").slice(1).every(row=>children(row,"tc")
      .filter((_,index)=>index%2===1).every(cell=>cell.textContent==="Not applicable"))).toBe(true);
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
