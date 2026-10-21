import { Router,type Request } from "express";
import { and,asc,desc,eq,gte,inArray,isNull,sql } from "drizzle-orm";
import { db,projects,qaqcReportSubmissions,auditLogEntries,users } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireAppAccess,requirePermission,getAuthorizedProjectScope } from "../middlewares/rbac";
import { asyncHandler,HttpError,writeAuditLog } from "../lib/workspace";
import { calculateReport,validateReportData } from "../lib/qaqc-reporting-model";
import { historyBaseline,legacyBaseline } from "./qaqc-reporting";
import { historicalFields,historicalInput,historicalBatchInput,historicalPeriod,flattenHistorical,historicalBaseline,getHistoricalSetup,protectsHistoricalSnapshot,type HistoricalInput } from "../lib/qaqc-historical-balances";
import { historicalWorkbook,parseHistoricalWorkbook,historicalBulkWorkbook,parseHistoricalBulkWorkbook } from "../lib/qaqc-historical-excel";
import type { QaqcOperation } from "@workspace/field-controls";

const router=Router();
router.use(requireAuth,requireAppAccess("qaqc"));
const org=(req:Request)=>req.currentUser!.organizationId;
const params=z.object({projectId:z.string().uuid(),period:historicalPeriod});
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{
  const result=schema.safeParse(value);
  if(!result.success)throw new HttpError(422,result.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
};
const target=(operation:QaqcOperation)=>({module:"historical_balances",action:"full" as const,operation});
const permission=(op:QaqcOperation)=>requirePermission("qaqc","historical_balances","full",{qaqcOperation:op});
const scopeCache=new WeakMap<Request,Map<QaqcOperation,ReturnType<typeof getAuthorizedProjectScope>>>();
function projectScope(req:Request,operation:QaqcOperation){
  let cache=scopeCache.get(req);if(!cache){cache=new Map();scopeCache.set(req,cache);}
  if(!cache.has(operation))cache.set(operation,getAuthorizedProjectScope(req,"qaqc",target(operation)));
  return cache.get(operation)!;
}
async function allowedProject(req:Request,id:string,operation:QaqcOperation){
  for(const op of new Set<QaqcOperation>(["view_all",operation])){
    const scope=await projectScope(req,op);
    if(!scope.unrestricted&&!scope.projectIds.includes(id))throw new HttpError(403,"Historical balance permission is required for this project");
  }
  const [project]=await db.select().from(projects).where(and(eq(projects.organizationId,org(req)),eq(projects.id,id),isNull(projects.deletedAt)));
  if(!project)throw new HttpError(404,"Project not found");
  return project;
}
const object=(v:unknown):Record<string,any>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,any>:{};
async function context(req:Request,projectId:string,period:string){
  const project=await allowedProject(req,projectId,"view_all");
  const saved=getHistoricalSetup(project.customFields as any,period);
  const previous=await historyBaseline(org(req),projectId,"monthly",period);
  const legacy=Object.keys(previous.baseline).length?{}:await legacyBaseline(projectId,"monthly",period);
  const balances=saved?.balances??flattenHistorical(Object.keys(previous.baseline).length?previous.baseline:legacy);
  const reports=await db.select({id:qaqcReportSubmissions.id,period:qaqcReportSubmissions.period,state:qaqcReportSubmissions.state,submittedAt:qaqcReportSubmissions.submittedAt})
    .from(qaqcReportSubmissions).where(and(eq(qaqcReportSubmissions.organizationId,org(req)),eq(qaqcReportSubmissions.projectId,projectId),
      eq(qaqcReportSubmissions.reportType,"monthly"),gte(qaqcReportSubmissions.period,period),isNull(qaqcReportSubmissions.deletedAt)));
  const blockingReports=reports.filter(protectsHistoricalSnapshot);
  const capabilities=await Promise.all((["create_edit","import","export"] as const).map(async op=>{
    const scope=await projectScope(req,op);
    return scope.unrestricted||scope.projectIds.includes(projectId);
  }));
  return {projectId,period,version:saved?.version??0,fields:historicalFields,balances,
    canEdit:capabilities[0],canImport:capabilities[1],canExport:capabilities[2],
    derived:calculateReport("monthly",{},historicalBaseline(balances)),
    source:saved?"saved_setup":Object.keys(previous.baseline).length?"previous_report":Object.keys(legacy).length?"legacy_entries":"zero",
    saved:saved?{updatedAt:saved.updatedAt,updatedById:saved.updatedById}:undefined,
    canApply:blockingReports.length===0,blockingReports,
    affectedDrafts:reports.filter(r=>r.period===period&&r.state==="draft"&&!r.submittedAt)};
}
router.get("/historical-balances/projects",permission("view_all"),asyncHandler(async(req,res)=>{
  const scope=await getAuthorizedProjectScope(req,"qaqc",target("view_all"));
  const rows=await db.select({id:projects.id,name:projects.name,code:projects.code}).from(projects)
    .where(and(eq(projects.organizationId,org(req)),isNull(projects.deletedAt),
      scope.unrestricted?undefined:inArray(projects.id,scope.projectIds))).orderBy(asc(projects.name));
  res.json(rows);
}));
router.get("/historical-balances",permission("view_all"),asyncHandler(async(req,res)=>{
  const {projectId,period}=parse(params,req.query),result=await context(req,projectId,period);
  const history=await db.select({id:auditLogEntries.id,createdAt:auditLogEntries.createdAt,actorName:users.fullName,before:auditLogEntries.before,after:auditLogEntries.after})
    .from(auditLogEntries).leftJoin(users,eq(auditLogEntries.actorId,users.id))
    .where(and(eq(auditLogEntries.organizationId,org(req)),eq(auditLogEntries.entityType,"qaqc_historical_balances"),eq(auditLogEntries.entityId,projectId),
      sql`${auditLogEntries.after}->>'period' = ${period}`)).orderBy(desc(auditLogEntries.createdAt)).limit(100);
  res.json({...result,history:history.map(h=>({...h,reason:object(h.after).reason}))});
}));
router.get("/historical-balances/template",permission("export"),asyncHandler(async(req,res)=>{
  const {projectId,period}=parse(params,req.query),project=await allowedProject(req,projectId,"export");
  const c=await context(req,projectId,period);
  const content=historicalWorkbook({projectId,period,version:c.version,reason:"",balances:c.balances},project.name);
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",`attachment; filename="historical-balances-${period.slice(0,7)}.xlsx"`);res.send(content);
}));
router.post("/historical-balances/preview",permission("import"),asyncHandler(async(req,res)=>{
  const body=parse(params.extend({fileBase64:z.string().max(2_800_000)}).strict(),req.body);
  await allowedProject(req,body.projectId,"import");
  let input;
  try{input=parseHistoricalWorkbook(body.fileBase64,body.projectId,body.period);}catch(e){throw new HttpError(422,e instanceof Error?e.message:"Invalid workbook");}
  const c=await context(req,body.projectId,body.period);
  if(input.version!==c.version)throw new HttpError(409,"Historical balances changed. Download a fresh template before importing");
  if(!c.canApply)throw new HttpError(409,"Submitted history exists for this month or a later month. Select a future unsubmitted reporting period");
  res.json({...input,changes:historicalFields.filter(f=>c.balances[f.key]!==input.balances[f.key]).map(f=>({key:f.key,label:f.label,before:c.balances[f.key],after:input.balances[f.key]}))});
}));
router.put("/historical-balances",permission("create_edit"),asyncHandler(async(req,res)=>{
  const input=parse(historicalInput,req.body);
  await allowedProject(req,input.projectId,"create_edit");
  const result=await db.transaction(tx=>applyHistoricalInput(req,tx,input));
  res.json(result);
}));

type HistoricalTx=Parameters<Parameters<typeof db.transaction>[0]>[0];
async function applyHistoricalInput(req:Request,tx:HistoricalTx,input:HistoricalInput){
    const [project]=await tx.select().from(projects).where(and(eq(projects.id,input.projectId),eq(projects.organizationId,org(req)),isNull(projects.deletedAt))).for("update");
    if(!project)throw new HttpError(404,"Project not found");
    const custom=object(project.customFields),settings=object(custom.qaqcReporting),setups=object(settings.historicalBalances);
    const before=getHistoricalSetup(custom,input.period);
    if((before?.version??0)!==input.version)throw new HttpError(409,"Historical balances changed. Reload the latest values before saving");
    // Lock all affected report rows before checking state; concurrent submission
    // updates also compare report versions and cannot overwrite this correction.
    const reports=await tx.select().from(qaqcReportSubmissions).where(and(eq(qaqcReportSubmissions.organizationId,org(req)),
      eq(qaqcReportSubmissions.projectId,input.projectId),eq(qaqcReportSubmissions.reportType,"monthly"),
      gte(qaqcReportSubmissions.period,input.period),isNull(qaqcReportSubmissions.deletedAt))).for("update");
    if(reports.some(protectsHistoricalSnapshot))throw new HttpError(409,"Submitted history exists for this month or a later month. Apply opening balances to a future unsubmitted period instead");
    const stamp=new Date();
    const previous=await historyBaseline(org(req),input.projectId,"monthly",input.period,tx);
    const previousOpening=Object.keys(previous.baseline).length?previous.baseline:await legacyBaseline(input.projectId,"monthly",input.period);
    const auditBefore=before??{projectId:input.projectId,period:input.period,version:0,balances:flattenHistorical(previousOpening)};
    const after={...input,version:input.version+1,updatedAt:stamp.toISOString(),updatedById:req.currentUser!.id};
    const baseline={...historicalBaseline(input.balances),hasBaseline:true,historicalSetup:{period:input.period,version:after.version}};
    let updatedDrafts=0;
    for(const report of reports.filter(r=>r.period===input.period&&r.state==="draft")){
      const data=object(report.data);
      const validation=validateReportData("monthly",data,baseline,false);
      if(!validation.valid)throw new HttpError(422,`Opening balances conflict with draft ${report.id}: ${validation.errors.join("; ")}`);
      const targets={...Object.fromEntries(Object.entries(object(object(report.computed).metrics)).map(([key,value])=>[key,object(value).target??100])),...object(settings.targets)};
      await tx.update(qaqcReportSubmissions).set({baseline,computed:calculateReport("monthly",data,baseline,targets),updatedAt:stamp})
        .where(eq(qaqcReportSubmissions.id,report.id));
      updatedDrafts++;
    }
    await tx.update(projects).set({customFields:{...custom,qaqcReporting:{...settings,historicalBalances:{...setups,[input.period]:after}}},updatedAt:stamp})
      .where(eq(projects.id,input.projectId));
    await writeAuditLog(tx,"qaqc",{organizationId:org(req),actorId:req.currentUser!.id,entityType:"qaqc_historical_balances",entityId:input.projectId,
      action:"update_historical_balances",before:auditBefore,after:{...after,updatedDrafts},ipAddress:req.ip},{dispatch:false});
    return {version:after.version,updatedDrafts};
}

router.get("/historical-balances/bulk-template",permission("export"),asyncHandler(async(req,res)=>{
  const {period}=parse(z.object({period:historicalPeriod}),req.query);
  const view=await projectScope(req,"view_all"),exp=await projectScope(req,"export");
  const eligible=await db.select({id:projects.id,name:projects.name,code:projects.code}).from(projects)
    .where(and(eq(projects.organizationId,org(req)),isNull(projects.deletedAt),
      view.unrestricted?undefined:inArray(projects.id,view.projectIds),exp.unrestricted?undefined:inArray(projects.id,exp.projectIds))).orderBy(asc(projects.id));
  if(!eligible.length)throw new HttpError(403,"No projects are authorized for historical balance export");
  if(eligible.length>500)throw new HttpError(422,"A workbook supports at most 500 projects");
  const entries=[];
  for(const p of eligible){
    const c=await context(req,p.id,period);
    entries.push({input:{projectId:p.id,period,version:c.version,reason:"",balances:c.balances},projectCode:p.code,projectName:p.name,
      status:!c.canApply?"Locked: submitted history":!c.canImport||!c.canEdit?"Read-only: missing import/edit permission":"Ready for editing"});
  }
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",`attachment; filename="historical-balances-multi-project-${period.slice(0,7)}.xlsx"`);
  res.send(historicalBulkWorkbook(entries));
}));
router.post("/historical-balances/bulk-preview",permission("import"),asyncHandler(async(req,res)=>{
  const body=parse(z.object({period:historicalPeriod,fileBase64:z.string().max(2_800_000)}).strict(),req.body);
  let entries;
  try{entries=parseHistoricalBulkWorkbook(body.fileBase64,body.period);}catch(e){throw new HttpError(422,e instanceof Error?e.message:"Invalid workbook");}
  // Authorize the entire file before returning any project data.
  for(const entry of entries)await allowedProject(req,entry.input.projectId,"import");
  const rows=[];
  for(const entry of entries){
    const {input}=entry,project=await allowedProject(req,input.projectId,"import"),c=await context(req,input.projectId,input.period);
    const errors:string[]=[];
    if(entry.projectCode!==undefined&&(entry.projectCode!==project.code||entry.projectName!==project.name))errors.push("Project code/name do not match Project ID. Download a fresh template");
    if(input.version!==c.version)errors.push("Historical balances changed. Download a fresh template");
    if(!c.canApply)errors.push("Submitted history exists for this or a later month. Choose a future unsubmitted period");
    if(!c.canEdit)errors.push("Historical balance edit permission is also required to apply this row");
    rows.push({...input,rowNumber:entry.rowNumber,projectCode:project.code,projectName:project.name,errors,
      affectedDrafts:c.affectedDrafts.length,
      changes:historicalFields.filter(f=>c.balances[f.key]!==input.balances[f.key]).map(f=>({key:f.key,label:f.label,before:c.balances[f.key],after:input.balances[f.key]}))});
  }
  res.json({period:body.period,rows,canApply:rows.every(row=>!row.errors.length)});
}));
router.post("/historical-balances/bulk-apply",permission("import"),permission("create_edit"),asyncHandler(async(req,res)=>{
  const body=parse(historicalBatchInput,req.body);
  const items=[...body.items].sort((a,b)=>a.projectId.localeCompare(b.projectId));
  for(const input of items){
    await allowedProject(req,input.projectId,"import");
    await allowedProject(req,input.projectId,"create_edit");
  }
  const results=await db.transaction(async tx=>{
    const rows=[];
    // Identical project-lock ordering for every batch prevents cross-batch deadlocks.
    for(const input of items){
      try{rows.push({projectId:input.projectId,...await applyHistoricalInput(req,tx,input)});}
      catch(error){if(error instanceof HttpError)throw new HttpError(error.status,`Project ${input.projectId}: ${error.message}`);throw error;}
    }
    return rows;
  });
  res.json({results,updatedProjects:results.length,updatedDrafts:results.reduce((n,r)=>n+r.updatedDrafts,0)});
}));
export default router;
