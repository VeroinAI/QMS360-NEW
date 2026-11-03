import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { setDateFormatResolver } from "@workspace/spreadsheet-dates";
beforeEach(() => setDateFormatResolver(() => "DD-MM-YYYY"));
afterEach(() => setDateFormatResolver(() => "DD/MM/YYYY"));
import { PDFDocument } from "pdf-lib";
import { XMLSerializer } from "@xmldom/xmldom";
import { mkdir,writeFile } from "node:fs/promises";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { children,child,attr } from "./qaqc-monthly-report-template";
import { calculateReport } from "./qaqc-reporting-model";
import { DAILY_ADDITIONS } from "@workspace/field-controls";
import { exportQaqcReportPdf,type QaqcReportExport } from "./qaqc-reporting-export";

const disciplines=["Civil","Structural","Mechanical","Electrical","Instrumentation"];
const entities=["Client","Algihaz","Supplier"];
const statuses=["underReview","A","B","C","D","E"];
const make=(approved:number)=>({
  disciplines:Object.fromEntries(["drawings","submittals"].map(key=>[key,Object.fromEntries(disciplines.map(d=>[d,{approved,resubmit:2,rejected:1,underReview:3}]))])),
  documentTypes:Object.fromEntries(["Drawings","Material Submittals","Method Statements","ITPs","RFIs","Procedures","Calculations","Vendors"].map(k=>[k,approved])),
  revisions:{drawings:[{name:"REV-A",value:approved}],submittals:[{name:"REV-A",value:approved+1}]},
  pending:Object.fromEntries(entities.map(e=>[e,Object.fromEntries(statuses.map(s=>[s,{upTo7:4,days8To30:2,over30:1}]))])),
  correspondence:{outgoing:approved,incoming:approved},
  rejectedSubmissions:{drawing:1,materials:2,calculation:3,general:4},
});
const data=make(10),baseline=make(8);
const report:QaqcReportExport={
  id:"daily-example-id",organizationId:"org-id",projectId:"project-id",projectName:"Example Construction",
  projectCode:"PROJECT-900",costCentre:"CC-900",projectTeam:{pmName:"Example PM",peName:"Example PE",dcName:"Example DC"},
  reportType:"daily",period:"2026-10-19",state:"submitted",data,baseline,computed:calculateReport("daily",data,baseline),
  referenceNumber:"DAILY-900",createdByName:"Actual Preparer",submittedAt:"2026-10-19T12:45:00Z",organizationTimezone:"Asia/Riyadh",
};
async function mapped(r=report) {
  const result=await buildDailyReportDocument(r);
  return {...result,blocks:children(result.body),text:result.body.textContent!,xml:new XMLSerializer().serializeToString(result.body)};
}
const table=(result:Awaited<ReturnType<typeof mapped>>,heading:string)=>result.blocks.find(b=>b.localName==="tbl"&&b.textContent!.startsWith(heading))!;
const cells=(t:ReturnType<typeof table>,r:number)=>children(children(t,"tr")[r]!,"tc");
describe("Word-based Daily Submission download",()=>{
  it("renders new cumulative entries exactly once, matching the cumulative download rather than adding the baseline", async () => {
    const cumulative = { ...data, dailyDisciplineInputMode: "daily_cumulative_v2", dailySupplementInputMode: "daily_cumulative_v2" };
    const existing = await mapped();
    const current = await mapped({ ...report, data: cumulative, computed: calculateReport("daily", cumulative, baseline) });
    expect(current.text).toBe(existing.text);
  });
  it("uses actual project identity, team, preparer and organization-local submission time, not sample data",async()=>{
    const {text}=await mapped();
    for(const s of ["Example Construction","PROJECT-900","CC-900","Example PM","Example PE","Example DC","Actual Preparer","19-10-2026  15:45","Asia/Riyadh"])expect(text).toContain(s);
    expect(text).not.toContain("REPORT ID");expect(text).not.toContain("DAILY-900");
    for(const s of ["Alpha District","AGH-ALPHA","CC-3107","S. Rahman","M. Khan","A. Nair","DDG-20261018","FOR REVIEW ONLY","Display rules for the PDF generator","Sample data is illustrative","First report for this project"])expect(text).not.toContain(s);
  });
  it("maps daily additions as movement and cumulative totals in the supplied Word layout",async()=>{
    const dailyData = { ...data, dailyDisciplineInputMode: DAILY_ADDITIONS };
    const result = await mapped({ ...report, data: dailyData, computed: calculateReport("daily", dailyData, baseline) });
    expect(cells(table(result,"CUMULATIVE"),4).map(c=>c.textContent)).toEqual(["Submission total","300","180","40","20","60"]);
    expect(cells(table(result,"ADDED SINCE"),4).map(c=>c.textContent)).toEqual(["Submission total","+160","+100","+20","+10","+30"]);
  });
  it("maps both summaries and calculates approved share from all five disciplines of both document categories",async()=>{
    const result=await mapped();
    const delta=cells(table(result,"ADDED SINCE"),4).map(c=>c.textContent);
    expect(delta).toEqual(["Submission total","+20","+20","0","0","0"]);
    const cumulative=cells(table(result,"CUMULATIVE"),4).map(c=>c.textContent);
    expect(cumulative).toEqual(["Submission total","160","100","20","10","30"]);
    expect(result.text).toContain("62.5%");
  });
  it("matches revisions by normalized name within document category, not by array position",async()=>{
    const changed={...report,baseline:{...baseline,revisions:{drawings:[{name:"other",value:90},{name:" rev-a ",value:3}],submittals:[{name:"REV-A",value:7}]}}};
    const result=await mapped(changed),t=table(result,"Document typeRevision no.");
    expect(cells(t,1).map(c=>c.textContent)).toEqual(["Drawing","REV-A","3","10","▲ +7","12.5%"]);
    expect(cells(t,2).map(c=>c.textContent)).toEqual(["Submittal","REV-A","7","11","▲ +4","13.8%"]);
  });
  it("uses the saved baseline and treats first-report yesterday values as zero",async()=>{
    const result=await mapped({...report,baseline:{}});
    expect(result.text).toContain("First report for this project – no earlier submission exists");
    expect(cells(table(result,"ADDED SINCE"),4).map(c=>c.textContent)).toEqual(["Submission total","+160","+100","+20","+10","+30"]);
  });
  it("maps document-type aliases, rejected totals and pending-day rollups and highlights older reviews",async()=>{
    const result=await mapped(),pending=table(result,"EntityBucket");
    expect(cells(pending,22).map(c=>c.textContent)).toEqual(["All parties","72","36","18","126"]);
    expect(cells(pending,7).map(c=>c.textContent)).toEqual(["Client total","24","12","6","42"]);
    expect(attr(child(child(cells(pending,1)[4]!,"tcPr"),"shd"),"fill")).toBe("FCE4EC");
    const docTypes=table(result,"Document typeYesterday");
    expect(cells(docTypes,4).map(c=>c.textContent)).toEqual(["ITP","8","10","▲ +2"]);
    expect(cells(docTypes,8).map(c=>c.textContent)).toEqual(["Vendor Documents","8","10","▲ +2"]);
    const rejected=result.blocks.find(b=>b.localName==="tbl"&&b.textContent!.includes("Total rejected"))!;
    expect(cells(rejected,5).map(c=>c.textContent)).toEqual(["Total rejected","10","10","● 0"]);
  });
  it("never borrows sample identities/counts for missing fields or missing submission metadata",async()=>{
    const result=await mapped({...report,projectName:null,projectCode:null,costCentre:null,projectTeam:{},createdByName:null,submittedAt:null,referenceNumber:null,data:{},computed:{},baseline:{}});
    expect(result.text).toContain("To be mapped");expect(result.text).toContain("No revision rows added");
    expect(result.text).not.toContain("S. Rahman");expect(result.text).not.toContain("64.3%");
    expect(result.text).not.toContain("daily-example-id");
  });
  it("keeps true zero values and zero-denominator percentages, rather than N/A or sample percentages",async()=>{
    const zeros=make(0);
    for(const category of Object.values(zeros.disciplines))for(const row of Object.values(category))Object.assign(row,{approved:0,resubmit:0,rejected:0,underReview:0});
    const result=await mapped({...report,data:zeros,computed:calculateReport("daily",zeros,{}),baseline:{}});
    expect(result.text).toContain("0.0%");expect(result.text).not.toContain("64.3%");
    expect(cells(table(result,"CUMULATIVE"),4).map(c=>c.textContent)).toEqual(["Submission total","0","0","0","0","0"]);
  });
  it("uses each revision's own category even when category totals differ or only one total is zero",async()=>{
    const changed=structuredClone(data);
    changed.disciplines.submittals!.Civil!.approved+=80;
    const makeReport=()=>({...report,data:changed,computed:calculateReport("daily",changed,baseline)});
    const result=await mapped(makeReport());
    expect(cells(table(result,"Document typeRevision no."),1)[5]!.textContent).toBe("12.5%");
    expect(cells(table(result,"Document typeRevision no."),2)[5]!.textContent).toBe("6.9%");
    for(const row of Object.values(changed.disciplines.drawings!))Object.assign(row,{approved:0,resubmit:0,rejected:0,underReview:0});
    const zero=await mapped(makeReport());
    expect(cells(table(zero,"Document typeRevision no."),1)[5]!.textContent).toBe("0.0%");
    expect(cells(table(zero,"Document typeRevision no."),2)[5]!.textContent).toBe("6.9%");
  });
  const approvedReport=():QaqcReportExport=>({
    ...report,state:"approved",baseline:{...baseline,__dailyApproval:{
      version:1,cycle:2,currentIndex:3,
      stages:[1,2,3].map(level=>({level,candidates:[{id:`user-${level}`,name:level===3?"Actual Final Approver":`Actual Reviewer ${level}`}]})),
      history:[
        {cycle:1,level:1,decision:"approve",userId:"previous-cycle",at:"2026-10-18T10:00:00Z"},
        {cycle:2,level:3,decision:"approve",userId:"user-3",at:"2026-10-22T22:30:00Z"},
        {cycle:2,level:2,decision:"approve",userId:"user-2",at:"2026-10-21T10:00:00Z"},
        {cycle:2,level:1,decision:"approve",userId:"user-1",at:"2026-10-20T10:00:00Z"},
        {cycle:2,level:1,decision:"submitted",userId:"submitter",at:"2026-10-19T12:45:00Z"},
      ],
    }},
  });
  it("retains preparation/submission tiles, removes the Report ID tile and adds dated approval tiles in order",async()=>{
    const result=await mapped(approvedReport()),signoff=table(result,"PREPARED BY");
    expect(children(signoff,"tr").map(row=>children(row,"tc").map(cell=>cell.textContent))).toEqual([
      ["PREPARED BYActual PreparerTo be mapped","SUBMITTED ON19-10-2026  15:45Time zone: Asia/Riyadh"],
      ["REVIEWED BYActual Reviewer 1","REVIEWED ON20-10-2026  13:00"],
      ["REVIEWED BYActual Reviewer 2","REVIEWED ON21-10-2026  13:00"],
      ["APPROVED BYActual Final Approver","APPROVED ON23-10-2026  01:30"],
    ]);
    expect(result.text).not.toContain("REPORT ID");expect(result.text).not.toContain("daily-example-id");
    expect(signoff.textContent).not.toContain("Former or unavailable user");
    expect(children(child(signoff,"tblGrid")!)).toHaveLength(2);
  });
  it("does not certify assigned approvers, pending decisions or previous submission cycles",async()=>{
    for(const state of ["submitted","sent_back","draft"]) {
      const input=approvedReport();input.state=state;
      const workflow=input.baseline.__dailyApproval as any;
      workflow.history=workflow.history.filter((event:any)=>event.cycle===1||event.level!==3);
      const result=await mapped(input);
      expect(result.text).toContain("REVIEWED BYActual Reviewer 1");
      expect(result.text).not.toContain("APPROVED BY");
      expect(result.text).not.toContain("Actual Final Approver");
    }
    const result=await mapped({...report,state:"approved",approverId:"assigned-only"});
    expect(result.text).not.toContain("APPROVED BY");
    expect(result.text).not.toContain("REVIEWED BY");
  });
  it("supports a single final approval without an intermediate reviewer",async()=>{
    const input=approvedReport(),workflow=input.baseline.__dailyApproval as any;
    workflow.stages=workflow.stages.slice(2);
    workflow.history=workflow.history.filter((event:any)=>event.cycle===2&&event.level===3);
    const result=await mapped(input);
    expect(result.text).toContain("APPROVED BYActual Final Approver");
    expect(result.text).not.toContain("REVIEWED BY");
  });
  it("uses actual legacy approval evidence without borrowing names from another report workflow",async()=>{
    const input={...report,state:"approved",history:[
      {action:"approve",actorName:"Actual Legacy Approver",createdAt:"2026-10-20T10:00:00Z",after:{state:"approved"}},
      {action:"approve",actorName:"Prior Cycle Approver",createdAt:"2026-10-18T10:00:00Z",after:{state:"approved"}},
    ]};
    const result=await mapped(input);
    expect(result.text).toContain("APPROVED BYActual Legacy Approver");
    expect(result.text).not.toContain("Prior Cycle Approver");
    const foreign=await mapped({...report,baseline:{...baseline,__monthlyApproval:(approvedReport().baseline as any).__dailyApproval}});
    expect(foreign.text).not.toContain("REVIEWED BY");
  });
  it("renders approval tiles and flows long names and many reviewers into readable continuation pages",async()=>{
    const input=approvedReport(),workflow=input.baseline.__dailyApproval as any;
    workflow.stages=Array.from({length:20},(_,i)=>({level:i+1,candidates:[{id:`reviewer-${i}`,name:`Daily Reviewer ${i+1} with a long quality management name and designation`}]}));
    workflow.history=workflow.stages.map((stage:any,i:number)=>({cycle:2,level:stage.level,decision:"approve",userId:`reviewer-${i}`,at:`2026-11-${String(i+1).padStart(2,"0")}T09:00:00Z`}));
    const result=await mapped(input);
    expect(children(table(result,"PREPARED BY"),"tr")).toHaveLength(21);
    const bytes=await exportQaqcReportPdf(input,{templateId:"daily-submission"});
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/daily-report-approval-overflow-preview.pdf",bytes);
    await writeFile("../../generated-artifacts/daily-report-approval-preview.pdf",
      await exportQaqcReportPdf(approvedReport(),{templateId:"daily-submission"}));
  },30000);
  it("produces readable styled pages and flows large revision lists without dropping rows",async()=>{
    const normal=await exportQaqcReportPdf(report,{templateId:"daily-submission"});
    const pdf=await PDFDocument.load(normal);expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(pdf.getTitle()).toContain("Daily Document Governance Report");
    const large={...report,data:{...data,revisions:{drawings:Array.from({length:85},(_,i)=>({name:`ACTUAL-REV-${i}`,value:i})),submittals:[]}}};
    const mappedLarge=await mapped(large);
    expect(mappedLarge.text).toContain("ACTUAL-REV-84");
    const overflow=await exportQaqcReportPdf(large,{templateId:"daily-submission"});
    expect((await PDFDocument.load(overflow)).getPageCount()).toBeGreaterThan(pdf.getPageCount());
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/daily-report-preview.pdf",normal);
    await writeFile("../../generated-artifacts/daily-report-overflow-preview.pdf",overflow);
  });
});
