import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { csatReportValues } from "./qaqc-csat-report-pdf";
import { exportQaqcReportPdf, type QaqcReportExport } from "./qaqc-reporting-export";

const report: QaqcReportExport = {
  id:"csat-example-report",organizationId:"example-org",projectId:"example-project",
  projectName:"Example Construction Project",projectLocation:"Riyadh",reportType:"csat",
  period:"2026-10-16",state:"submitted",baseline:{},computed:{averageRating:4},
  data:{
    ratings:{quality:5,timeline:4,communication:3,professionalism:5,valueForMoney:2,issueHandling:1},
    satisfactoryAspects:"Clear communication and timely updates.",
    improvementSuggestions:"Provide earlier notice of schedule changes.",
    comments:"Thank you for the team's support.",
    expectations:"Yes",recommend:"Partially",
  },
};
describe("Customer Word CSAT PDF",()=>{
  it("maps customer name and both contact fields from Project Master Additional Data",()=>{
    const v=csatReportValues({...report,
      submittedByName:"Report Submitter",
      projectAdditionalData:{name:"  Project Contact  ",email:" quality@example.test ",phone:"+91 9876543210"},
      data:{...report.data,followUp:"Yes",preferredContactMethod:"Email during office hours"},
    });
    expect(v.name).toBe("Project Contact");
    expect(v.contact).toBe("quality@example.test / +91 9876543210");
    expect(v.followUp).toBe("Yes");expect(v.contactMethod).toBe("Email during office hours");
    expect(v.name).not.toBe("Report Submitter");
  });
  it("keeps available contact details and uses To be mapped only when unavailable",()=>{
    expect(csatReportValues({...report,projectAdditionalData:{email:"quality@example.test",phone:null}}).contact).toBe("quality@example.test");
    expect(csatReportValues({...report,projectAdditionalData:{phone:"+91 9876543210",email:""}}).contact).toBe("+91 9876543210");
    const v=csatReportValues({...report,submittedByName:"Not the customer",projectAdditionalData:{name:" ",email:[],phone:null}});
    expect(v.name).toBe("To be mapped");expect(v.contact).toBe("To be mapped");
  });
  it("maps saved follow-up responses and never prints a stale contact method for No",()=>{
    const v=csatReportValues({...report,data:{...report.data,followUp:"Yes",preferredContactMethod:"Phone after 5pm"}});
    expect(v.followUp).toBe("Yes");expect(v.contactMethod).toBe("Phone after 5pm");
    const no=csatReportValues({...report,data:{...report.data,followUp:"No",preferredContactMethod:"Old preference"}});
    expect(no.followUp).toBe("No");expect(no.contactMethod).toBe("To be mapped");
  });
  it("maps actual six ratings, feedback, project, survey date and outcomes",()=>{
    const v=csatReportValues(report);
    expect(v.ratings).toEqual([5,4,3,5,2,1]);
    expect(v.satisfactory).toBe(report.data.satisfactoryAspects);
    expect(v.improvements).toBe(report.data.improvementSuggestions);
    expect(v.comments).toBe(report.data.comments);
    expect(v.location).toBe("Riyadh");expect(v.date).toBe("16-10-2026");
    expect(v.expectations).toBe("Yes");expect(v.recommend).toBe("Partially");
  });
  it("does not invent optional customer identities or silently map Partially to Maybe",()=>{
    const v=csatReportValues(report);
    for(const k of ["name","contact","followUp","contactMethod"] as const)expect(v[k]).toBe("To be mapped");
    expect(v.recommend).not.toBe("Maybe");
  });
  it("leaves incomplete draft ratings and outcomes unmatched instead of selecting zero or No",()=>{
    const v=csatReportValues({...report,data:{ratings:{quality:0,timeline:6,communication:2.5,professionalism:"4"}}});
    expect(v.ratings).toEqual([null,null,null,null,null,null]);
    expect(v.expectations).toBeNull();expect(v.recommend).toBeNull();
    expect(v.satisfactory).toBe("To be mapped");expect(v.comments).toBe("To be mapped");
  });
  it("exports the original one-page form using the common export API",async()=>{
    const bytes=await exportQaqcReportPdf({...report,
      projectAdditionalData:{name:"Project Contact",email:"quality@example.test",phone:"+91 9876543210"},
      data:{...report.data,followUp:"Yes",preferredContactMethod:"Email during office hours"},
    },{templateId:"csat-form"});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain("Example Construction Project");
    expect(pdf.getPages()[0]!.getWidth()).toBeCloseTo(595.3,0);
    expect(report.data.recommend).toBe("Partially");
    await mkdir("../../generated-artifacts",{recursive:true});
    await writeFile("../../generated-artifacts/csat-report-preview.pdf",bytes);
  });
  it("preserves long feedback on continuation pages without shrinking into unreadable text",async()=>{
    const bytes=await exportQaqcReportPdf({...report,data:{...report.data,comments:"Long customer feedback for continuation testing. ".repeat(160)}},{templateId:"csat-form"});
    const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBeGreaterThan(1);
    await writeFile("../../generated-artifacts/csat-report-overflow-preview.pdf",bytes);
  });
  it("handles missing project details and empty saved drafts",async()=>{
    const bytes=await exportQaqcReportPdf({...report,data:{},projectName:null,projectLocation:null,state:"draft"},{templateId:"csat-form"});
    const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);
    await writeFile("../../generated-artifacts/csat-report-empty-preview.pdf",bytes);
  });
  it("does not replace other CSAT template exports",async()=>{
    const pdf=await PDFDocument.load(await exportQaqcReportPdf(report,{templateId:"builtin"}));
    expect(pdf.getTitle() ?? "").not.toContain("Customer Satisfaction (CSAT)");
  });
});
