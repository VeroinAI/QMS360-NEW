import { describe,it,expect } from "vitest";
import * as XLSX from "xlsx";
import { historicalBulkWorkbook,parseHistoricalBulkWorkbook,historicalWorkbook,historicalBulkColumns } from "./qaqc-historical-excel";
import { historicalFields,historicalBatchInput,type HistoricalInput } from "./qaqc-historical-balances";
const entries=()=>["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"].map((projectId,i)=>({
  projectCode:`P${i+1}`,projectName:`Project ${i+1}`,status:"Ready for editing",
  input:{projectId,period:"2026-10-01",version:i,reason:"Verified balances for project go-live",
    balances:Object.fromEntries(historicalFields.map(f=>[f.key,f.unit==="hours"?12.75:f.key.endsWith("Closed")?70:100]))} satisfies HistoricalInput,
}));
const mutate=(fn:(s:XLSX.WorkSheet)=>void)=>{
  const wb=XLSX.read(historicalBulkWorkbook(entries()),{type:"buffer"});fn(wb.Sheets["Opening balances"]!);
  return (XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer).toString("base64");
};
describe("Multi-project historical Excel",()=>{
  it("places each project in one row with all 14 source balances in columns",()=>{
    const bytes=historicalBulkWorkbook(entries());
    const wb=XLSX.read(bytes,{type:"buffer"}),sheet=wb.Sheets["Opening balances"]!;
    const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1});
    expect(rows).toHaveLength(4);expect(rows[1]).toEqual(historicalBulkColumns);
    expect(rows[2]![0]).toBe("P1");expect(rows[3]![0]).toBe("P2");
    const parsed=parseHistoricalBulkWorkbook(bytes.toString("base64"),"2026-10-01");
    expect(parsed.map(p=>p.input)).toEqual(entries().map(e=>e.input));
    expect(parsed.map(p=>p.rowNumber)).toEqual([3,4]);
  });
  it("accepts existing single-project workbooks without changing their original fields",()=>{
    const input=entries()[0]!.input;
    expect(parseHistoricalBulkWorkbook(historicalWorkbook(input,"Project 1").toString("base64"),input.period)[0]!.input).toEqual(input);
  });
  it.each(["blank","text","negative","fractional","closed","formula","duplicate","period","headers","reason","version","name","extra-columns"])("rejects %s and identifies the Excel row where appropriate",kind=>{
    const encoded=mutate(sheet=>{
      if(kind==="blank")delete sheet.H3;
      if(kind==="text")sheet.H3={t:"s",v:"100"};
      if(kind==="negative")sheet.H3={t:"n",v:-1};
      if(kind==="fractional")sheet.H3={t:"n",v:1.5};
      if(kind==="closed")sheet.I3={t:"n",v:200};
      if(kind==="formula")sheet.H3={t:"n",v:100,f:"1+99"};
      if(kind==="duplicate")sheet.C4={...sheet.C3!};
      if(kind==="period")sheet.D4={t:"s",v:"2026-11-01"};
      if(kind==="headers")sheet.H2={t:"s",v:"Changed"};
      if(kind==="reason")sheet.F4={t:"s",v:"short"};
      if(kind==="version")sheet.E4={t:"n",v:-1};
      if(kind==="name")delete sheet.B4;
      if(kind==="extra-columns"){sheet.V3={t:"n",v:1};sheet["!ref"]="A1:V4";}
    });
    expect(()=>parseHistoricalBulkWorkbook(encoded,"2026-10-01")).toThrow();
    if(["blank","text","negative","fractional","closed","reason","version","name"].includes(kind))
      expect(()=>parseHistoricalBulkWorkbook(encoded,"2026-10-01")).toThrow(/Row [34]/);
  });
  it("allows deleting unused project rows and blank separator rows",()=>{
    const encoded=mutate(sheet=>{for(let col=0;col<historicalBulkColumns.length;col++)delete sheet[XLSX.utils.encode_cell({r:3,c:col})];});
    expect(parseHistoricalBulkWorkbook(encoded,"2026-10-01")).toHaveLength(1);
  });
  it("rejects empty batches and mixed project periods at the apply boundary",()=>{
    expect(historicalBatchInput.safeParse({period:"2026-10-01",items:[]}).success).toBe(false);
    const items=entries().map(e=>e.input);items[1]!.period="2026-11-01";
    expect(historicalBatchInput.safeParse({period:"2026-10-01",items}).success).toBe(false);
  });
});
