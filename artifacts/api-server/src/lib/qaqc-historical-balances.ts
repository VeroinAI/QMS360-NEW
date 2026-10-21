import { z } from "zod";

export const historicalFields = [
  ...["external_ncr", "internal_ncr", "rfi", "rmi"].flatMap(key => [
    { key: `metrics.${key}.accumulatedIssued`, label: `${({external_ncr:"External NCR",internal_ncr:"Internal NCR",rfi:"RFI",rmi:"RMI"} as Record<string,string>)[key]} — Acc. till Last Month`, unit: "count" },
    { key: `metrics.${key}.accumulatedClosed`, label: `${({external_ncr:"External NCR",internal_ncr:"Internal NCR",rfi:"RFI",rmi:"RMI"} as Record<string,string>)[key]} — Closed till Last Month`, unit: "count" },
  ]),
  { key:"material.accumulatedIssued", label:"Material Inspection — Acc. MIRN till Last Month", unit:"count" },
  { key:"material.accumulatedClosed", label:"Material Inspection — Closed till Last Month", unit:"count" },
  { key:"qtbt.accumulatedTalkCount", label:"QTBT — Accumulated Talk Count till Last Month", unit:"count" },
  { key:"qtbt.accumulatedManhours", label:"QTBT — Accumulated Manhours till Last Month", unit:"hours" },
  { key:"training.accumulatedTrainingCount", label:"Training — Accumulated Training Count till Last Month", unit:"count" },
  { key:"training.accumulatedManhours", label:"Training — Accumulated Manhours till Last Month", unit:"hours" },
] as const;
export const historicalPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Select a valid reporting month");
export const historicalInput = z.object({
  projectId:z.string().uuid(), period:historicalPeriod, version:z.number().int().nonnegative(),
  reason:z.string().trim().min(10,"Provide a correction reason of at least 10 characters").max(2000),
  balances:z.record(z.string(),z.number().finite().min(0).max(1e12)),
}).strict().superRefine((v,c)=>{
  const keys=new Set(historicalFields.map(f=>f.key));
  for(const key of Object.keys(v.balances)) if(!keys.has(key as never)) c.addIssue({code:"custom",path:["balances",key],message:"Unknown historical field"});
  for(const f of historicalFields) {
    const n=v.balances[f.key];
    if(n==null) c.addIssue({code:"custom",path:["balances",f.key],message:"Opening balance is required; enter 0 if none"});
    else if(f.unit==="count"&&!Number.isSafeInteger(n)) c.addIssue({code:"custom",path:["balances",f.key],message:"Counts must be whole numbers"});
  }
  for(const prefix of ["metrics.external_ncr","metrics.internal_ncr","metrics.rfi","metrics.rmi","material"])
    if(v.balances[`${prefix}.accumulatedClosed`]!>v.balances[`${prefix}.accumulatedIssued`]!)
      c.addIssue({code:"custom",path:["balances",`${prefix}.accumulatedClosed`],message:"Closed cannot exceed accumulated issued"});
});
export type HistoricalInput=z.infer<typeof historicalInput>;
export const historicalBatchInput=z.object({
  period:historicalPeriod,items:z.array(historicalInput).min(1).max(500),
}).strict().superRefine((v,c)=>{
  const seen=new Set<string>();
  v.items.forEach((item,index)=>{
    if(item.period!==v.period)c.addIssue({code:"custom",path:["items",index,"period"],message:"Every row must match the selected reporting month"});
    if(seen.has(item.projectId))c.addIssue({code:"custom",path:["items",index,"projectId"],message:"Duplicate project in workbook"});
    seen.add(item.projectId);
  });
});
export type HistoricalSetup=HistoricalInput & {updatedAt:string;updatedById:string};
export const protectsHistoricalSnapshot=(report:{state:string;submittedAt:unknown})=>
  !!report.submittedAt||report.state==="submitted"||report.state==="approved";
export function flattenHistorical(baseline:Record<string,any>) {
  return Object.fromEntries(historicalFields.map(f=>[f.key,Number(f.key.split(".").reduce((v:any,k)=>v?.[k],baseline)??0)]));
}
export function historicalBaseline(balances:Record<string,number>) {
  const result:Record<string,any>={};
  for(const f of historicalFields){
    const parts=f.key.split(".");let target=result;
    for(const k of parts.slice(0,-1)) target=target[k]??={};
    target[parts.at(-1)!]=balances[f.key];
  }
  return result;
}
export function getHistoricalSetup(customFields:Record<string,any>|null|undefined,period:string):HistoricalSetup|undefined {
  return customFields?.qaqcReporting?.historicalBalances?.[period];
}
