import {and,eq,isNull} from "drizzle-orm";
import {db,auditWorkspaceRoles as roles,auditWorkspaceRolePermissions as grants,auditPermissions as permissions,
  auditUserWorkspaceRoles as assignments,users} from "@workspace/db";
import {HttpError} from "./workspace";

export type ReportReviewer = {roleId:string;roleName:string;level:number|null;userId:string;userName:string;projectIds:string[];businessUnitIds:string[]};
type Step = {level:number;roleIds:string[];approvers:Array<{id:string;name:string}>};
type Decision = {decision:string;userId:string;userName:string;level:number;remarks:string;at:string};
export type AuditReportApprovalState = {
  status:"Pending approval"|"Approved"|"Sent back";steps:Step[];index:number;
  submittedById:string;submittedAt:string;history:Decision[];
};
export function reportAssignmentAllowsProject(projectIds:string[],projectId:string|null|undefined,departmentIds:string[]=[],departmentId?:string|null,businessUnitIds:string[]=[]) {
  if (departmentIds.length) return !projectId && !!departmentId && departmentIds.includes(departmentId);
  // Like Audit RBAC, business-unit-only assignments are restricted, not global.
  // A separate read grant must never broaden an approval-bearing assignment.
  return (!projectIds.length && !businessUnitIds.length) || !!projectId && projectIds.includes(projectId);
}
export async function reportReviewers(database:Pick<typeof db,"select">,organizationId:string,projectId:string|null|undefined,departmentId?:string|null):Promise<ReportReviewer[]> {
  const rows=await database.select({roleId:roles.id,roleName:roles.name,level:roles.roleAuthorizationLevel,
    userId:users.id,userName:users.fullName,projectIds:assignments.projectIds,departmentIds:assignments.departmentIds,businessUnitIds:assignments.businessUnitIds}).from(roles)
    .innerJoin(grants,and(eq(grants.workspaceRoleId,roles.id),eq(grants.organizationId,organizationId),isNull(grants.deletedAt),eq(grants.grant,"full")))
    .innerJoin(permissions,and(eq(permissions.id,grants.permissionId),eq(permissions.organizationId,organizationId),
      eq(permissions.key,"audit.audits.approve_reject"),isNull(permissions.deletedAt)))
    .innerJoin(assignments,and(eq(assignments.workspaceRoleId,roles.id),eq(assignments.organizationId,organizationId),
      eq(assignments.status,"active"),isNull(assignments.deletedAt)))
    .innerJoin(users,and(eq(users.id,assignments.userId),eq(users.organizationId,organizationId),
      eq(users.accessStatus,"active"),isNull(users.deletedAt)))
    .where(and(eq(roles.organizationId,organizationId),eq(roles.status,"active"),isNull(roles.deletedAt)));
  return rows.filter(row=>reportAssignmentAllowsProject(row.projectIds,projectId,row.departmentIds,departmentId,row.businessUnitIds));
}
export function submitReportApproval(reviewers:ReportReviewer[],userId:string,previous?:AuditReportApprovalState,at=new Date().toISOString()):AuditReportApprovalState {
  if(!reviewers.length)throw new HttpError(409,"No Audit Report approvers are configured for this project. Assign active reviewers with Audit Reports approval permission and an Approval Level in Settings → Roles & Permissions.");
  const levels=new Map<number,Step>();
  for(const reviewer of reviewers){
    if(!Number.isInteger(reviewer.level)||reviewer.level!<1)throw new HttpError(409,`Set a positive Approval Level on Audit Report role "${reviewer.roleName}".`);
    const level=reviewer.level!;
    const step=levels.get(level)??{level,roleIds:[],approvers:[]};
    if(!step.roleIds.includes(reviewer.roleId))step.roleIds.push(reviewer.roleId);
    if(!step.approvers.some(user=>user.id===reviewer.userId))step.approvers.push({id:reviewer.userId,name:reviewer.userName});
    levels.set(level,step);
  }
  return {status:"Pending approval",steps:[...levels.values()].sort((a,b)=>a.level-b.level),index:0,
    submittedById:userId,submittedAt:at,history:previous?.history??[]};
}
export function canReviewReport(state:AuditReportApprovalState|undefined,reviewers:ReportReviewer[],userId:string) {
  if(state?.status!=="Pending approval")return false;
  const step=state.steps[state.index];
  return !!step && step.approvers.some(user=>user.id===userId) &&
    reviewers.some(user=>user.userId===userId&&step.roleIds.includes(user.roleId));
}
export function reviewReportApproval(state:AuditReportApprovalState|undefined,reviewers:ReportReviewer[],userId:string,userName:string,
  decision:"approve"|"send_back",remarks="",at=new Date().toISOString()):AuditReportApprovalState {
  if(state?.status!=="Pending approval")throw new HttpError(409,"This Audit Report is no longer pending approval. Refresh the page.");
  if(!canReviewReport(state,reviewers,userId))throw new HttpError(403,"Only an authorized reviewer at the current Audit Report approval level may act.");
  if(decision==="send_back"&&!remarks.trim())throw new HttpError(422,"Enter the changes required before sending this report back.");
  const next=state.steps[state.index+1];
  if(decision==="approve"&&next&&!next.approvers.some(user=>reviewers.some(live=>live.userId===user.id&&next.roleIds.includes(live.roleId)))){
    throw new HttpError(409,`Approval Level ${next.level} has no eligible reviewers. Ask an administrator to restore its reviewer assignments.`);
  }
  return {...state,status:decision==="send_back"?"Sent back":next?"Pending approval":"Approved",
    index:decision==="approve"&&next?state.index+1:state.index,
    history:[...state.history,{decision,userId,userName,level:state.steps[state.index]!.level,remarks:remarks.trim(),at}]};
}
export function reportContentLocked(state?:AuditReportApprovalState){return state?.status==="Pending approval"||state?.status==="Approved";}
export function reportApprovalSummary(state?:AuditReportApprovalState,canReview=false){
  const step=state?.status==="Pending approval"?state.steps[state.index]:undefined;
  return {status:state?.status??"Not submitted",pendingLevel:step?.level??null,pendingApprovers:step?.approvers??[],
    canReview,history:(state?.history??[]).map(({userId,...entry})=>entry)};
}
