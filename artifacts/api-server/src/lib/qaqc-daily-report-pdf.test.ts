import { describe,expect,it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { XMLSerializer } from "@xmldom/xmldom";
import { mkdir,writeFile } from "node:fs/promises";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { children,child,attr } from "./qaqc-monthly-report-template";
import { calculateReport } from "./qaqc-reporting-model";
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
  it("uses actual project identity, team, preparer and organization-local submission time, not sample data",async()=>{
    const {text}=await mapped();
    for(const s of ["Example Construction","PROJECT-900","CC-900","Example PM","Example PE","Example DC","Actual Preparer","19-10-2026  15:45","Asia/Riyadh","DAILY-900"])expect(text).toContain(s);
    for(const s of ["Alpha District","AGH-ALPHA","CC-3107","S. Rahman","M. Khan","A. Nair","DDG-20261018","FOR REVIEW ONLY","Display rules for the PDF generator","Sample data is illustrative","First report for this project"])expect(text).not.toContain(s);
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
    expect(cells(t,1).map(c=>c.textContent)).toEqual(["Drawing","REV-A","3","10","▲ +7","6.3%"]);
    expect(cells(t,2).map(c=>c.textContent)).toEqual(["Submittal","REV-A","7","11","▲ +4","6.9%"]);
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
    expect(result.text).toContain("daily-example-id");
  });
  it("keeps true zero values and zero-denominator percentages, rather than N/A or sample percentages",async()=>{
    const zeros=make(0);
    for(const category of Object.values(zeros.disciplines))for(const row of Object.values(category))Object.assign(row,{approved:0,resubmit:0,rejected:0,underReview:0});
    const result=await mapped({...report,data:zeros,computed:calculateReport("daily",zeros,{}),baseline:{}});
    expect(result.text).toContain("0.0%");expect(result.text).not.toContain("64.3%");
    expect(cells(table(result,"CUMULATIVE"),4).map(c=>c.textContent)).toEqual(["Submission total","0","0","0","0","0"]);
  });
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
