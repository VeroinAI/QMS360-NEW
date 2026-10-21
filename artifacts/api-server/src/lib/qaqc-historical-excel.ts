import * as XLSX from "xlsx";
import { inflateRawSync } from "node:zlib";
import { historicalFields, historicalInput, historicalBatchInput, type HistoricalInput } from "./qaqc-historical-balances";

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
  if(sheet&&XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1").e.c>=historicalBulkColumns.length)
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
  if(rows[1]?.[1]!==projectId||rows[2]?.[1]!==period)throw new Error("Workbook project/month does not match your selection");
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

export const historicalBulkColumns=[
  "Project Code","Project Name","Project ID","Reporting period (YYYY-MM-01)","Version","Correction reason","Setup status (information only)",
  ...historicalFields.map(f=>`${f.label} (${f.unit})`),
];
export function historicalBulkWorkbook(entries:{input:HistoricalInput;projectCode:string;projectName:string;status:string}[]) {
  if(!entries.length||entries.length>500)throw new Error("A template must contain between 1 and 500 projects");
  const wb=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ["QMS360 Historical Balances",2],
    historicalBulkColumns,
    ...entries.map(({input,projectCode,projectName,status})=>[
      projectCode,projectName,input.projectId,input.period,input.version,input.reason,status,
      ...historicalFields.map(f=>input.balances[f.key]),
    ]),
  ]);
  sheet["!cols"]=[{wch:22},{wch:34},{wch:38},{wch:23},{wch:10},{wch:48},{wch:36},...historicalFields.map(()=>({wch:30}))];
  sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:1,c:0},e:{r:entries.length+1,c:historicalBulkColumns.length-1}})};
  XLSX.utils.book_append_sheet(wb,sheet,"Opening balances");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["QMS360 Multi-project Historical Balances"],
    ["One project per row. All rows must use the selected reporting month."],
    ["Enter opening balances immediately BEFORE that month, not current-month movements."],
    ["Edit the 14 numeric balance columns and Correction reason. Keep headers, Project Code, Project Name, Project ID, period and version unchanged."],
    ["Delete entire rows for projects you do not want to update, including locked/read-only projects."],
    ["Each included row needs a correction reason of 10–2000 characters. All 14 balances are required; enter 0 explicitly."],
    ["Counts must be non-negative whole numbers; manhours may be decimals. Closed must not exceed issued. Do not use formulas."],
    ["Setup status is informational only; current permissions, versions and submitted history are checked again at upload and apply."],
    ["Upload previews every included project. Confirm Apply to save ALL rows together; if any row fails, NONE are saved."],
    ["Stale versions require a fresh template. Submitted history cannot be overwritten; choose a future unsubmitted month."],
    ["Maximum 500 project rows and 2 MB. Existing version-1 single-project templates remain accepted."],
    [],["Balance column","Unit","Field key"],
    ...historicalFields.map((f,i)=>[historicalBulkColumns[i+7],f.unit,f.key]),
  ]),"Instructions");
  return XLSX.write(wb,{type:"buffer",bookType:"xlsx"}) as Buffer;
}

export function parseHistoricalBulkWorkbook(fileBase64:string,period:string) {
  const wb=readWorkbook(fileBase64),sheet=wb.Sheets["Opening balances"];
  if(!sheet)throw new Error('Missing "Opening balances" sheet. Use the downloaded template');
  if(XLSX.utils.decode_range(sheet["!fullref"]??sheet["!ref"]??"A1").e.r>501)throw new Error("A workbook may contain at most 500 project rows");
  if(Object.values(sheet).some((cell:any)=>cell&&typeof cell==="object"&&cell.f))throw new Error("Use numeric values, not Excel formulas");
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,blankrows:true});
  if(rows[0]?.[0]!=="QMS360 Historical Balances")throw new Error("Unsupported historical template");
  if(rows[0]?.[1]===1){
    const input=parseHistoricalWorkbook(fileBase64,String(rows[1]?.[1]??""),period);
    return [{input,rowNumber:2,projectCode:undefined,projectName:undefined}];
  }
  if(rows[0]?.[1]!==2)throw new Error("Unsupported historical template version");
  if(rows[1]?.length!==historicalBulkColumns.length||historicalBulkColumns.some((label,i)=>rows[1]?.[i]!==label))
    throw new Error("The workbook columns changed. Download a fresh multi-project template and keep its headers unchanged");
  const entries: {input:HistoricalInput;rowNumber:number;projectCode:string|undefined;projectName:string|undefined}[]=[];
  const errors:string[]=[];
  rows.slice(2).forEach((row,index)=>{
    if(row.every(v=>v===null||v===""))return;
    const rowNumber=index+3;
    if(row.length>historicalBulkColumns.length){errors.push(`Row ${rowNumber}: unexpected extra columns`);return;}
    const balances=Object.fromEntries(historicalFields.map((f,i)=>[f.key,row[i+7]]));
    const result=historicalInput.safeParse({projectId:row[2],period:row[3],version:row[4],reason:row[5],balances});
    if(!result.success){errors.push(`Row ${rowNumber} (${String(row[0]??"unknown project")}): ${result.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}`);return;}
    if(typeof row[0]!=="string"||!row[0].trim()||typeof row[1]!=="string"||!row[1].trim()){
      errors.push(`Row ${rowNumber}: keep the project code and name from the template`);return;
    }
    entries.push({input:result.data,rowNumber,projectCode:row[0],projectName:row[1]});
  });
  if(errors.length)throw new Error(errors.slice(0,30).join("\n"));
  const batch=historicalBatchInput.safeParse({period,items:entries.map(e=>e.input)});
  if(!batch.success)throw new Error(batch.error.issues.map(i=>`${typeof i.path[1]==="number"?`Row ${i.path[1]+3}`:"Workbook"}: ${i.message}`).join("; "));
  return entries;
}
