import { describe,it,expect } from "vitest";
import * as XLSX from "xlsx";
import { historicalFields,historicalInput,flattenHistorical,historicalBaseline,getHistoricalSetup,protectsHistoricalSnapshot,type HistoricalInput } from "./qaqc-historical-balances";
import { historicalWorkbook,parseHistoricalWorkbook } from "./qaqc-historical-excel";
import { calculateReport } from "./qaqc-reporting-model";
import { qaqcPermissionMatches } from "@workspace/field-controls";

const input=():HistoricalInput=>({projectId:"11111111-1111-4111-8111-111111111111",period:"2026-10-01",version:0,reason:"Verified project opening balances",
  balances:Object.fromEntries(historicalFields.map(f=>[f.key,f.key.endsWith("Closed")?70:f.unit==="hours"?123.5:100]))});
function editWorkbook(change:(sheet:XLSX.WorkSheet)=>void){
  const wb=XLSX.read(historicalWorkbook(input(),"Example"),{type:"buffer"});change(wb.Sheets["Opening balances"]!);
  return (XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer).toString("base64");
}
describe("Monthly historical source balances",()=>{
  it("covers all 14 baseline inputs, preserves decimals and round-trips nested snapshots",()=>{
    const i=input();
    expect(historicalFields).toHaveLength(14);
    expect(historicalInput.parse(i)).toEqual(i);
    expect(flattenHistorical(historicalBaseline(i.balances))).toEqual(i.balances);
    const computed=calculateReport("monthly",{metrics:{external_ncr:{issued:12,closed:5}}},historicalBaseline(i.balances)) as any;
    expect(computed.metrics.external_ncr).toMatchObject({previousIssued:100,previousClosed:70,accumulatedIssued:112,accumulatedClosed:75,open:37,previousAccumulatedRate:70});
    expect(computed.pqi.previous).toBe(70);
    expect(computed.qtbt.accumulatedManhours).toBe(123.5);
    expect(computed.training.accumulatedManhours).toBe(123.5);
  });
  it.each(["negative","fractional","missing","extra","closed","reason","period","version"])("rejects invalid %s without filling blanks",kind=>{
    const i=input();
    if(kind==="negative")i.balances["material.accumulatedIssued"]=-1;
    if(kind==="fractional")i.balances["training.accumulatedTrainingCount"]=1.2;
    if(kind==="missing")delete i.balances["qtbt.accumulatedManhours"];
    if(kind==="extra")i.balances["pqi.previous"]=90;
    if(kind==="closed")i.balances["metrics.rmi.accumulatedClosed"]=101;
    if(kind==="reason")i.reason="short";
    if(kind==="period")i.period="2026-10-12";
    if(kind==="version")i.version=-1;
    expect(historicalInput.safeParse(i).success).toBe(false);
  });
  it("protects submitted snapshots including sent-back reports with submission history",()=>{
    for(const state of ["submitted","approved"])expect(protectsHistoricalSnapshot({state,submittedAt:null})).toBe(true);
    expect(protectsHistoricalSnapshot({state:"sent_back",submittedAt:new Date()})).toBe(true);
    expect(protectsHistoricalSnapshot({state:"draft",submittedAt:null})).toBe(false);
  });
  it("applies a setup only to its selected reporting month",()=>{
    const setup={...input(),updatedAt:new Date().toISOString(),updatedById:"actor"};
    const metadata={qaqcReporting:{historicalBalances:{"2026-10-01":setup}}};
    expect(getHistoricalSetup(metadata,"2026-10-01")).toEqual(setup);
    expect(getHistoricalSetup(metadata,"2026-11-01")).toBeUndefined();
  });
  it("requires precise historical permissions rather than broad existing QA/QC grants",()=>{
    for(const op of ["view_all","create_edit","import","export"] as const){
      expect(qaqcPermissionMatches(`qaqc.historical_balances.${op}`,"historical_balances",op)).toBe(true);
      for(const key of [`qaqc.${op}`,op,`qaqc.monthly_reports.${op}`,"data_entry"])
        expect(qaqcPermissionMatches(key,"historical_balances",op)).toBe(false);
    }
  });
});
describe("Historical Excel uploads",()=>{
  it("round-trips all fields, selected project/month, version, reason and zeros",()=>{
    const i=input();i.balances["training.accumulatedTrainingCount"]=0;
    const bytes=historicalWorkbook(i,"Example");
    expect(parseHistoricalWorkbook(bytes.toString("base64"),i.projectId,i.period)).toEqual(i);
  });
  it.each(["blank","formula","text","duplicate","unknown","wrong-project","wrong-period"])("rejects %s workbook values",kind=>{
    const encoded=editWorkbook(sheet=>{
      if(kind==="blank")delete sheet.C8;
      if(kind==="formula")sheet.C8={t:"n",v:100,f:"SUM(50,50)"};
      if(kind==="text")sheet.C8={t:"s",v:"100"};
      if(kind==="duplicate")sheet.A9={t:"s",v:sheet.A8!.v};
      if(kind==="unknown")sheet.A8={t:"s",v:"unknown"};
      if(kind==="wrong-project")sheet.B2={t:"s",v:"other"};
      if(kind==="wrong-period")sheet.B3={t:"s",v:"2026-09-01"};
    });
    expect(()=>parseHistoricalWorkbook(encoded,input().projectId,input().period)).toThrow();
  });
  it("rejects corrupt and oversized uploads before parsing",()=>{
    expect(()=>parseHistoricalWorkbook("SGVsbG8=",input().projectId,input().period)).toThrow();
    expect(()=>parseHistoricalWorkbook("a".repeat(2_800_001),input().projectId,input().period)).toThrow();
  });
  it("supports compressed Excel workbooks with bounded decompression",()=>{
    const wb=XLSX.read(historicalWorkbook(input(),"Example"),{type:"buffer"});
    const bytes=XLSX.write(wb,{type:"buffer",bookType:"xlsx",compression:true}) as Buffer;
    expect(parseHistoricalWorkbook(bytes.toString("base64"),input().projectId,input().period)).toEqual(input());
  });
  it("rejects forged ZIP size metadata instead of trusting an undersized declaration",()=>{
    const bytes=historicalWorkbook(input(),"Example");
    const entry=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    expect(entry).toBeGreaterThan(0);
    bytes.writeUInt32LE(0,entry+24);
    expect(()=>parseHistoricalWorkbook(bytes.toString("base64"),input().projectId,input().period)).toThrow();
  });
});
