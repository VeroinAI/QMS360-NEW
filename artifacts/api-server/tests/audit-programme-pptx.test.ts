import {describe,expect,it} from "vitest";
import {writeFile} from "node:fs/promises";
import {DOMParser,type Document,type Element} from "@xmldom/xmldom";
import {strFromU8,unzipSync} from "fflate";
import {programmeEntries,programmePages,PROGRAMME_HEIGHT,PROGRAMME_TOP} from "../src/lib/audit-programme-pptx-layout";
import {buildConsolidatedAuditReport} from "../src/lib/audit-consolidated-report";
import {renderConsolidatedAuditPptx} from "../src/lib/audit-consolidated-pptx";

const A="http://schemas.openxmlformats.org/drawingml/2006/main",P="http://schemas.openxmlformats.org/presentationml/2006/main";
const els=(node:Document|Element,ns:string,tag:string)=>Array.from(node.getElementsByTagNameNS(ns,tag));
const shape=(doc:Document,id:number)=>els(doc,P,"sp").find(node=>els(node,P,"cNvPr")[0]?.getAttribute("id")===String(id));
const text=(node?:Element)=>node?els(node,A,"t").map(t=>t.textContent??"").join(" "):"";
const normalized=(value:string)=>value.replace(/\s/g,"");
const markers=(doc:Document)=>[9,12,15,18,21].filter(id=>!!shape(doc,id));
const row=(activity:string,remarks:string)=>["2026-10-23T09:00","2026-10-23T10:00",activity,remarks,"Actual auditee"];
async function output(rows:string[][]){
  const sections=buildConsolidatedAuditReport({
    audit:{title:"Programme grouping check"},plan:{activities:rows.map(r=>({
      plannedStartDateTime:r[0],plannedEndDateTime:r[1],section:r[2],remarks:r[3],auditeeIds:["auditee"],
    }))},names:new Map([["auditee","Actual auditee"]]),roleNames:new Map(),legacyFindings:[],cars:[],evidence:[],
  });
  const files=unzipSync(await renderConsolidatedAuditPptx({sections}));
  return Object.entries(files).filter(([name])=>/^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map(([,bytes])=>new DOMParser().parseFromString(strFromU8(bytes),"application/xml"))
    .filter(doc=>text(shape(doc,37)).includes("Not represented in"));
}
describe("Activity-level programme pagination",()=>{
  it("shows main activity, times and auditee without multiline remark subactivities",()=>{
    const remarks="Check documents\nInterview the project team\nVerify supporting evidence\nConfirm all records";
    const entries=programmeEntries([row("Design review",remarks)]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toBe("Activity: Design review\nAuditee: Actual auditee");
    expect(entries[0]!.times).toBe("Start: 23 Oct 2026, 09:00\nEnd: 23 Oct 2026, 10:00");
    expect(entries[0]!.details).not.toContain("Remarks:");
    for(const remark of remarks.split("\n"))expect(entries[0]!.details).not.toContain(remark);
  });
  it("ignores extremely long remarks before wrapping and pagination without mutating rows",()=>{
    const rows=[row("Design review",("Hidden subactivity\n"+"W".repeat(2000)).repeat(200))];
    const before=JSON.stringify(rows);
    expect(programmePages(rows)).toEqual(programmePages([row("Design review","")]));
    expect(programmePages(rows)).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(before);
    expect(programmePages([])).toEqual([[]]);
  });
  it("packs complete activities into variable-height blocks without overlap",()=>{
    const rows=Array.from({length:9},(_,i)=>row(`Activity ${i}`,`Subactivity one ${i}\nSubactivity two ${i}\nSubactivity three ${i}`));
    const pages=programmePages(rows);
    expect(pages.flat().filter(block=>!block.continued)).toHaveLength(9);
    for(const page of pages){
      expect(page.length).toBeLessThanOrEqual(5);
      page.forEach((block,i)=>{
        expect(block.top).toBeGreaterThanOrEqual(PROGRAMME_TOP);
        expect(block.top+block.height).toBeLessThanOrEqual(PROGRAMME_TOP+PROGRAMME_HEIGHT);
        if(page[i+1])expect(block.top+block.height).toBeLessThanOrEqual(page[i+1]!.top);
      });
    }
  });
  it("splits only oversized activities, marking later parts as unmarked continuations",()=>{
    const activity=Array.from({length:160},(_,i)=>`Main activity detail ${i}.`).join("\n");
    const pages=programmePages([row(activity,"Hidden remark")]);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().filter(block=>!block.continued)).toHaveLength(1);
    expect(normalized(pages.flat().map(block=>block.details).join(""))).toContain(normalized(activity));
    expect(pages.flat().map(block=>block.details).join("")).not.toContain("Hidden remark");
    expect(pages.slice(1).flat().every(block=>block.times==="Activity continued")).toBe(true);
  });
});
describe("Generated Audit Program and Participation slide",()=>{
  it("keeps all package parts identical when only saved remarks change, preserving shared report data",async()=>{
    const remarks="Hidden document checks\n"+"Hidden interview subactivity\n".repeat(1100);
    const sections=buildConsolidatedAuditReport({
      audit:{title:"Main activity milestone verification",openingMeeting:{attendees:["auditee"]},closingMeeting:{attendees:[]}},
      plan:{teamMemberIds:["auditor"],auditeeRoleIds:["auditee-role"],activities:[
        {section:"Design review",remarks,plannedStartDateTime:"2026-10-23T09:00",plannedEndDateTime:"2026-10-23T10:00",auditeeIds:["auditee"]},
        {section:"Construction inspection",remarks:"Hidden field checks",plannedStartDateTime:"2026-10-23T10:00",plannedEndDateTime:"2026-10-23T11:00",auditeeIds:["auditee"]},
      ]},names:new Map([["auditee","Actual auditee"],["auditor","Actual auditor"]]),roleNames:new Map([["auditee-role","Actual auditee role"]]),
      legacyFindings:[],cars:[],evidence:[],pptxWorkbookMappings:true,
    });
    const before=structuredClone(sections);
    const bytes=await renderConsolidatedAuditPptx({sections});
    expect(sections).toEqual(before);
    expect(sections.find(s=>s.key==="programme")!.tables[0]!.rows[0]![3]).toBe(remarks);
    const withoutRemarks=structuredClone(sections);
    withoutRemarks.find(s=>s.key==="programme")!.tables[0]!.rows.forEach(r=>{r[3]="";});
    const actual=unzipSync(bytes),expected=unzipSync(await renderConsolidatedAuditPptx({sections:withoutRemarks}));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for(const path of Object.keys(actual))expect(Buffer.from(actual[path]!),path).toEqual(Buffer.from(expected[path]!));
    const doc=new DOMParser().parseFromString(strFromU8(actual["ppt/slides/slide5.xml"]!),"application/xml");
    expect(text(shape(doc,28))).toBe("Actual auditor");
    expect(text(shape(doc,33))).toBe("Actual auditee role");
    expect(text(shape(doc,38))).toBe("Actual auditee");
    expect(text(shape(doc,10))).toBe("Start: 23 Oct 2026, 09:00 End: 23 Oct 2026, 10:00");
    expect(text(shape(doc,13))).toBe("Start: 23 Oct 2026, 10:00 End: 23 Oct 2026, 11:00");
    if(process.env.QMS_PROGRAMME_VISUAL==="1")await writeFile("../../generated-artifacts/audit-programme-main-activities.pptx",bytes);
  });
  it("retains recorded meetings when only minutes are present, without showing their remark text",async()=>{
    const sections=buildConsolidatedAuditReport({
      audit:{title:"Recorded meetings",openingMeeting:{minutes:"Hidden opening minutes"},closingMeeting:{minutes:"Hidden closing minutes"}},
      names:new Map(),roleNames:new Map(),legacyFindings:[],cars:[],evidence:[],pptxWorkbookMappings:true,
    });
    const files=unzipSync(await renderConsolidatedAuditPptx({sections}));
    const doc=new DOMParser().parseFromString(strFromU8(files["ppt/slides/slide5.xml"]!),"application/xml");
    expect(markers(doc)).toHaveLength(2);
    const content=normalized(els(doc,A,"t").map(t=>t.textContent??"").join(" "));
    expect(content).toContain(normalized("Opening meeting (recorded)"));
    expect(content).toContain(normalized("Closing meeting (recorded)"));
    expect(content).not.toMatch(/Hidden|Remarks:/);
  });
  it("renders exactly one circle per activity, not per remark or wrapped line",async()=>{
    const remarks="Check documents\nInterview personnel\nVerify evidence\nConfirm records";
    const docs=await output([row("First activity",remarks),row("Second activity","Review the remaining records")]);
    expect(docs.reduce((count,doc)=>count+markers(doc).length,0)).toBe(2);
    const details=docs.flatMap(doc=>[11,14,17,20,23].map(id=>text(shape(doc,id)))).join(" ");
    for(const remark of [...remarks.split("\n"),"Review the remaining records"])expect(details).not.toContain(remark);
    expect(details).not.toContain("Remarks:");
    expect(details).toContain("First activity");
    expect(details).toContain("Second activity");
    expect(details.indexOf("First activity")).toBeLessThan(details.indexOf("Second activity"));
    expect(docs).toHaveLength(1);
    for(const doc of docs)for(const id of [11,14,17,20,23]){
      const node=shape(doc,id);if(!node)continue;
      const lines=els(node,A,"p").length;
      const off=els(node,A,"off")[0]!,ext=els(node,A,"ext")[0]!;
      expect(Number(ext.getAttribute("cy"))).toBeGreaterThanOrEqual(lines*146050);
      expect(Number(off.getAttribute("y"))+Number(ext.getAttribute("cy"))).toBeLessThanOrEqual(PROGRAMME_TOP+PROGRAMME_HEIGHT);
      for(const paragraph of els(node,A,"pPr")){
        expect(els(paragraph,A,"buChar")).toHaveLength(0);
        expect(els(paragraph,A,"buAutoNum")).toHaveLength(0);
        expect(els(paragraph,A,"buNone")).toHaveLength(1);
      }
    }
  });
  it("does not create slides or continuation milestones for extremely long hidden remarks",async()=>{
    const remarks=Array.from({length:1100},(_,i)=>`Hidden saved subactivity ${i}.`).join("\n");
    const docs=await output([row("Long factual activity",remarks)]);
    expect(docs).toHaveLength(1);
    expect(markers(docs[0]!)).toHaveLength(1);
    const content=els(docs[0]!,A,"t").map(t=>t.textContent??"").join(" ");
    expect(content).toContain("Long factual activity");
    expect(content).not.toMatch(/Hidden saved|Remarks:|Activity continued/);
  });
  it("continues genuinely long main activities without additional circles or empty template milestones",async()=>{
    const activity=Array.from({length:110},(_,i)=>`Main activity detail ${i}.`).join("\n");
    const docs=await output([row(activity,"Hidden subactivity")]);
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.reduce((count,doc)=>count+markers(doc).length,0)).toBe(1);
    expect(docs.slice(1).every(doc=>markers(doc).length===0)).toBe(true);
    const details=docs.flatMap(doc=>[11,14,17,20,23].map(id=>text(shape(doc,id)))).join("");
    expect(normalized(details)).toContain(normalized(activity));
    expect(details).not.toContain("Hidden subactivity");
    expect(docs.slice(1).some(doc=>text(shape(doc,10))==="Activity continued")).toBe(true);
  });
  it("does not leave sample circles for an empty programme",async()=>{
    const docs=await output([]);
    expect(docs).toHaveLength(1);
    expect(markers(docs[0]!)).toEqual([]);
    expect(shape(docs[0]!,8)).toBeUndefined();
  });
});
