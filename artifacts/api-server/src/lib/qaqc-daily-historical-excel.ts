import * as XLSX from "xlsx";
import { unzipSync,zipSync,strFromU8,strToU8 } from "fflate";
import { getDateFormat,getExcelDateNumberFormat,parseSpreadsheetDate,isDateFormat } from "@workspace/spreadsheet-dates";
import { readWorkbook } from "./qaqc-historical-excel";
import type { HistoricalProject } from "./qaqc-historical-projects";
import { dailyHistoricalFields,dailyGet,dailySet,zeroDailyOpening,validateDailyOpening,dailyOpeningInput } from "./qaqc-daily-historical";

export const dailySheet="Daily opening balances";
export const dailyColumns=["Project","Go-live date","Load reason",...dailyHistoricalFields.map(f=>f.label),"Drawing approved revisions","Submittal approved revisions"];
export function dailyHistoricalWorkbook(catalogue:HistoricalProject[],date:string) {
  if(!catalogue.length)throw new Error("No eligible authorized projects remain for a daily opening load.");
  if(catalogue.length>500)throw new Error("Select at most 500 eligible projects per template.");
  const wb=XLSX.utils.book_new(),zero=zeroDailyOpening();
  const sheet=XLSX.utils.aoa_to_sheet([
    ["QMS360 Daily Opening Balances",1,"Date format",getDateFormat()],
    dailyColumns.map(label=>label==="Go-live date"?`${label} (${getDateFormat()})`:label),
    ...catalogue.map(project=>[project.label,new Date(`${date}T00:00:00Z`),"",...dailyHistoricalFields.map(f=>dailyGet(zero,f.key)),"",""]),
  ]);
  sheet["!cols"]=dailyColumns.map((_,i)=>({wch:i===0?42:i===2?48:28}));sheet["!rows"]=[{hidden:true}];
  catalogue.forEach((_,index)=>{sheet[`B${index+3}`].z=getExcelDateNumberFormat();});
  XLSX.utils.book_append_sheet(wb,sheet,dailySheet);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Daily Submission / Go-live opening balances"],
    ["One project per row. Choose Project from its dropdown. Remove rows you do not want to load."],
    ["Go-live date is the FIRST Daily Submission date. Values are the cumulative snapshot through the PREVIOUS day."],
    ["Complete setup BEFORE creating any Daily Submission for the project, including drafts. A project can be loaded only once across all dates."],
    ["All numeric columns are required non-negative whole counts. Enter 0 explicitly if none. Do not enter totals, percentages or formulas."],
    ["Approved revision cells: revision=count pairs separated by semicolons. Example: 0=25; 1=10. Leave blank if no approved revisions."],
    ["Revision names must be unique per document category. Other legacy document types CVs, PQP and IFR are independent, not RFIs."],
    ["Enter a load reason for each project. Preview is read-only. Confirm Apply in QMS360 to save the complete file."],
    ["One invalid, unauthorized, previously loaded or blocked project causes the complete file to fail; no partial saves."],
    ["Dates follow the QMS360 organization format shown in the header. Keep the headers unchanged."],
  ]),"Instructions");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Project"],...catalogue.map(p=>[p.label])]),"Project Master");
  wb.Workbook={Sheets:wb.SheetNames.map(name=>({name,Hidden:name==="Project Master"?1:0})),
    Names:[{Name:"DailyHistoricalProjects",Ref:`'Project Master'!$A$2:$A$${catalogue.length+1}`}]};
  const files=unzipSync(XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer),path="xl/worksheets/sheet1.xml";
  const validation='<dataValidations count="1"><dataValidation type="list" errorStyle="stop" allowBlank="1" showErrorMessage="1" errorTitle="Invalid project" error="Choose a valid Project Master dropdown entry." sqref="A3:A502"><formula1>DailyHistoricalProjects</formula1></dataValidation></dataValidations>';
  files[path]=strToU8(strFromU8(files[path]!).replace(/(<ignoredErrors\b|<pageMargins\b|<\/worksheet>)/,validation+"$1"));
  return Buffer.from(zipSync(files,{level:6}));
}
function revisions(value:unknown) {
  if(value==null||String(value).trim()==="")return [];
  return String(value).split(";").map(pair=>{
    const match=/^\s*([^=;]{1,100}?)\s*=\s*(\d+)\s*$/.exec(pair);
    if(!match)throw new Error('Use revision=count pairs, e.g. "0=25; 1=10"');
    return {name:match[1]!.trim(),value:Number(match[2])};
  });
}
export function parseDailyHistoricalWorkbook(base64:string,catalogue:HistoricalProject[]) {
  const wb=readWorkbook(base64,dailySheet,dailyColumns.length),sheet=wb.Sheets[dailySheet];
  if(!sheet)throw new Error(`Missing "${dailySheet}" sheet. Download the Daily opening template.`);
  const range=XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1");
  if(range.e.r>501)throw new Error("Maximum 500 project rows are allowed.");
  if(Object.values(sheet).some((cell:any)=>cell&&typeof cell==="object"&&cell.f))throw new Error("Use values, not Excel formulas.");
  const rows=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,defval:null,blankrows:true});
  if(rows[0]?.[0]!=="QMS360 Daily Opening Balances"||rows[0]?.[1]!==1)throw new Error("Unsupported Daily opening template.");
  if(rows[1]?.length!==dailyColumns.length||dailyColumns.some((label,i)=>i===1
    ? !String(rows[1]?.[i]).startsWith("Go-live date (")
    : rows[1]?.[i]!==label))throw new Error("The template columns changed. Download a fresh Daily opening template.");
  const errors:string[]=[],items:any[]=[],names=new Set<string>();
  for(let index=2;index<rows.length;index++){
    const row=rows[index]!;
    if(row.every(value=>value==null||String(value).trim()===""))continue;
    const rowNumber=index+1,where=`${dailySheet}! Row ${rowNumber}`;
    try{
      const label=String(row[0]??"").trim(),project=catalogue.find(p=>p.label===label);
      if(!project)throw new Error(`Project "${label}" is not a current authorized Project Master selection.`);
      if(names.has(project.id))throw new Error(`Project "${label}" appears more than once in this file.`);
      names.add(project.id);
      const format=String(rows[0]?.[3]??"");
      if(!isDateFormat(format))throw new Error("Unsupported date format in the workbook.");
      if(String(rows[1]?.[1])!==`Go-live date (${format})`)throw new Error("Go-live date format header does not match the downloaded template.");
      const goLiveDate=parseSpreadsheetDate(row[1],{dateFormat:format,date1904:!!wb.Workbook?.WBProps?.date1904});
      const data=zeroDailyOpening();
      for(const [i,field] of dailyHistoricalFields.entries())dailySet(data,field.key,row[i+3]);
      data.revisions.drawings=revisions(row[3+dailyHistoricalFields.length]);
      data.revisions.submittals=revisions(row[4+dailyHistoricalFields.length]);
      const input=dailyOpeningInput.parse({projectId:project.id,goLiveDate,reason:row[2],data:validateDailyOpening(data),rowNumber});
      items.push({...input,projectName:project.name,errors:[]});
    }catch(error){errors.push(`${where}: ${error instanceof Error?error.message:"Invalid opening values"}`);}
  }
  if(!items.length&&!errors.length)errors.push("The workbook contains no project data rows.");
  return {rows:items,errors,fields:dailyHistoricalFields,valid:errors.length===0};
}
