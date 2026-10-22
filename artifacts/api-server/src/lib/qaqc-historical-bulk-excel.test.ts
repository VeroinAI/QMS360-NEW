import { describe,it,expect,afterEach } from "vitest";
import { unzipSync,strFromU8 } from "fflate";
import { DATE_FORMATS,setDateFormatResolver,formatSpreadsheetDate } from "@workspace/spreadsheet-dates";
import { historicalProjectCatalogue } from "./qaqc-historical-projects";
import * as XLSX from "xlsx";
import { historicalBulkWorkbook,parseHistoricalBulkWorkbook,historicalWorkbook,historicalBulkColumns } from "./qaqc-historical-excel";
import { historicalFields,historicalBatchInput,type HistoricalInput } from "./qaqc-historical-balances";
const entries=()=>["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"].map((projectId,i)=>({
  projectCode:`P${i+1}`,projectName:`Project ${i+1}`,status:"Ready for editing",
  input:{projectId,period:"2026-10-01",version:0,reason:"Verified balances for project go-live",
    balances:Object.fromEntries(historicalFields.map(f=>[f.key,f.unit==="hours"?12.75:f.key.endsWith("Closed")?70:100]))} satisfies HistoricalInput,
}));
const catalogue=()=>historicalProjectCatalogue(entries().map(e=>({id:e.input.projectId,name:e.projectName,code:e.projectCode})));
const mutate=(fn:(s:XLSX.WorkSheet)=>void)=>{
  const wb=XLSX.read(historicalBulkWorkbook(entries(),catalogue()),{type:"buffer"});fn(wb.Sheets["Opening balances"]!);
  return (XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer).toString("base64");
};
describe("Multi-project historical Excel",()=>{
  afterEach(()=>setDateFormatResolver(()=>"DD/MM/YYYY"));
  it("places each project in one row with all 14 source balances in columns",()=>{
    const bytes=historicalBulkWorkbook(entries(),catalogue());
    const wb=XLSX.read(bytes,{type:"buffer"}),sheet=wb.Sheets["Opening balances"]!;
    const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1});
    expect(rows).toHaveLength(4);expect(rows[1]).toEqual(historicalBulkColumns);
    expect(rows[2]![0]).toBe("Project 1");expect(rows[3]![0]).toBe("Project 2");
    expect(rows[1]).not.toContain("Project ID");expect(rows[1]).not.toContain("Project Code");expect(rows[1]).not.toContain("Version");
    const parsed=parseHistoricalBulkWorkbook(bytes.toString("base64"),"2026-10-01",catalogue());
    expect(parsed.map(p=>{const {rowNumber,...input}=p.input;return input;})).toEqual(entries().map(e=>e.input));
    expect(parsed.map(p=>p.rowNumber)).toEqual([3,4]);
  });
  it("accepts existing single-project workbooks without changing their original fields",()=>{
    const input=entries()[0]!.input;
    expect(parseHistoricalBulkWorkbook(historicalWorkbook(input,"Project 1").toString("base64"),input.period)[0]!.input).toEqual(input);
  });
  it.each(["blank","text","negative","fractional","closed","formula","duplicate","period","headers","reason","name","extra-columns"])("rejects %s and identifies the Excel row where appropriate",kind=>{
    const encoded=mutate(sheet=>{
      if(kind==="blank")delete sheet.E3;
      if(kind==="text")sheet.E3={t:"s",v:"100"};
      if(kind==="negative")sheet.E3={t:"n",v:-1};
      if(kind==="fractional")sheet.E3={t:"n",v:1.5};
      if(kind==="closed")sheet.F3={t:"n",v:200};
      if(kind==="formula")sheet.E3={t:"n",v:100,f:"1+99"};
      if(kind==="duplicate")sheet.A4={...sheet.A3!};
      if(kind==="period")sheet.B4={t:"s",v:"2026-11-01"};
      if(kind==="headers")sheet.E2={t:"s",v:"Changed"};
      if(kind==="reason")sheet.C4={t:"s",v:"short"};
      if(kind==="name")sheet.A4={t:"s",v:"Unregistered project"};
      if(kind==="extra-columns"){sheet.S3={t:"n",v:1};sheet["!ref"]="A1:S4";}
    });
    expect(()=>parseHistoricalBulkWorkbook(encoded,"2026-10-01",catalogue())).toThrow();
    if(["blank","text","negative","fractional","closed","reason","name"].includes(kind))
      expect(()=>parseHistoricalBulkWorkbook(encoded,"2026-10-01",catalogue())).toThrow(/Row [34]/);
  });
  it("allows deleting unused project rows and blank separator rows",()=>{
    const encoded=mutate(sheet=>{for(let col=0;col<historicalBulkColumns.length;col++)delete sheet[XLSX.utils.encode_cell({r:3,c:col})];});
    expect(parseHistoricalBulkWorkbook(encoded,"2026-10-01",catalogue())).toHaveLength(1);
  });
  it("rejects empty batches and mixed project periods at the apply boundary",()=>{
    expect(historicalBatchInput.safeParse({period:"2026-10-01",items:[]}).success).toBe(false);
    const items=entries().map(e=>e.input);items[1]!.period="2026-11-01";
    expect(historicalBatchInput.safeParse({period:"2026-10-01",items}).success).toBe(false);
  });
  it("writes a real Excel stop-validation dropdown backed by a hidden named Project Master range",()=>{
    const bytes=historicalBulkWorkbook(entries(),catalogue()),zip=unzipSync(bytes);
    expect(strFromU8(zip["xl/worksheets/sheet1.xml"]!)).toContain('type="list" errorStyle="stop"');
    expect(strFromU8(zip["xl/worksheets/sheet1.xml"]!)).toContain('sqref="A3:A502"');
    expect(strFromU8(zip["xl/worksheets/sheet1.xml"]!)).toContain('<formula1>HistoricalProjects</formula1>');
    const wb=XLSX.read(bytes,{type:"buffer"});
    expect(wb.Workbook?.Names?.[0]?.Name).toBe("HistoricalProjects");
    expect(wb.Workbook?.Sheets?.find(s=>s.name==="Project Master")?.Hidden).toBe(1);
    expect(Object.values(zip).map(bytes=>strFromU8(bytes)).join("")).not.toContain(entries()[0]!.input.projectId);
  });
  it.each(DATE_FORMATS)("round-trips real native Excel dates using organization format %s",format=>{
    setDateFormatResolver(()=>format);
    const bytes=historicalBulkWorkbook(entries(),catalogue());
    const wb=XLSX.read(bytes,{type:"buffer",cellNF:true});
    expect(wb.Sheets["Opening balances"]!.B3.t).toBe("n");
    expect(wb.Sheets["Opening balances"]!.B3.z).toBe(format.toLowerCase());
    expect(wb.Sheets["Opening balances"]!.B2.v).toBe(`Reporting period (${format})`);
    setDateFormatResolver(()=>"MM/DD/YYYY");
    expect(parseHistoricalBulkWorkbook(bytes.toString("base64"),"2026-10-01",catalogue())[0]!.input.period).toBe("2026-10-01");
    wb.Sheets["Opening balances"]!.B3={t:"s",v:formatSpreadsheetDate("2026-10-01",format)};
    const text=XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer;
    expect(parseHistoricalBulkWorkbook(text.toString("base64"),"2026-10-01",catalogue())[0]!.input.period).toBe("2026-10-01");
  });
  it("rejects pasted project IDs, stale names and unauthorized master selections",()=>{
    for(const value of [entries()[0]!.input.projectId,"Renamed project","Project 2"]){
      const encoded=mutate(s=>{s.A3={t:"s",v:value};});
      expect(()=>parseHistoricalBulkWorkbook(encoded,"2026-10-01",catalogue().slice(0,1))).toThrow(/A3/);
    }
  });
  it("disambiguates duplicate master names without taking an ID or code field from Excel",()=>{
    const master=historicalProjectCatalogue([{id:"one",name:"Same",code:"A"},{id:"two",name:"Same",code:"B"}]);
    expect(master.map(p=>p.label)).toEqual(["Same (A)","Same (B)"]);
  });
  it("accepts existing version-2 files while resolving every row through current server validation",()=>{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      ["QMS360 Historical Balances",2],
      ["Project Code","Project Name","Project ID","Reporting period (YYYY-MM-01)","Version","Correction reason","Setup status (information only)",...historicalFields.map(f=>`${f.label} (${f.unit})`)],
      ...entries().map(e=>[e.projectCode,e.projectName,e.input.projectId,e.input.period,0,e.input.reason,"Ready",...historicalFields.map(f=>e.input.balances[f.key])]),
    ]),"Opening balances");
    const parsed=parseHistoricalBulkWorkbook((XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer).toString("base64"),"2026-10-01",catalogue());
    expect(parsed).toHaveLength(2);expect(parsed[0]!.input.rowNumber).toBe(3);
  });
  it("honors the workbook's native 1904 date system",()=>{
    const wb=XLSX.read(historicalBulkWorkbook(entries(),catalogue()),{type:"buffer"});
    wb.Workbook={...wb.Workbook,WBProps:{...wb.Workbook?.WBProps,date1904:true}};
    for(const cell of ["B3","B4"])wb.Sheets["Opening balances"]![cell].v-=1462;
    const encoded=(XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer).toString("base64");
    expect(parseHistoricalBulkWorkbook(encoded,"2026-10-01",catalogue())[0]!.input.period).toBe("2026-10-01");
  });
});
