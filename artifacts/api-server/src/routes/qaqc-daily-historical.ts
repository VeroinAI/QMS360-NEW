import { Router,type Request } from "express";
import { and,asc,eq,isNull } from "drizzle-orm";
import { db,projects,qaqcReportSubmissions,auditLogEntries,organizations } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { requireAppAccess,requirePermission,getAuthorizedProjectScope } from "../middlewares/rbac";
import { asyncHandler,HttpError,writeAuditLog } from "../lib/workspace";
import { historicalProjectCatalogue } from "../lib/qaqc-historical-projects";
import { protectsHistoricalSnapshot } from "../lib/qaqc-historical-balances";
import { dailyOpeningDate,dailyOpeningBatch,dailyOpeningKey,getDailyOpening,validateDailyOpening,type DailyOpeningInput } from "../lib/qaqc-daily-historical";
import { dailyHistoricalWorkbook,parseDailyHistoricalWorkbook,dailySheet } from "../lib/qaqc-daily-historical-excel";
import type { QaqcOperation } from "@workspace/field-controls";

const router=Router(),org=(req:Request)=>req.currentUser!.organizationId;
router.use(requireAuth,requireAppAccess("qaqc"));
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{
  const result=schema.safeParse(value);
  if(!result.success)throw new HttpError(422,result.error.issues.map(issue=>`${issue.path.join(".")}: ${issue.message}`).join("; "));
  return result.data;
};
const permission=(operation:QaqcOperation)=>requirePermission("qaqc","historical_balances","full",{qaqcOperation:operation});
async function catalogue(req:Request,operation:QaqcOperation){
  const [view,activity]=await Promise.all(["view_all",operation].map(op=>getAuthorizedProjectScope(req,"qaqc",{
    module:"historical_balances",action:"full",operation:op as QaqcOperation,
  })));
  const rows=await db.select().from(projects).where(and(eq(projects.organizationId,org(req)),isNull(projects.deletedAt))).orderBy(asc(projects.name));
  const allowed=rows.filter(p=>(view!.unrestricted||view!.projectIds.includes(p.id))&&(activity!.unrestricted||activity!.projectIds.includes(p.id)));
  return historicalProjectCatalogue(allowed);
}
type Reader=Pick<typeof db,"select">;
async function eligibility(project:typeof projects.$inferSelect,reader:Reader=db){
  const saved=getDailyOpening(project.customFields);
  const [loadedLog]=await reader.select({id:auditLogEntries.id}).from(auditLogEntries).where(and(
    eq(auditLogEntries.organizationId,project.organizationId),eq(auditLogEntries.entityType,"qaqc_daily_historical_balances"),
    eq(auditLogEntries.entityId,project.id),eq(auditLogEntries.action,"load_daily_opening_balances"))).limit(1);
  if(saved||loadedLog)return {loaded:true,blocked:true,goLiveDate:saved?.goLiveDate??null,
    reason:`Daily historical balances for "${project.name}" have already been loaded${saved?` (go-live ${saved.goLiveDate})`:""}. Only one load is allowed per project, even for a different date.`};
  const reports=await reader.select().from(qaqcReportSubmissions).where(and(eq(qaqcReportSubmissions.organizationId,project.organizationId),
    eq(qaqcReportSubmissions.projectId,project.id),eq(qaqcReportSubmissions.reportType,"daily")));
  const existing=reports.find(report=>!report.deletedAt||protectsHistoricalSnapshot(report));
  return {loaded:false,blocked:!!existing,goLiveDate:null,
    reason:existing?`Project "${project.name}" already has a Daily Submission for ${existing.period} (${existing.state}). Load opening balances before creating Daily Submissions; existing report history cannot be rewritten.`:""};
}
async function checkDate(req:Request,date:string){
  parse(dailyOpeningDate,date);
  const [organization]=await db.select({timezone:organizations.timezone}).from(organizations).where(eq(organizations.id,org(req)));
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:organization?.timezone??"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(date>today)throw new HttpError(422,"Go-live date cannot be in the future.");
}
router.get("/daily-historical-balances/projects",permission("view_all"),asyncHandler(async(req,res)=>{
  const list=await catalogue(req,"view_all"),items=[];
  for(const project of list){
    const [row]=await db.select().from(projects).where(eq(projects.id,project.id));
    items.push({...project,...await eligibility(row!)});
  }
  res.json({items});
}));
router.get("/daily-historical-balances/template",permission("export"),asyncHandler(async(req,res)=>{
  const date=parse(dailyOpeningDate,req.query.goLiveDate);await checkDate(req,date);
  const list=await catalogue(req,"export"),eligible=[];
  for(const project of list){
    const [row]=await db.select().from(projects).where(eq(projects.id,project.id));
    if(!(await eligibility(row!)).blocked)eligible.push(project);
  }
  if(!eligible.length)throw new HttpError(422,"No authorized projects are eligible. Daily opening balances must be loaded before the first Daily Submission.");
  const file=dailyHistoricalWorkbook(eligible.slice(0,500),date);
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",`attachment; filename="daily-opening-balances-${date}.xlsx"`);
  res.send(file);
}));
router.post("/daily-historical-balances/preview",permission("import"),asyncHandler(async(req,res)=>{
  const {fileBase64}=parse(z.object({fileBase64:z.string().max(2800000)}),req.body);
  let preview;
  try{preview=parseDailyHistoricalWorkbook(fileBase64,await catalogue(req,"import"));}
  catch(error){throw new HttpError(422,error instanceof Error?error.message:"Invalid workbook");}
  for(const row of preview.rows){
    try{
      await checkDate(req,row.goLiveDate);
      const [project]=await db.select().from(projects).where(and(eq(projects.id,row.projectId),eq(projects.organizationId,org(req)),isNull(projects.deletedAt)));
      if(!project)throw new HttpError(422,"Project is no longer available.");
      const state=await eligibility(project);
      if(state.blocked)throw new HttpError(409,state.reason);
    }catch(error){row.errors.push(`${dailySheet}! Row ${row.rowNumber}: ${error instanceof Error?error.message:"Invalid project"}`);}
  }
  preview.valid=!preview.errors.length&&preview.rows.every(row=>!row.errors.length);
  res.json(preview);
}));
router.post("/daily-historical-balances/apply",permission("import"),permission("create_edit"),asyncHandler(async(req,res)=>{
  const {items}=parse(dailyOpeningBatch,req.body);
  const allowed=new Set((await catalogue(req,"import")).map(p=>p.id)),editable=new Set((await catalogue(req,"create_edit")).map(p=>p.id));
  const seen=new Set<string>();
  const validated:DailyOpeningInput[]=[];
  for(const item of items){
    const ref=`${dailySheet}! Row ${item.rowNumber}`;
    if(!allowed.has(item.projectId)||!editable.has(item.projectId))throw new HttpError(403,`${ref}: Historical import and edit permissions are required for this project.`);
    if(seen.has(item.projectId))throw new HttpError(422,`${ref}: Duplicate project in this file.`);
    seen.add(item.projectId);
    try{await checkDate(req,item.goLiveDate);validated.push({...item,data:validateDailyOpening(item.data)});}
    catch(error){throw new HttpError(422,`${ref}: ${error instanceof Error?error.message:"Invalid values"}`);}
  }
  await db.transaction(async tx=>{
    // Same project row lock as report creation; deterministic ordering prevents batch deadlocks.
    for(const item of [...validated].sort((a,b)=>a.projectId.localeCompare(b.projectId))){
      const [project]=await tx.select().from(projects).where(and(eq(projects.id,item.projectId),eq(projects.organizationId,org(req)),isNull(projects.deletedAt))).for("update");
      if(!project)throw new HttpError(404,`${dailySheet}! Row ${item.rowNumber}: Project not found.`);
      const state=await eligibility(project,tx);
      if(state.blocked)throw new HttpError(409,`${dailySheet}! Row ${item.rowNumber}: ${state.reason}`);
      const saved={goLiveDate:item.goLiveDate,data:item.data,reason:item.reason,loadedAt:new Date().toISOString(),loadedById:req.currentUser!.id};
      await tx.update(projects).set({customFields:{...project.customFields,[dailyOpeningKey]:saved},updatedAt:new Date()}).where(eq(projects.id,project.id));
      await writeAuditLog(tx,"qaqc",{organizationId:org(req),actorId:req.currentUser!.id,action:"load_daily_opening_balances",entityType:"qaqc_daily_historical_balances",
        entityId:project.id,before:undefined,after:saved,ipAddress:req.ip},{dispatch:false});
    }
  });
  res.json({applied:items.length});
}));
export default router;
