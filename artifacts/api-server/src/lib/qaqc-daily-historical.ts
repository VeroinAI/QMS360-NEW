import { z } from "zod";
import { HttpError } from "./workspace";
import { DISCIPLINES, DAILY_STATUSES, DAILY_DOCUMENT_TYPES, DAILY_REJECTED_SUBMISSION_TYPES,
  ENTITIES, PENDING_STATUSES, BUCKETS, validateReportData } from "./qaqc-reporting-model";

export const dailyHistoricalFields: {key:string;label:string}[] = [
  ...["drawings", "submittals"].flatMap(category => DISCIPLINES.flatMap(discipline => DAILY_STATUSES.map(status =>
    ({key:`disciplines.${category}.${discipline}.${status}`, label:`${category === "drawings" ? "Drawings" : "Submittals"} / ${discipline} / ${status}`})))),
  ...[...DAILY_DOCUMENT_TYPES, "CVs", "PQP", "IFR"].map(type => ({key:`documentTypes.${type}`, label:`Document type / ${type}` })),
  ...["incoming","outgoing"].map(type => ({key:`correspondence.${type}`,label:`Correspondence / ${type}`})),
  ...DAILY_REJECTED_SUBMISSION_TYPES.map(type => ({key:`rejectedSubmissions.${type}`,label:`Rejected submissions / ${type}`})),
  ...ENTITIES.flatMap(entity => PENDING_STATUSES.flatMap(status => BUCKETS.map(bucket =>
    ({key:`pending.${entity}.${status}.${bucket}`, label:`Pending / ${entity} / ${status} / ${bucket}`})))),
];
export const dailyOpeningDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, "Enter a valid calendar date");
export const dailyOpeningInput = z.object({
  projectId:z.string().uuid(), goLiveDate:dailyOpeningDate, reason:z.string().trim().min(3).max(1000),
  data:z.record(z.string(),z.unknown()), rowNumber:z.number().int().min(3).max(502),
});
export const dailyOpeningBatch = z.object({confirmed:z.literal(true),items:z.array(dailyOpeningInput).min(1).max(500)});
export const dailyOpeningManual = dailyOpeningInput.omit({rowNumber:true}).extend({confirmed:z.literal(true)});
export type DailyOpeningInput = z.infer<typeof dailyOpeningInput>;
export const dailyOpeningKey = "qaqcDailyHistoricalSetup";
export function getDailyOpening(fields: any): {goLiveDate:string;data:Record<string,any>;reason:string}|null {
  const saved = fields?.[dailyOpeningKey];
  return saved && dailyOpeningDate.safeParse(saved.goLiveDate).success && saved.data && typeof saved.data === "object" ? saved : null;
}
export const dailyGet = (data:any,key:string):any => key.split(".").reduce((value,part)=>value?.[part],data);
export function dailySet(data:any,key:string,value:unknown) {
  const parts=key.split(".");let parent=data;
  for(const part of parts.slice(0,-1))parent=parent[part]??={};
  parent[parts.at(-1)!]=value;
}
export function zeroDailyOpening() {
  const data:Record<string,any>={revisions:{drawings:[],submittals:[]}};
  for(const field of dailyHistoricalFields)dailySet(data,field.key,0);
  return data;
}
/** Whitelist source counts only; totals, percentages and workflow metadata are never imported. */
export function validateDailyOpening(data:Record<string,any>) {
  const clean=zeroDailyOpening(), errors:string[]=[];
  const allowed=new Set(dailyHistoricalFields.map(field=>field.key));
  const visit=(value:any,path="")=>{
    if(path==="revisions")return;
    if(value&&typeof value==="object"&&!Array.isArray(value)){
      for(const [key,child] of Object.entries(value))visit(child,path?`${path}.${key}`:key);
    } else if(!allowed.has(path)) errors.push(`Unknown opening-balance field: ${path}`);
  };
  visit(data);
  for(const field of dailyHistoricalFields){
    const value=dailyGet(data,field.key);
    if(!Number.isSafeInteger(value)||value<0) errors.push(`${field.label}: enter a non-negative whole number (0 if none)`);
    else dailySet(clean,field.key,value);
  }
  for(const category of ["drawings","submittals"]){
    const rows=data.revisions?.[category];
    if(!Array.isArray(rows)||rows.length>100){errors.push(`${category} approved revisions must be a list of at most 100 revisions`);continue;}
    if(rows.some(row=>!row||typeof row!=="object"||typeof row.name!=="string"||row.name.length>100||!Number.isSafeInteger(row.value)||row.value<0||Object.keys(row).some(key=>!["name","value"].includes(key))))
      errors.push(`${category} revisions must contain only revision name and approved count`);
    clean.revisions[category]=rows.map(row=>({name:String(row?.name??"").trim(),value:row?.value}));
  }
  if(data.revisions&&Object.keys(data.revisions).some(key=>!["drawings","submittals"].includes(key)))errors.push("Unknown revision category");
  const validation=validateReportData("daily",clean,{},true);
  errors.push(...validation.errors);
  if(errors.length)throw new HttpError(422,[...new Set(errors)].join("; "));
  return clean;
}
export function assertDailyOpeningDate(goLiveDate:string, period:string) {
  if(period<goLiveDate)throw new HttpError(422,`Daily reporting starts on ${goLiveDate}. Earlier values belong to the historical opening load.`);
}
