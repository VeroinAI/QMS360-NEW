import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { writeFile,readFile,unlink } from "node:fs/promises";
import * as XLSX from "xlsx";
import { eq,and } from "drizzle-orm";
import { db,organizations,projects,platformRoles,users,applicationAccess,workspaceRoles,permissions,workspaceRolePermissions,
  userWorkspaceRoles,qaqcReportSubmissions,auditLogEntries,organizationSettings } from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { zeroDailyOpening,dailySet,dailyOpeningKey } from "../src/lib/qaqc-daily-historical";
import { dailyHistoricalWorkbook,dailySheet } from "../src/lib/qaqc-daily-historical-excel";
import { historyBaseline } from "../src/routes/qaqc-reporting";

let server:Server,base:string,orgId:string,admin:string,scoped:string,viewer:string,userId:string;
let ps:typeof projects.$inferSelect[]=[];
const suffix=randomUUID().slice(0,8),fixture="/tmp/qms-daily-opening-fixture.json";
const retain=process.env.QMS_DAILY_OPENING_BROWSER==="1",cleanupOnly=process.env.QMS_DAILY_OPENING_CLEANUP==="1";
async function cleanup(id:string){
  for(const table of [auditLogEntries,qaqcReportSubmissions,userWorkspaceRoles,workspaceRolePermissions,permissions,
    workspaceRoles,applicationAccess,organizationSettings,users,platformRoles,projects])
    await db.delete(table).where(eq(table.organizationId,id));
  await db.delete(organizations).where(eq(organizations.id,id));
}
const headers=(token=admin)=>({Authorization:`Bearer ${token}`,"Content-Type":"application/json"});
async function request(path:string,body?:unknown,token=admin){
  const response=await fetch(`${base}/api/qaqc/reporting/${path}`,{method:body?"POST":"GET",headers:headers(token),...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
function opening(index:number,date="2020-01-02"){
  const data=zeroDailyOpening();dailySet(data,"disciplines.drawings.Civil.approved",25);
  data.correspondence.incoming=7;data.documentTypes.Drawings=25;data.revisions.drawings=[{name:"0",value:25}];
  return {projectId:ps[index]!.id,goLiveDate:date,reason:"Go-live opening snapshot",rowNumber:index+3,data};
}
async function fresh(index:number){
  const [row]=await db.select().from(projects).where(eq(projects.id,ps[index]!.id));return row!;
}
beforeAll(async()=>{
  if(cleanupOnly)return;
  server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
  const [organization]=await db.insert(organizations).values({name:`Daily opening verification ${suffix}`,code:`DGO${suffix}`,timezone:"Asia/Riyadh"}).returning();
  orgId=organization!.id;
  ps=await db.insert(projects).values(Array.from({length:8},(_,index)=>({organizationId:orgId,name:`Daily go-live ${index+1} ${suffix}`,
    code:`DGO${index}${suffix}`,customFields:{keepMe:"preserved"}}))).returning();
  const roles=await db.insert(platformRoles).values([{organizationId:orgId,name:"Org Admin",isSystem:true},{organizationId:orgId,name:"Employee",isSystem:true}]).returning();
  const people=await db.insert(users).values([0,1,1].map((role,index)=>({organizationId:orgId,platformRoleId:roles[role]!.id,
    fullName:["Daily opening administrator","Daily opening scoped operator","Daily opening viewer"][index]!,
    email:`daily-opening-${suffix}-${index}@example.test`,username:`daily-opening-${suffix}-${index}`,passwordHash:"not-a-password-login",status:"active"}))).returning();
  userId=people[0]!.id;[admin,scoped,viewer]=people.map(person=>issueToken(person));
  for(const [index,person] of people.slice(1).entries()){
    const [role]=await db.insert(workspaceRoles).values({organizationId:orgId,name:`Opening role ${index}`}).returning();
    await db.insert(userWorkspaceRoles).values({organizationId:orgId,userId:person.id,workspaceRoleId:role!.id,projectIds:[ps[0]!.id,ps[1]!.id,ps[6]!.id,ps[7]!.id]});
    for(const module of ["historical_balances","daily_reports"]){
      const operations=index===1?["view_all"]:module==="historical_balances"?["view_all","create_edit","import","export"]:["view_all","create_edit"];
      for(const operation of operations){
        const key=`qaqc.${module}.${operation}`;
        let [permission]=await db.select().from(permissions).where(and(eq(permissions.organizationId,orgId),eq(permissions.key,key)));
        if(!permission)[permission]=await db.insert(permissions).values({organizationId:orgId,key,label:key,category:"qaqc"}).returning();
        await db.insert(workspaceRolePermissions).values({organizationId:orgId,workspaceRoleId:role!.id,permissionId:permission!.id});
      }
    }
  }
},30000);
afterAll(async()=>{
  if(cleanupOnly){
    const saved=JSON.parse(await readFile(fixture,"utf8"));await cleanup(saved.orgId);await unlink(fixture);return;
  }
  if(!orgId){if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));return;}
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(retain&&scoped){
    const catalogue=ps.slice(6).map(p=>({id:p.id,name:p.name,code:p.code,label:p.name}));
    const wb=XLSX.read(dailyHistoricalWorkbook(catalogue,"2020-01-02"));
    const sheet=wb.Sheets[dailySheet]!;
    sheet.C3={t:"s",v:"Browser go-live setup"};sheet.C4={t:"s",v:"Browser go-live setup"};
    sheet.D3={t:"n",v:25};sheet.D4={t:"n",v:15};
    const workbookPath="/tmp/qms-daily-opening-browser.xlsx";
    await writeFile(workbookPath,XLSX.write(wb,{type:"buffer",bookType:"xlsx"}),{mode:0o600});
    await writeFile(fixture,JSON.stringify({orgId,token:scoped,adminToken:admin,projects:catalogue,workbookPath}),{mode:0o600});
  }else await cleanup(orgId);
},30000);
describe.skipIf(cleanupOnly)("Daily opening transaction and reporting integration",()=>{
  it("uses historical activity/project grants, not ordinary Daily edit rights",async()=>{
    const list=await request("daily-historical-balances/projects",undefined,scoped);
    expect(list.status).toBe(200);expect(list.data.items.map((p:any)=>p.id)).not.toContain(ps[2]!.id);
    expect((await request("daily-historical-balances/apply",{confirmed:true,items:[opening(2)]},scoped)).status).toBe(403);
    expect((await request("daily-historical-balances/preview",{fileBase64:"x"},viewer)).status).toBe(403);
  });
  it("rolls the entire file back if a later project has an existing draft",async()=>{
    const [first,last]=[0,1].sort((a,b)=>ps[a]!.id.localeCompare(ps[b]!.id));
    const [report]=await db.insert(qaqcReportSubmissions).values({organizationId:orgId,projectId:ps[last!]!.id,reportType:"daily",period:"2020-01-02",state:"draft",data:zeroDailyOpening(),createdById:userId}).returning();
    const result=await request("daily-historical-balances/apply",{confirmed:true,items:[{...opening(first!),rowNumber:3},{...opening(last!),rowNumber:4}]});
    expect(result.status).toBe(409);expect(result.data.message??result.data.error).toMatch(/Row 4/);
    expect((await fresh(first!)).customFields[dailyOpeningKey]).toBeUndefined();
    await db.delete(qaqcReportSubmissions).where(eq(qaqcReportSubmissions.id,report!.id));
  });
  it("commits both projects, retains unrelated custom data, and audits each load",async()=>{
    const result=await request("daily-historical-balances/apply",{confirmed:true,items:[opening(0),opening(1)]},scoped);
    expect(result.status).toBe(200);expect(result.data.applied).toBe(2);
    const project=await fresh(0);expect(project.customFields.keepMe).toBe("preserved");
    expect(project.customFields[dailyOpeningKey]).toMatchObject({goLiveDate:"2020-01-02",data:opening(0).data});
    const logs=await db.select().from(auditLogEntries).where(and(eq(auditLogEntries.organizationId,orgId),eq(auditLogEntries.action,"load_daily_opening_balances")));
    expect(logs).toHaveLength(2);
  });
  it("rejects repeats across months and leaves other file projects untouched",async()=>{
    const result=await request("daily-historical-balances/apply",{confirmed:true,items:[opening(0,"2020-02-02"),opening(3)]});
    expect(result.status).toBe(409);expect(JSON.stringify(result.data)).toMatch(/already been loaded/);
    expect((await fresh(3)).customFields[dailyOpeningKey]).toBeUndefined();
  });
  it("uses opening counts in the first daily report; later submitted snapshots take precedence",async()=>{
    const context=await request(`context?reportType=daily&projectId=${ps[0]!.id}&period=2020-01-02`);
    expect(context.status).toBe(200);expect(context.data.baseline.hasBaseline).toBe(true);
    expect(context.data.baseline.dailyHistoricalSetup.goLiveDate).toBe("2020-01-02");
    const data=zeroDailyOpening();data.disciplines.drawings.Civil.approved=27;
    const report=await request("reports",{reportType:"daily",projectId:ps[0]!.id,period:"2020-01-02",data});
    expect(report.status).toBe(201);
    expect(report.data.baseline.disciplines.drawings.Civil.approved).toBe(25);
    expect(report.data.baseline.revisions.drawings).toEqual([{name:"0",value:25}]);
    expect((await request("reports",{reportType:"daily",projectId:ps[0]!.id,period:"2020-01-01",data})).status).toBe(422);
    const later=zeroDailyOpening();later.correspondence.incoming=19;
    await db.insert(qaqcReportSubmissions).values({organizationId:orgId,projectId:ps[0]!.id,reportType:"daily",period:"2020-01-03",data:later,state:"approved",submittedAt:new Date(),createdById:userId});
    const history=await historyBaseline(orgId,ps[0]!.id,"daily","2020-01-05");
    expect(history.baseline.correspondence.incoming).toBe(19);
  });
  it("serializes concurrent opening load and first report creation",async()=>{
    const [load,create]=await Promise.all([
      request("daily-historical-balances/apply",{confirmed:true,items:[opening(4)]}),
      request("reports",{reportType:"daily",projectId:ps[4]!.id,period:"2020-01-02",data:zeroDailyOpening()}),
    ]);
    expect(create.status).toBe(201);expect([200,409]).toContain(load.status);
    const [report]=await db.select().from(qaqcReportSubmissions).where(eq(qaqcReportSubmissions.projectId,ps[4]!.id));
    if(load.status===200)expect((report!.baseline as any).disciplines.drawings.Civil.approved).toBe(25);
    else expect((await fresh(4)).customFields[dailyOpeningKey]).toBeUndefined();
  });
  it("retained audit history prevents reload even if project setup metadata was removed",async()=>{
    await db.update(projects).set({customFields:{keepMe:"preserved"}}).where(eq(projects.id,ps[1]!.id));
    expect((await request("daily-historical-balances/apply",{confirmed:true,items:[opening(1)]})).status).toBe(409);
  });
  it("rejects missing confirmation, invalid source values and future dates without writes",async()=>{
    expect((await request("daily-historical-balances/apply",{confirmed:false,items:[opening(5)]})).status).toBe(422);
    const invalid=opening(5);invalid.data.correspondence.incoming=-1;
    expect((await request("daily-historical-balances/apply",{confirmed:true,items:[invalid]})).status).toBe(422);
    expect((await request("daily-historical-balances/apply",{confirmed:true,items:[opening(5,"2999-01-01")]})).status).toBe(422);
    expect((await fresh(5)).customFields[dailyOpeningKey]).toBeUndefined();
  });
});
