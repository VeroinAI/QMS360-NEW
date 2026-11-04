import { describe,it,expect,afterEach } from "vitest";
import * as XLSX from "xlsx";
import { strFromU8,unzipSync } from "fflate";
import { DATE_FORMATS,setDateFormatResolver } from "@workspace/spreadsheet-dates";
import { dailyHistoricalFields,dailyGet,dailySet,zeroDailyOpening,validateDailyOpening,assertDailyOpeningDate,getDailyOpening } from "./qaqc-daily-historical";
import { dailyColumns,dailySheet,dailyHistoricalWorkbook,parseDailyHistoricalWorkbook } from "./qaqc-daily-historical-excel";

const catalogue=[{id:"11111111-1111-4111-8111-111111111111",name:"Project A",code:"A",label:"Project A"},
  {id:"22222222-2222-4222-8222-222222222222",name:"Project B",code:"B",label:"Project B"}];
function workbook(edit?:(sheet:XLSX.WorkSheet)=>void){
  const bytes=dailyHistoricalWorkbook(catalogue,"2026-09-19"),wb=XLSX.read(bytes);
  const sheet=wb.Sheets[dailySheet]!;
  sheet.C3={t:"s",v:"First go-live setup"};sheet.C4={t:"s",v:"Second go-live setup"};edit?.(sheet);
  return XLSX.write(wb,{type:"buffer",bookType:"xlsx"}).toString("base64");
}
afterEach(()=>setDateFormatResolver(()=>"DD/MM/YYYY"));
describe("Daily opening source snapshots",()=>{
  it("covers all 111 numeric counts plus arbitrary drawing and submittal revisions without importing derived values",()=>{
    expect(dailyHistoricalFields).toHaveLength(111);
    const data=zeroDailyOpening();
    dailyHistoricalFields.forEach((field,index)=>dailySet(data,field.key,index));
    data.revisions={drawings:[{name:"0",value:1}],submittals:[{name:"A",value:2}]};
    expect(validateDailyOpening(data)).toEqual(data);
    expect(dailyGet(data,"pending.Supplier.E.over30")).toBe(110);
    expect(getDailyOpening({qaqcDailyHistoricalSetup:{goLiveDate:"2026-09-19",data}})?.data).toEqual(data);
  });
  it.each([-1,0.25,"1",null,undefined,Number.MAX_SAFE_INTEGER+1])("rejects non-count opening value %s",value=>{
    const data=zeroDailyOpening();dailySet(data,"correspondence.incoming",value);
    expect(()=>validateDailyOpening(data)).toThrow();
  });
  it("rejects duplicate revisions and invented calculated fields",()=>{
    const data=zeroDailyOpening();data.revisions.drawings=[{name:"A",value:1},{name:" a ",value:2}];
    expect(()=>validateDailyOpening(data)).toThrow(/unique/);
    data.revisions.drawings=[];data.computed={total:100};
    expect(()=>validateDailyOpening(data)).toThrow(/Unknown/);
  });
  it("blocks reports before go-live and allows the date or later",()=>{
    expect(()=>assertDailyOpeningDate("2026-09-19","2026-09-18")).toThrow(/starts/);
    expect(()=>assertDailyOpeningDate("2026-09-19","2026-09-19")).not.toThrow();
    expect(()=>assertDailyOpeningDate("2026-09-19","2026-10-01")).not.toThrow();
  });
});
describe("Daily multi-project Excel",()=>{
  it("has a stop-validation Project Master dropdown, no project IDs/codes or version input, and two projects per file",()=>{
    const files=unzipSync(dailyHistoricalWorkbook(catalogue,"2026-09-19"));
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain('errorStyle="stop"');
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain("DailyHistoricalProjects");
    expect(dailyColumns).not.toContain("Version");expect(dailyColumns).not.toContain("Project ID");
    const preview=parseDailyHistoricalWorkbook(workbook(),catalogue);
    expect(preview.valid).toBe(true);expect(preview.rows.map(row=>row.projectId)).toEqual(catalogue.map(p=>p.id));
  });
  it.each(DATE_FORMATS)("round trips native dates and typed dates in organization format %s",format=>{
    setDateFormatResolver(()=>format);
    let result=parseDailyHistoricalWorkbook(workbook(),catalogue);
    expect(result.valid).toBe(true);expect(result.rows[0].goLiveDate).toBe("2026-09-19");
    const date=format==="MM/DD/YYYY"?"09/19/2026":format==="MM-DD-YYYY"?"09-19-2026":
      format==="YYYY-MM-DD"?"2026-09-19":format==="DD-MM-YYYY"?"19-09-2026":"19/09/2026";
    result=parseDailyHistoricalWorkbook(workbook(sheet=>{sheet.B3={t:"s",v:date};}),catalogue);
    expect(result.valid).toBe(true);expect(result.rows[0].goLiveDate).toBe("2026-09-19");
  });
  it("preserves revision counts with human-readable semicolon pairs",()=>{
    const parsed=parseDailyHistoricalWorkbook(workbook(sheet=>{
      sheet[XLSX.utils.encode_cell({r:2,c:dailyColumns.length-2})]={t:"s",v:"0=25; 1=10"};
    }),catalogue);
    expect(parsed.valid).toBe(true);
    expect(parsed.rows[0].data.revisions.drawings).toEqual([{name:"0",value:25},{name:"1",value:10}]);
  });
  it("rejects an unauthorized Project Master label and points to its actual row",()=>{
    const result=parseDailyHistoricalWorkbook(workbook(sheet=>{sheet.A4={t:"s",v:"Unknown project"};}),catalogue);
    expect(result.valid).toBe(false);expect(result.errors[0]).toContain("Row 4");
  });
  it("rejects repeated projects, formulas, incomplete counts and changed headers",()=>{
    expect(parseDailyHistoricalWorkbook(workbook(s=>{s.A4={t:"s",v:"Project A"};}),catalogue).errors.join()).toMatch(/more than once/);
    expect(()=>parseDailyHistoricalWorkbook(workbook(s=>{s.D3={t:"n",v:2,f:"1+1"};}),catalogue)).toThrow(/formulas/);
    expect(parseDailyHistoricalWorkbook(workbook(s=>{s.D3={t:"s",v:""};}),catalogue).valid).toBe(false);
    expect(()=>parseDailyHistoricalWorkbook(workbook(s=>{s.D2={t:"s",v:"changed"};}),catalogue)).toThrow(/columns changed/);
  });
});
