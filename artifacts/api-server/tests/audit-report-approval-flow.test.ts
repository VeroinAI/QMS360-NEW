import {afterAll,beforeAll,describe,expect,it} from "vitest";
import type {Server} from "node:http";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {eq} from "drizzle-orm";
import {db,organizations,projects,platformRoles,users,audits,auditPlans,auditSchedules,
  auditWorkspaceRoles,auditPermissions,auditWorkspaceRolePermissions,auditUserWorkspaceRoles,auditAuditLogEntries,
  auditNotifications,organizationSettings} from "@workspace/db";
import app from "../src/app";
import {issueToken} from "../src/lib/auth";
import {strFromU8,unzipSync} from "fflate";
const suffix=randomUUID().slice(0,8);
let server:Server,base:string,orgId:string,projectId:string,auditId:string,browserAuditId:string;
const tokens:string[]=[],personIds:string[]=[];
async function call(method:string,path:string,who=0,data?:unknown){
  const response=await fetch(`${base}/api/audit${path}`,{method,headers:{authorization:`Bearer ${tokens[who]}`,"content-type":"application/json"},
    body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,body:await response.json()};
}
beforeAll(async()=>{
  await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",resolve);});
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const [org]=await db.insert(organizations).values({name:`Audit approval test ${suffix}`,code:`AA${suffix}`}).returning();orgId=org!.id;
  const projectRows=await db.insert(projects).values(["Approval project","Other project"].map((name,i)=>({organizationId:orgId,name,code:`AA${i}${suffix}`}))).returning();
  projectId=projectRows[0]!.id;
  const platform=await db.insert(platformRoles).values([{organizationId:orgId,name:"Org Admin",isSystem:true},{organizationId:orgId,name:"Employee",isSystem:true}]).returning();
  const people=await db.insert(users).values(["Author","First reviewer","Final reviewer","Other project reviewer","Schedule reviewer","Business unit reviewer"].map((fullName,i)=>({
    organizationId:orgId,platformRoleId:platform[i?1:0]!.id,fullName,
    email:`approval-${i}-${suffix}@example.test`,username:`approval-${i}-${suffix}`,
  }))).returning();
  people.forEach(person=>{tokens.push(issueToken(person));personIds.push(person.id);});
  const permissions=await db.insert(auditPermissions).values(["audit.audits.view_all","audit.audits.approve_reject","approve_reject"].map(key=>({
    organizationId:orgId,key,label:key,category:"Audit",
  }))).returning();
  for(let i=1;i<=5;i++){
    const [role]=await db.insert(auditWorkspaceRoles).values({organizationId:orgId,name:`Reviewer ${i}`,roleAuthorizationLevel:i===2?2:1}).returning();
    const selected=i===4?[permissions[0]!,permissions[2]!]:[permissions[0]!,permissions[1]!];
    await db.insert(auditWorkspaceRolePermissions).values(selected.map(permission=>({organizationId:orgId,workspaceRoleId:role!.id,permissionId:permission.id,grant:"full" as const})));
    await db.insert(auditUserWorkspaceRoles).values({organizationId:orgId,workspaceRoleId:role!.id,userId:people[i]!.id,
      projectIds:i===2||i===5?[]:[i===3?projectRows[1]!.id:projectId],businessUnitIds:i===5?[randomUUID()]:[]});
    if(i===5){
      const [readRole]=await db.insert(auditWorkspaceRoles).values({organizationId:orgId,name:"Organization-wide Audit reader"}).returning();
      await db.insert(auditWorkspaceRolePermissions).values({organizationId:orgId,workspaceRoleId:readRole!.id,permissionId:permissions[0]!.id,grant:"full"});
      await db.insert(auditUserWorkspaceRoles).values({organizationId:orgId,workspaceRoleId:readRole!.id,userId:people[i]!.id,projectIds:[]});
    }
  }
  const [schedule]=await db.insert(auditSchedules).values({organizationId:orgId,projectId,title:"Approval schedule",year:2026}).returning();
  const [plan]=await db.insert(auditPlans).values({organizationId:orgId,projectId,auditScheduleId:schedule!.id,
    status:JSON.stringify({leadAuditorId:personIds[0]})}).returning();
  const records=await db.insert(audits).values(["Approval workflow","Browser approval"].map(title=>({
    organizationId:orgId,projectId,auditPlanId:plan!.id,referenceNumber:`${title}-${suffix}`,workflowState:"planned",
    status:JSON.stringify({title,reportNumber:`REPORT-${suffix}-${title}`,reportDetails:{values:{overallConclusion:"Recorded conclusion"},rows:{}}}),
  }))).returning();
  auditId=records[0]!.id;browserAuditId=records[1]!.id;
},30000);
afterAll(async()=>{
  server?.close();
  if(process.env.QMS_AUDIT_APPROVAL_BROWSER==="1"){
    await writeFile("/tmp/qms-audit-approval-browser.json",JSON.stringify({orgId,projectId,auditId:browserAuditId,tokens,personIds}),{mode:0o600});
    return;
  }
  if(!orgId)return;
  for(const table of [auditNotifications,auditAuditLogEntries,audits,auditPlans,auditSchedules,auditUserWorkspaceRoles,
    auditWorkspaceRolePermissions,auditWorkspaceRoles,auditPermissions,users,platformRoles,projects,organizationSettings]){
    await db.delete(table).where(eq(table.organizationId,orgId));
  }
  await db.delete(organizations).where(eq(organizations.id,orgId));
});
describe("Audit Report approval API",()=>{
  it("requires an explicit approval module on role saves",async()=>{
    const result=await call("POST","/admin/roles",0,{id:randomUUID(),name:"Missing module",description:"",active:true,
      roleAuthorizationLevel:1,permissions:[{key:"approve_reject",name:"Approve"}]});
    expect(result.status).toBe(422);expect(result.body.error).toMatch(/approval module/);
  });
  it("creates a report-only approval role through the same validated API used by Settings",async()=>{
    const id=randomUUID();
    const result=await call("POST","/admin/roles",0,{id,name:"Report-only reviewer",description:"Independent report approval",
      active:true,roleAuthorizationLevel:1,permissions:[{key:"approve_reject",name:"Approve / reject"},
        {key:"audit.audits.approve_reject",name:"Audits / Execution: Approve / reject"}]});
    expect(result.status).toBe(201);
    expect(result.body.roleAuthorizationLevel).toBe(1);
    expect(result.body.permissions.map((permission:{key:string})=>permission.key)).toContain("audit.audits.approve_reject");
    expect(result.body.permissions.map((permission:{key:string})=>permission.key)).not.toContain("audit.schedules.approve_reject");
    const listed=await call("GET","/admin/roles?limit=200");
    expect(listed.body.items.find((role:{id:string})=>role.id===id).permissions).toEqual(result.body.permissions);
  });
  it("submits on completion, includes organization-wide reviewers and excludes other projects and schedule-only roles",async()=>{
    const result=await call("POST",`/audits/${auditId}/complete`);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("Complete");
    expect(result.body.reportApproval.status).toBe("Pending approval");
    expect(result.body.reportApproval.pendingLevel).toBe(1);
    expect(result.body.reportApproval.pendingApprovers.map((user:{id:string})=>user.id)).toEqual([personIds[1]]);
    expect(result.body.canEdit).toBe(false);
    const again=await call("POST",`/audits/${auditId}/complete`);
    expect(again.status).toBe(200);
    expect(again.body.reportApproval.history).toEqual([]);
  });
  it("never borrows broad read scope for business-unit-restricted approval, including old snapshots",async()=>{
    const detail=await call("GET",`/audits/${auditId}`,5);
    expect(detail.status).toBe(200); // Broad read access is intentionally valid.
    expect(detail.body.reportApproval.canReview).toBe(false);
    expect(detail.body.reportApproval.pendingApprovers.map((user:{id:string})=>user.id)).not.toContain(personIds[5]);
    const [saved]=await db.select().from(audits).where(eq(audits.id,auditId));
    const assignments=await db.select().from(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.userId,personIds[5]!));
    const assignment=assignments.find(row=>row.businessUnitIds.length);
    const meta=JSON.parse(saved!.status!);
    // A snapshot issued before the restriction/fix must not grant live access.
    meta.reportApproval.steps[0].roleIds.push(assignment!.workspaceRoleId);
    meta.reportApproval.steps[0].approvers.push({id:personIds[5],name:"Business unit reviewer"});
    await db.update(audits).set({status:JSON.stringify(meta)}).where(eq(audits.id,auditId));
    try {
      const old=await call("GET",`/audits/${auditId}`,5);
      expect(old.status).toBe(200);
      expect(old.body.reportApproval.canReview).toBe(false);
      const actions=await call("GET","/my-actions",5);
      expect(actions.status).toBe(200);
      expect(actions.body.items.some((item:{id:string})=>item.id===auditId)).toBe(false);
      expect((await call("POST",`/audits/${auditId}/review`,5,{decision:"approve"})).status).toBe(403);
    } finally {
      await db.update(audits).set({status:saved!.status}).where(eq(audits.id,auditId));
    }
  });
  it("puts pending reports in the current reviewer's action queue and enforces read-only content",async()=>{
    const actions=await call("GET","/my-actions",1);
    expect(actions.status).toBe(200);
    expect(actions.body.items.some((item:{id:string})=>item.id===auditId)).toBe(true);
    const row=await call("GET",`/audits/${auditId}`,1);
    expect(row.status).toBe(200);expect(row.body.reportApproval.canReview).toBe(true);
    const blocked=await call("PUT",`/audits/${auditId}/report-details`,0,{values:{overallConclusion:"Changed"},rows:{}});
    expect(blocked.status).toBe(409);
    for(const who of [2,3,4]){
      const decision=await call("POST",`/audits/${auditId}/review`,who,{decision:"approve"});
      expect(decision.status).toBe(403);
    }
  });
  it("does not disclose an already-submitted report through an out-of-scope completion retry",async()=>{
    const [assignment]=await db.select().from(auditUserWorkspaceRoles).where(eq(auditUserWorkspaceRoles.userId,personIds[3]!));
    const [permission]=await db.insert(auditPermissions).values({organizationId:orgId,key:"audit.audits.create_edit",label:"Audit edit",category:"Audit"}).returning();
    await db.insert(auditWorkspaceRolePermissions).values({organizationId:orgId,workspaceRoleId:assignment!.workspaceRoleId,permissionId:permission!.id,grant:"full"});
    const retry=await call("POST",`/audits/${auditId}/complete`,3);
    expect(retry.status).toBe(403);
    expect(retry.body.reportApproval).toBeUndefined();
  });
  it("advances to the next level without completing early and rejects duplicate level decisions",async()=>{
    const next=await call("POST",`/audits/${auditId}/review`,1,{decision:"approve",remarks:"First review"});
    expect(next.status).toBe(200);expect(next.body.reportApproval.status).toBe("Pending approval");
    expect(next.body.reportApproval.pendingLevel).toBe(2);
    expect(next.body.reportApproval.pendingApprovers[0].id).toBe(personIds[2]);
    const duplicate=await call("POST",`/audits/${auditId}/review`,1,{decision:"approve"});
    expect(duplicate.status).toBe(403);
  });
  it("sends back with mandatory reasons, allows correction and restarts approval at level one",async()=>{
    expect((await call("POST",`/audits/${auditId}/review`,2,{decision:"send_back"})).status).toBe(422);
    const back=await call("POST",`/audits/${auditId}/review`,2,{decision:"send_back",remarks:"Correct the conclusion"});
    expect(back.status).toBe(200);expect(back.body.reportApproval.status).toBe("Sent back");
    const correction=await call("PUT",`/audits/${auditId}/report-details`,0,{values:{overallConclusion:"Corrected conclusion"},rows:{}});
    expect(correction.status).toBe(200);
    const submitted=await call("POST",`/audits/${auditId}/complete`);
    expect(submitted.status).toBe(200);expect(submitted.body.reportApproval.pendingLevel).toBe(1);
    expect(submitted.body.reportApproval.history).toHaveLength(2);
  });
  it("approves only at the final level and keeps completed approval locked",async()=>{
    expect((await call("POST",`/audits/${auditId}/review`,1,{decision:"approve"})).status).toBe(200);
    const final=await call("POST",`/audits/${auditId}/review`,2,{decision:"approve"});
    expect(final.status).toBe(200);expect(final.body.reportApproval.status).toBe("Approved");
    expect(final.body.reportApproval.pendingLevel).toBeNull();
    expect((await call("PUT",`/audits/${auditId}/report-details`,0,{values:{},rows:{}})).status).toBe(409);
    expect((await call("POST",`/audits/${auditId}/review`,2,{decision:"approve"})).status).toBe(409);
  });
  it("downloads conclusion sign-offs from the completed report's actual approval cycle",async()=>{
    const response=await fetch(`${base}/api/audit/audits/${auditId}/report/pptx`,{
      headers:{authorization:`Bearer ${tokens[0]}`}});
    expect(response.status).toBe(200);
    const files=unzipSync(new Uint8Array(await response.arrayBuffer()));
    const conclusion=strFromU8(files["ppt/slides/slide17.xml"]);
    expect(conclusion).toContain(">Author<");
    expect(conclusion.match(/>First reviewer</g)).toHaveLength(1);
    expect(conclusion.match(/>Final reviewer</g)).toHaveLength(1);
    expect(conclusion).toMatch(/Report issue date: \d/);
    expect(conclusion).not.toMatch(/Acknowledged by|Distribution:/);
  });
});
