import * as XLSX from "xlsx";
import { inflateRawSync } from "node:zlib";
import { unzipSync,zipSync,strFromU8,strToU8 } from "fflate";
import { getDateFormat,getExcelDateNumberFormat,normalizeSpreadsheetDateHeader,parseSpreadsheetDate,detectSpreadsheetDateOptions } from "@workspace/spreadsheet-dates";
import type { HistoricalProject } from "./qaqc-historical-projects";
import { historicalFields, historicalInput, historicalBatchInput, type HistoricalInput } from "./qaqc-historical-balances";

/** Legacy v1 compatibility fixture only. New downloads must use historicalBulkWorkbook and organization-formatted native dates. */
export function historicalWorkbook(input:HistoricalInput,projectName:string) {
  const rows:unknown[][]=[
    ["QMS360 Historical Balances",1],
    ["Project ID",input.projectId],["Reporting period",input.period],
    ["Version",input.version],["Reason",input.reason],[],
    ["Field key","Historical opening balance","Value","Unit"],
    ...historicalFields.map(f=>[f.key,f.label,input.balances[f.key],f.unit]),
  ];
  const wb=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"]=[{wch:46},{wch:62},{wch:20},{wch:14}];
  XLSX.utils.book_append_sheet(wb,sheet,"Opening balances");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["Historical Balances / Go-live Setup"],["Project",projectName],
    ["Enter opening balances immediately BEFORE the reporting month, not current-month movements."],
    ["Edit Value cells and Reason only. Keep project, period, version and field keys unchanged."],
    ["All 14 values are required. Enter 0 explicitly when there is no historical balance."],
    ["Counts: non-negative whole numbers. Manhours: non-negative numbers."],
    ["Closed counts must not exceed issued counts. Rates, open counts and PQI are derived."],
    ["Upload validates and previews only. Confirm Apply in QMS360 to save."],
    ["If the version is stale, download a fresh template. Submitted history cannot be overwritten."],
  ]),"Instructions");
  return XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer;
}

function readWorkbook(fileBase64:string) {
  if(!fileBase64||fileBase64.length>2_800_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64))
    throw new Error("Upload an Excel .xlsx workbook no larger than 2 MB");
  const buffer=Buffer.from(fileBase64,"base64");
  if(buffer.length>2*1024*1024||buffer[0]!==0x50||buffer[1]!==0x4b) throw new Error("Upload a valid .xlsx workbook");
  // Bound decompression before passing the ZIP to SheetJS.
  let expanded=0,files=0;
  for(let i=Math.max(0,buffer.length-65557);i<=buffer.length-22;i++){
    if(buffer.readUInt32LE(i)!==0x06054b50)continue;
    const offset=buffer.readUInt32LE(i+16), entries=buffer.readUInt16LE(i+10);
    let pos=offset;
    if(entries>200)throw new Error("Workbook contains too many ZIP entries");
    for(let j=0;j<entries;j++){
      if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw new Error("Invalid workbook archive");
      const size=buffer.readUInt32LE(pos+24);
      expanded+=size;files++;
      if(expanded>15*1024*1024)throw new Error("Workbook is too large after decompression");
      const method=buffer.readUInt16LE(pos+10),compressedSize=buffer.readUInt32LE(pos+20),local=buffer.readUInt32LE(pos+42);
      if(buffer.readUInt16LE(pos+8)&1||![0,8].includes(method)||local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)
        throw new Error("Unsupported workbook archive");
      const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
      if(start+compressedSize>buffer.length)throw new Error("Invalid workbook archive");
      const packed=buffer.subarray(start,start+compressedSize);
      let actualSize:number;
      try{actualSize=method===0?packed.length:inflateRawSync(packed,{maxOutputLength:Math.max(1,size)}).length;}
      catch{throw new Error("Invalid or oversized workbook archive");}
      if(actualSize!==size)throw new Error("Invalid workbook decompression size");
      pos+=46+buffer.readUInt16LE(pos+28)+buffer.readUInt16LE(pos+30)+buffer.readUInt16LE(pos+32);
    }
    break;
  }
  if(!files||expanded>15*1024*1024)throw new Error("Workbook is too large after decompression");
  const wb=XLSX.read(buffer,{type:"buffer",cellFormula:true,sheetRows:503});
  const sheet=wb.Sheets["Opening balances"];
  // Bound the declared width before sheet_to_json allocates a dense row matrix.
   if(sheet&&XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1").e.c>=legacyHistoricalBulkColumns.length)
    throw new Error("Unexpected extra columns. Keep the downloaded template headers unchanged");
  return wb;
}

export function parseHistoricalWorkbook(fileBase64:string,projectId:string,period:string):HistoricalInput {
  const wb=readWorkbook(fileBase64);
  const sheet=wb.Sheets["Opening balances"];
  if(!sheet)throw new Error('Missing "Opening balances" sheet. Use the downloaded template');
  if(XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1").e.r>=100)throw new Error("Historical template must contain fewer than 100 rows");
  if(Object.values(sheet).some((cell:any)=>cell&&typeof cell==="object"&&cell.f))throw new Error("Use numeric values, not Excel formulas");
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,blankrows:true});
  if(rows[0]?.[0]!=="QMS360 Historical Balances"||rows[0]?.[1]!==1)throw new Error("Unsupported historical template");
   if(rows[1]?.[1]!==projectId||parseSpreadsheetDate(rows[2]?.[1],{date1904:!!wb.Workbook?.WBProps?.date1904})!==period)throw new Error("Workbook project/month does not match your selection");
  const balances:Record<string,number>={};
  const valid=new Set(historicalFields.map(f=>f.key));
  for(const row of rows.slice(7)){
    if(row.every(v=>v===null||v===""))continue;
    const key=String(row[0]??"");
    if(!valid.has(key as never)||Object.hasOwn(balances,key))throw new Error(`Unknown or duplicate historical field: ${key}`);
    if(typeof row[2]!=="number")throw new Error(`${key}: enter a numeric balance; blanks are not zero`);
    balances[key]=row[2];
  }
  return historicalInput.parse({projectId,period,version:rows[3]?.[1],reason:rows[4]?.[1],balances});
}

const legacyHistoricalBulkColumns=[
  "Project Code","Project Name","Project ID","Reporting period (YYYY-MM-01)","Version","Correction reason","Setup status (information only)",
  ...historicalFields.map(f=>`${f.label} (${f.unit})`),
];
export const historicalBulkColumns=[
  "Project","Reporting period (DD/MM/YYYY)","Opening balance reason","Load status (information only)",
  ...historicalFields.map(f=>`${f.label} (${f.unit})`),
];
export function historicalBulkWorkbook(entries:{input:HistoricalInput;projectCode:string;projectName:string;status:string}[],catalogue:HistoricalProject[]) {
  if(!entries.length||entries.length>500)throw new Error("A template must contain between 1 and 500 projects");
   if(!catalogue.length||entries.some(e=>!catalogue.some(p=>p.id===e.input.projectId)))throw new Error("Every template project must exist in the authorized Project Master");
  const wb=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
     ["QMS360 Historical Balances",3,"Date format",getDateFormat()],
     historicalBulkColumns.map(normalize=>normalize.replace("DD/MM/YYYY",getDateFormat())),
    ...entries.map(({input,projectCode,projectName,status})=>[
       catalogue.find(p=>p.id===input.projectId)!.label,new Date(`${input.period}T00:00:00.000Z`),input.reason,status,
      ...historicalFields.map(f=>input.balances[f.key]),
    ]),
  ]);
   sheet["!cols"]=[{wch:42},{wch:26},{wch:48},{wch:60},...historicalFields.map(()=>({wch:30}))];
   sheet["!rows"]=[{hidden:true}];
   entries.forEach((_,i)=>{sheet[`B${i+3}`].z=getExcelDateNumberFormat();});
  sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:1,c:0},e:{r:entries.length+1,c:historicalBulkColumns.length-1}})};
  XLSX.utils.book_append_sheet(wb,sheet,"Opening balances");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["QMS360 Multi-project Historical Balances"],
    ["One project per row. All rows must use the selected reporting month."],
    ["Enter opening balances immediately BEFORE that month, not current-month movements."],
     ["Pick Project from the Project Master dropdown. Paste/manual entries are also validated by QMS360; unknown or unauthorized projects are rejected."],
     ["There are no Project ID, Project Code or Version fields to enter. QMS360 resolves the selection internally."],
     ["For duplicate project names only, the dropdown adds the master code in parentheses to distinguish them."],
     [`Dates use the QMS360 organization setting: ${getDateFormat()}. The reporting period is the first day of the selected month.`],
     ["Edit the 14 numeric balance columns and Opening balance reason. Keep headers unchanged."],
     ["Delete entire rows for projects you do not want to load, including already-loaded, locked or read-only projects."],
    ["Each included row needs a correction reason of 10–2000 characters. All 14 balances are required; enter 0 explicitly."],
    ["Counts must be non-negative whole numbers; manhours may be decimals. Closed must not exceed issued. Do not use formulas."],
     ["Load status is informational only; current Project Master, permissions, prior loads and submitted history are checked again at upload and apply."],
    ["Upload previews every included project. Confirm Apply to save ALL rows together; if any row fails, NONE are saved."],
     ["Only ONE opening balance load is allowed per project, across ALL reporting months. A previously loaded project cannot be loaded again, even for a different month."],
     ["Any invalid or duplicate row fails the complete file. Error messages identify the Opening balances sheet and Excel row."],
    ["Maximum 500 project rows and 2 MB. Existing version-1 single-project templates remain accepted."],
    [],["Balance column","Unit","Field key"],
     ...historicalFields.map((f,i)=>[historicalBulkColumns[i+4],f.unit,f.key]),
  ]),"Instructions");
   const master=XLSX.utils.aoa_to_sheet([["Project"],...catalogue.map(p=>[p.label])]);
   XLSX.utils.book_append_sheet(wb,master,"Project Master");
   wb.Workbook={...wb.Workbook,Sheets:wb.SheetNames.map(name=>({name,Hidden:name==="Project Master"?1:0})),
     Names:[{Name:"HistoricalProjects",Ref:`'Project Master'!$A$2:$A$${catalogue.length+1}`}]};
   const files=unzipSync(XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer);
   const validation='<dataValidations count="1"><dataValidation type="list" errorStyle="stop" allowBlank="1" showErrorMessage="1" showInputMessage="1" errorTitle="Invalid project" error="Select a valid project from the Project Master dropdown." promptTitle="Project Master" prompt="Select the project for this opening load." sqref="A3:A502"><formula1>HistoricalProjects</formula1></dataValidation></dataValidations>';
   const path="xl/worksheets/sheet1.xml";
   files[path]=strToU8(strFromU8(files[path]!).replace(/(<ignoredErrors\b|<pageMargins\b|<\/worksheet>)/,validation+"$1"));
   return Buffer.from(zipSync(files,{level:6}));
}

export function parseHistoricalBulkWorkbook(fileBase64:string,period:string,catalogue:HistoricalProject[]=[]) {
  const wb=readWorkbook(fileBase64),sheet=wb.Sheets["Opening balances"];
  if(!sheet)throw new Error('Missing "Opening balances" sheet. Use the downloaded template');
  if(XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1").e.r>501)throw new Error("A workbook may contain at most 500 project rows");
   for(const [address,cell] of Object.entries(sheet))if((cell as XLSX.CellObject)?.f)
     throw new Error(`Opening balances! ${address}: use values, not Excel formulas. The entire file was rejected.`);
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,blankrows:true});
  if(rows[0]?.[0]!=="QMS360 Historical Balances")throw new Error("Unsupported historical template");
  if(rows[0]?.[1]===1){
    const input=parseHistoricalWorkbook(fileBase64,String(rows[1]?.[1]??""),period);
    return [{input,rowNumber:2,projectCode:undefined,projectName:undefined}];
  }
   const modern=rows[0]?.[1]===3,columns=modern?historicalBulkColumns:legacyHistoricalBulkColumns;
   if(!modern&&rows[0]?.[1]!==2)throw new Error("Unsupported historical template version");
   if(rows[1]?.length!==columns.length||columns.some((label,i)=>normalizeSpreadsheetDateHeader(rows[1]?.[i])!==normalizeSpreadsheetDateHeader(label)))
    throw new Error("The workbook columns changed. Download a fresh multi-project template and keep its headers unchanged");
  const entries: {input:HistoricalInput;rowNumber:number;projectCode:string|undefined;projectName:string|undefined}[]=[];
  const errors:string[]=[];
   const dateOptions=detectSpreadsheetDateOptions(rows.slice(0,2).flat(),{date1904:!!wb.Workbook?.WBProps?.date1904});
  rows.slice(2).forEach((row,index)=>{
    if(row.every(v=>v===null||v===""))return;
    const rowNumber=index+3;
     if(row.length>columns.length){errors.push(`Opening balances! Row ${rowNumber}: unexpected extra columns`);return;}
     const project=modern?catalogue.find(p=>p.label===row[0]):undefined;
     if(modern&&!project){errors.push(`Opening balances! Row ${rowNumber}, A${rowNumber}: "${String(row[0]??"")}" is not a valid authorized Project Master selection. Select from a fresh template dropdown.`);return;}
     const balances=Object.fromEntries(historicalFields.map((f,i)=>[f.key,row[i+(modern?4:7)]]));
     const result=historicalInput.safeParse({projectId:modern?project!.id:row[2],period:parseSpreadsheetDate(row[modern?1:3],dateOptions),
       version:modern?0:row[4],reason:row[modern?2:5],balances,rowNumber});
     if(!result.success){errors.push(`Opening balances! Row ${rowNumber} (${String(row[0]??"unknown project")}): ${result.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}`);return;}
     if(!modern&&(typeof row[0]!=="string"||!row[0].trim()||typeof row[1]!=="string"||!row[1].trim())){
      errors.push(`Row ${rowNumber}: keep the project code and name from the template`);return;
    }
     entries.push({input:result.data,rowNumber,projectCode:modern?undefined:String(row[0]),projectName:modern?undefined:String(row[1])});
  });
  if(errors.length)throw new Error(errors.slice(0,30).join("\n"));
  const batch=historicalBatchInput.safeParse({period,items:entries.map(e=>e.input)});
   if(!batch.success)throw new Error(batch.error.issues.map(i=>`${typeof i.path[1]==="number"?`Opening balances! Row ${entries[i.path[1]]?.rowNumber??i.path[1]+3}`:"Workbook"}: ${i.message}`).join("; "));
  return entries;
}
