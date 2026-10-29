import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { zeroDailyOpening } from "../lib/qaqc-daily-historical";

const state=vi.hoisted(()=>({project:null as any,reports:[] as any[],logs:[] as any[],writes:[] as any[],
  edit:true,importOp:true,inScope:true,locks:0,audit:vi.fn()}));
vi.mock("../middlewares/auth",()=>({requireAuth:(req:any,_:any,next:any)=>{req.currentUser={id:"actor",organizationId:"org"};next();}}));
vi.mock("../middlewares/rbac",()=>({
  requireAppAccess:()=> (_:any,__:any,next:any)=>next(),
  requirePermission:(_:any,__:any,___:any,options:any)=>(req:any,res:any,next:any)=>{
    const op=options.qaqcOperation;
    if((op==="create_edit"&&!state.edit)||(op==="import"&&!state.importOp))return res.status(403).json({error:"Permission denied"});
    next();
  },
  getAuthorizedProjectScope:async()=>({unrestricted:false,projectIds:state.inScope?[state.project.id]:[]}),
}));
vi.mock("../lib/workspace",()=>({
  HttpError:class extends Error{constructor(public status:number,message:string){super(message);}},
  asyncHandler:(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next),
  writeAuditLog:(...args:any[])=>state.audit(...args),
}));
vi.mock("@workspace/db",async original=>{
  const actual=await original<any>();
  const database:any={
    select:()=>{
      let table:any;
      const query:any={from:(t:any)=>{table=t;return query;},where:()=>query,orderBy:()=>query,limit:()=>query,
        for:()=>{state.locks++;return query;},
        then:(resolve:any,reject:any)=>Promise.resolve(table===actual.projects?[state.project]:
          table===actual.organizations?[{timezone:"UTC"}]:table===actual.qaqcReportSubmissions?state.reports:
          table===actual.auditLogEntries?state.logs:[]).then(resolve,reject)};
      return query;
    },
    update:()=>({set:(value:any)=>({where:async()=>{state.writes.push(value);state.project.customFields=value.customFields;}})}),
    transaction:async(fn:any)=>fn(database),
  };
  return {...actual,db:database};
});
import router from "./qaqc-daily-historical";
const id="11111111-1111-4111-8111-111111111111";
const input=()=>({confirmed:true,projectId:id,goLiveDate:"2025-09-19",reason:"Validated go-live snapshot",data:zeroDailyOpening()});
const app=express();app.use(express.json());app.use(router);
app.use((err:any,_:any,res:any,__:any)=>res.status(err.status??500).json({error:err.message}));
const server=createServer(app);let base="";
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as any).port}/daily-historical-balances`;});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{state.project={id,name:"Example",code:"EX",organizationId:"org",customFields:{unrelated:"preserved"}};
  state.reports=[];state.logs=[];state.writes=[];state.edit=true;state.importOp=true;state.inScope=true;state.locks=0;state.audit.mockReset();});
const post=(body:unknown=input(),path="/manual")=>fetch(`${base}${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const loadVia=(method:"manual"|"excel",date:string)=>{
  const body={...input(),goLiveDate:date};
  if(method==="manual")return post(body);
  const {confirmed,...row}=body;
  return post({confirmed,items:[{...row,rowNumber:3}]},"/apply");
};
describe("Daily manual opening API",()=>{
  describe.each([
    ["manual","manual"],["manual","excel"],["excel","manual"],["excel","excel"],
  ] as const)("one-time project load: %s then %s",(first,second)=>{
    it.each(["2025-09-18","2025-09-19","2025-10-01"])("rejects a second load with Go-Live %s",async date=>{
      expect((await loadVia(first,"2025-09-19")).status).toBe(200);
      const saved=structuredClone(state.project.customFields);
      const response=await loadVia(second,date);
      expect(response.status).toBe(409);
      expect((await response.json() as {error:string}).error).toMatch(/Only one load is allowed per project, even for a different date/);
      expect(state.project.customFields).toEqual(saved);
      expect(state.writes).toHaveLength(1);
      expect(state.audit).toHaveBeenCalledOnce();
    });
  });
  it("saves with historical edit permission without requiring Excel import rights, under a project lock",async()=>{
    state.importOp=false;
    const response=await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({applied:1});
    expect(state.locks).toBe(1);
    expect(state.writes[0].customFields.unrelated).toBe("preserved");
    expect(state.writes[0].customFields.qaqcDailyHistoricalSetup).toMatchObject({goLiveDate:"2025-09-19",data:zeroDailyOpening(),loadedById:"actor"});
    expect(state.audit).toHaveBeenCalledOnce();
    expect((await post()).status).toBe(409);
    expect(state.writes).toHaveLength(1);
  });
  it("retains import permission requirements on the Excel apply endpoint",async()=>{
    state.importOp=false;
    const {confirmed,...row}=input();
    expect((await post({confirmed,items:[{...row,rowNumber:3}]},"/apply")).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it("rejects missing historical edit rights and out-of-scope projects",async()=>{
    state.edit=false;expect((await post()).status).toBe(403);
    state.edit=true;state.inScope=false;expect((await post()).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it.each(["draft","submitted","approved","sent_back"])("blocks projects with %s Daily Submissions",async reportState=>{
    state.reports=[{state:reportState,period:"2025-09-19",deletedAt:null}];
    expect((await post()).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it("blocks retained prior load history even without project metadata",async()=>{
    state.logs=[{id:"prior-load"}];
    expect((await post()).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it("validates confirmation, calendar cutoff, future cutoff, reason and counts before writing",async()=>{
    for(const change of [{confirmed:false},{goLiveDate:"2025-02-30"},{goLiveDate:"2999-01-01"},{reason:""}]){
      expect((await post({...input(),...change})).status).toBe(422);
    }
    const invalid=input();invalid.data.correspondence.incoming=-1;
    expect((await post(invalid)).status).toBe(422);
    expect(state.writes).toHaveLength(0);
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("returns the same complete source field catalogue used by Excel for manual entry",async()=>{
    const response=await fetch(`${base}/projects`);
    expect(response.status).toBe(200);
    const body=await response.json() as {fields:unknown[];items:unknown[]};
    expect(body.fields).toHaveLength(111);
    expect(body.items[0]).toMatchObject({id,loaded:false,blocked:false});
  });
});
