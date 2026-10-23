import {describe,expect,it} from "vitest";
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
  it("keeps all remark subactivities in one activity entry",()=>{
    const remarks="Check documents\nInterview the project team\nVerify supporting evidence\nConfirm all records";
    const entries=programmeEntries([row("Design review",remarks)]);
    expect(entries).toHaveLength(1);
    expect(normalized(entries[0]!.details)).toContain(normalized(remarks));
    expect(entries[0]!.details).toContain("Auditee:");
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
    const remarks=Array.from({length:160},(_,i)=>`Evidence check ${i}.`).join("\n");
    const pages=programmePages([row("One very long activity",remarks)]);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().filter(block=>!block.continued)).toHaveLength(1);
    expect(normalized(pages.flat().map(block=>block.details).join(""))).toContain(normalized(remarks));
    expect(pages.slice(1).flat().every(block=>block.times==="Activity continued")).toBe(true);
  });
});
describe("Generated Audit Program and Participation slide",()=>{
  it("renders exactly one circle per activity, not per remark or wrapped line",async()=>{
    const remarks="Check documents\nInterview personnel\nVerify evidence\nConfirm records";
    const docs=await output([row("First activity",remarks),row("Second activity","Review the remaining records")]);
    expect(docs.reduce((count,doc)=>count+markers(doc).length,0)).toBe(2);
    const details=docs.flatMap(doc=>[11,14,17,20,23].map(id=>text(shape(doc,id)))).join(" ");
    expect(normalized(details)).toContain(normalized(remarks));
    expect(details).toContain("First activity");
    expect(details).toContain("Second activity");
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
  it("preserves long remarks across slides without additional circles or empty template milestones",async()=>{
    const remarks=Array.from({length:110},(_,i)=>`Check saved item ${i}.`).join("\n");
    const docs=await output([row("Long factual activity",remarks)]);
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.reduce((count,doc)=>count+markers(doc).length,0)).toBe(1);
    expect(docs.slice(1).every(doc=>markers(doc).length===0)).toBe(true);
    const details=docs.flatMap(doc=>[11,14,17,20,23].map(id=>text(shape(doc,id)))).join("");
    expect(normalized(details)).toContain(normalized(remarks));
    expect(docs.slice(1).some(doc=>text(shape(doc,10))==="Activity continued")).toBe(true);
  });
  it("does not leave sample circles for an empty programme",async()=>{
    const docs=await output([]);
    expect(docs).toHaveLength(1);
    expect(markers(docs[0]!)).toEqual([]);
    expect(shape(docs[0]!,8)).toBeUndefined();
  });
});
