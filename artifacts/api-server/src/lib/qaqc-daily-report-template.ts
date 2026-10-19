import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { QaqcReportExport } from "./qaqc-reporting-export";
import { child, children, descendants, monthlyAsset, monthlyDate, UNMAPPED, W } from "./qaqc-monthly-report-template";

type Obj = Record<string, any>;
type Count = number | undefined;
const disciplines=["Civil","Structural","Mechanical","Electrical","Instrumentation"];
const statuses=["approved","resubmit","rejected","underReview"];
const entities=["Client","Algihaz","Supplier"];
const buckets=["upTo7","days8To30","over30"];
const pendingStatuses=["underReview","A","B","C","D","E"];
const number=(v:unknown):Count=>typeof v==="number"&&Number.isFinite(v)?v:undefined;
const value=(v:unknown)=>v===null||v===undefined||v===""?UNMAPPED:String(v);
const sum=(vs:Count[]):Count=>vs.some(v=>v===undefined)?undefined:vs.reduce<number>((s,v)=>s+v!,0);
const diff=(current:Count,previous:Count):Count=>current===undefined||previous===undefined?undefined:current-previous;
const count=(v:Count)=>v===undefined?UNMAPPED:v.toLocaleString("en-US");
const signed=(v:Count)=>v===undefined?UNMAPPED:`${v>0?"+":v<0?"−":""}${count(Math.abs(v))}`;
const change=(v:Count)=>v===undefined?UNMAPPED:`${v>0?"▲":v<0?"▼":"●"} ${signed(v)}`;
const tone=(v:Count,kind="neutral")=>v===undefined||v===0||kind==="neutral"?"66666A"
  :(kind==="approved"?v>0:v<0)?"2E7D32":"C0392B";
const normalized=(v:unknown)=>String(v??"").trim().toLowerCase();

/** Only saved values and saved baseline are used. Never query a newer baseline
 * while downloading a historical report or retain the Word's sample figures.
 */
export async function buildDailyReportDocument(report:QaqcReportExport) {
  const files=unzipSync(await monthlyAsset("qaqc-daily-report-template.docx"));
  const doc=new DOMParser().parseFromString(strFromU8(files["word/document.xml"]!),"application/xml");
  const body=descendants(doc.documentElement!,"body")[0]!, blocks=children(body);
  const d=report.data as Obj, c=report.computed as Obj, b=report.baseline as Obj;
  const set=(p:Element,v:unknown,color?:string)=>{
    const run=child(p,"r")?.cloneNode(true) as Element|undefined;
    const replacement=run??doc.createElementNS(W,"w:r");
    children(p).filter(n=>n.localName!=="pPr").forEach(n=>p.removeChild(n));
    children(replacement).filter(n=>n.localName!=="rPr").forEach(n=>replacement.removeChild(n));
    if(color) {
      let props=child(replacement,"rPr");
      if(!props){props=doc.createElementNS(W,"w:rPr");replacement.appendChild(props);}
      let ink=child(props,"color");
      if(!ink){ink=doc.createElementNS(W,"w:color");props.appendChild(ink);}
      ink.setAttributeNS(W,"w:val",color);
    }
    const t=doc.createElementNS(W,"w:t");t.appendChild(doc.createTextNode(value(v)));
    replacement.appendChild(t);p.appendChild(replacement);
  };
  const cells=(i:number,r:number)=>children(children(blocks[i]!,"tr")[r]!,"tc");
  const put=(i:number,r:number,col:number,v:unknown,p=0,color?:string)=>set(children(cells(i,r)[col]!,"p")[p]!,v,color);
  const para=(i:number,v:unknown)=>set(blocks[i]!,v);
  const inline=(p:Element,values:string[])=>children(p,"r").forEach((run,i)=>{
    children(run).filter(n=>n.localName!=="rPr").forEach(n=>run.removeChild(n));
    const t=doc.createElementNS(W,"w:t");t.setAttribute("xml:space","preserve");
    t.appendChild(doc.createTextNode(values[i]??""));run.appendChild(t);
  });
  const current=(...path:string[]):Count=>number(path.reduce((o,k)=>o?.[k],d));
  // The form's auto-loaded previous counts default to zero, including newly
  // added disciplines/types/revisions absent from an older baseline.
  const previous=(...path:string[]):number=>number(path.reduce((o,k)=>o?.[k],b))??0;
  const total=(section:string,discipline:string)=>number(c.disciplineTotals?.[`${section}.${discipline}`])
    ??sum(statuses.map(s=>current("disciplines",section,discipline,s)));
  const priorTotal=(section:string,discipline:string)=>sum(statuses.map(s=>previous("disciplines",section,discipline,s)))!;
  const section=(section:string,s?:string)=>sum(disciplines.map(x=>s?current("disciplines",section,x,s):total(section,x)));
  const priorSection=(section:string,s?:string)=>sum(disciplines.map(x=>s?previous("disciplines",section,x,s):priorTotal(section,x)))!;
  const combined=(s?:string)=>sum(["drawings","submittals"].map(x=>section(x,s)));
  const priorCombined=(s?:string)=>sum(["drawings","submittals"].map(x=>priorSection(x,s)))!;
  const percentage=(n:Count,denominator:Count)=>n===undefined||denominator===undefined?UNMAPPED
    :`${(denominator===0?0:n/denominator*100).toFixed(1)}%`;
  const pendingBucket=(entity:string,bucket:string)=>sum(pendingStatuses.map(s=>current("pending",entity,s,bucket)));
  const pendingTotal=(entity:string)=>number(c.pendingTotals?.[entity])??sum(buckets.map(k=>pendingBucket(entity,k)));
  const allPending=sum(entities.map(pendingTotal)), allOver30=sum(entities.map(e=>pendingBucket(e,"over30")));
  const project=value(report.projectName), date=monthlyDate(report.period), team=report.projectTeam??{};
  put(0,0,0,project,1);
  inline(children(cells(0,0)[0]!,"p")[2]!,[`${value(report.projectCode)}   ·   Cost centre  `,value(report.costCentre)]);
  inline(children(cells(0,0)[0]!,"p")[3]!,["Project team:  ",`PM – ${value(team.pmName)}   ||   PE – ${value(team.peName)}   ||   DC – ${value(team.dcName)}`]);
  put(0,0,1,date,1);
  for(const i of [2,4])for(const [r,key] of [[2,"submittals"],[3,"drawings"],[4,"all"]] as const) {
    [undefined,...statuses].forEach((s,col)=>{
      const now=key==="all"?combined(s):section(key,s);
      const prior=key==="all"?priorCombined(s):priorSection(key,s);
      const delta=diff(now,prior);
      put(i,r,col+1,i===2?signed(delta):count(now),0,i===2?tone(delta,s):undefined);
    });
  }
  put(7,0,0,percentage(combined("approved"),combined()),1);
  const approvedChange=diff(combined("approved"),priorCombined("approved"));
  put(7,0,0,`${count(combined("approved"))} documents · ${change(approvedChange)}`,2,tone(approvedChange,"approved"));
  put(7,0,1,count(allOver30),1);put(7,0,1,`of ${count(allPending)} pending reviews`,2);
  put(7,0,2,`${count(current("correspondence","outgoing"))} / ${count(current("correspondence","incoming"))}`,1);
  put(7,0,2,`${change(diff(current("correspondence","outgoing"),previous("correspondence","outgoing")))} / ${change(diff(current("correspondence","incoming"),previous("correspondence","incoming")))} today`,2);
  put(7,0,3,count(allPending),1);put(7,0,3,entities.map(e=>`${e} ${count(pendingTotal(e))}`).join(" · "),2);
  put(9,0,1,report.projectCode);put(9,0,3,report.projectName);
  put(9,1,1,date);put(9,1,3,report.costCentre);
  put(9,2,1,team.pmName);put(9,2,3,team.peName);put(9,3,1,team.dcName);
  const baselineKeys=Object.keys(b).filter(k=>!["hasBaseline","previousPeriod","legacyFallback"].includes(k));
  if(b.hasBaseline===false||b.hasBaseline!==true&&baselineKeys.length===0)
    para(10,"First report for this project – no earlier submission exists, so Yesterday values start from zero.");
  else body.removeChild(blocks[10]!);
  for(const [i,key] of [[14,"drawings"],[16,"submittals"]] as const) {
    [...disciplines,"overall"].forEach((discipline,index)=>{
      const row=index+1,overall=discipline==="overall";
      statuses.forEach((s,col)=>{
        const now=overall?section(key,s):current("disciplines",key,discipline,s);
        const prior=overall?priorSection(key,s):previous("disciplines",key,discipline,s);
        const delta=diff(now,prior);
        put(i,row,col+1,count(now));put(i,row,col+1,change(delta),1,tone(delta,s));
      });
      const now=overall?section(key):total(key,discipline),prior=overall?priorSection(key):priorTotal(key,discipline);
      put(i,row,5,count(prior));put(i,row,6,count(now));put(i,row,7,change(diff(now,prior)),0,tone(diff(now,prior)));
    });
  }
  ["Drawings","Material Submittals","Method Statements","ITPs","RFIs","Procedures","Calculations","Vendors"].forEach((key,index)=>{
    const now=current("documentTypes",key),prior=previous("documentTypes",key);
    put(19,index+1,1,count(prior));put(19,index+1,2,count(now));put(19,index+1,3,change(diff(now,prior)),0,tone(diff(now,prior)));
  });
  // Clone a pristine row for every revision, not just the six illustrative rows.
  const revisionTable=blocks[22]!, original=children(revisionTable,"tr"), pristine=original[1]!.cloneNode(true) as Element;
  original.slice(1).forEach(r=>revisionTable.removeChild(r));
  let revisionCount=0;
  for(const key of ["drawings","submittals"])for(const row of Array.isArray(d.revisions?.[key])?d.revisions[key]:[]) {
    const clone=pristine.cloneNode(true) as Element;
    const priorRows=Array.isArray(b.revisions?.[key])?b.revisions[key]:[];
    const prior=number(priorRows.find((p:Obj)=>normalized(p.name)===normalized(row.name))?.value)??0;
    const now=number(row.value), delta=diff(now,prior);
    const values=[key==="drawings"?"Drawing":"Submittal",row.name,count(prior),count(now),change(delta),percentage(now,combined())];
    children(clone,"tc").forEach((cell,col)=>{
      const ps=children(cell,"p");set(ps[0]!,values[col],col===4?tone(delta):undefined);
      ps.slice(1).forEach(p=>cell.removeChild(p));
    });
    revisionTable.appendChild(clone);revisionCount++;
  }
  if(!revisionCount) {
    const p=children(children(pristine,"tc")[0]!,"p")[0]!.cloneNode(true) as Element;
    set(p,"No revision rows added");body.replaceChild(p,revisionTable);
  }
  para(23,`% of overall cum. = Current approved ÷ overall cumulative documents (Drawings total + Submittals total = ${count(combined())}).`);
  for(const [index,key] of ["outgoing","incoming"].entries()){
    const now=current("correspondence",key),prior=previous("correspondence",key);
    put(25,index+1,1,count(prior));put(25,index+1,2,count(now));put(25,index+1,3,change(diff(now,prior)),0,tone(diff(now,prior)));
  }
  const rejected=["drawing","materials","calculation","general"];
  [...rejected,"total"].forEach((key,index)=>{
    const now=key==="total"?sum(rejected.map(k=>current("rejectedSubmissions",k))):current("rejectedSubmissions",key);
    const prior=key==="total"?sum(rejected.map(k=>previous("rejectedSubmissions",k)))!:previous("rejectedSubmissions",key);
    const delta=diff(now,prior);
    put(27,index+1,1,count(prior));put(27,index+1,2,count(now));put(27,index+1,3,change(delta),0,tone(delta,"rejected"));
  });
  entities.forEach((entity,index)=>{
    put(32,0,index,count(pendingTotal(entity)),1);put(32,0,index,`${count(pendingBucket(entity,"over30"))} pending ≥ 31 days`,2);
    pendingStatuses.forEach((status,s)=>{
      const row=index*7+s+1, values=buckets.map(k=>current("pending",entity,status,k));
      values.forEach((v,col)=>{
        put(34,row,col+2,count(v));
        if(col===2) {
          const cell=cells(34,row)[4]!, pr=child(cell,"tcPr")!;
          let shading=child(pr,"shd");
          if(!shading){shading=doc.createElementNS(W,"w:shd");pr.appendChild(shading);}
          shading.setAttributeNS(W,"w:fill",v!==undefined&&v>0?"FCE4EC":"FFFFFF");
          const runPr=child(child(children(cell,"p")[0]!,"r"),"rPr")!;
          let bold=child(runPr,"b");
          if(v!==undefined&&v>0&&!bold){bold=doc.createElementNS(W,"w:b");runPr.appendChild(bold);}
          if(!(v!==undefined&&v>0)&&bold)runPr.removeChild(bold);
        }
      });
      put(34,row,5,count(sum(values)));
    });
    [...buckets,"total"].forEach((bucket,col)=>put(34,(index+1)*7,col+1,count(bucket==="total"?pendingTotal(entity):pendingBucket(entity,bucket))));
  });
  put(32,0,3,count(allOver30),1);put(32,0,3,`of ${count(allPending)} pending`,2);
  [...buckets,"total"].forEach((bucket,col)=>put(34,22,col+1,count(bucket==="total"?allPending:sum(entities.map(e=>pendingBucket(e,bucket))))));
  put(37,0,0,report.createdByName??report.submittedByName,1);put(37,0,0,UNMAPPED,2);
  let submitted=UNMAPPED;
  if(report.submittedAt&&report.organizationTimezone) {
    const date=new Date(report.submittedAt);
    if(Number.isFinite(date.getTime())) {
      const parts=new Intl.DateTimeFormat("en-GB",{timeZone:report.organizationTimezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
      const part=(key:string)=>parts.find(p=>p.type===key)?.value;
      submitted=`${part("day")}-${part("month")}-${part("year")}  ${part("hour")}:${part("minute")}`;
    }
  }
  put(37,0,1,submitted,1);put(37,0,1,`Time zone: ${value(report.organizationTimezone)}`,2);
  put(37,0,2,report.referenceNumber??report.id,1);
  // Do not issue the designer's sample-data/reviewer instructions.
  blocks.slice(38).filter(e=>e.localName!=="sectPr").forEach(e=>body.removeChild(e));
  return {body,project,date};
}
