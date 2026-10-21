import { describe,it,expect,vi,beforeAll,afterAll,beforeEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { historicalFields } from "../lib/qaqc-historical-balances";

const state=vi.hoisted(()=>({scope:{unrestricted:false,projectIds:[] as string[]},project:null as any,reports:[] as any[],writes:[] as any[],audit:vi.fn()}));
vi.mock("../middlewares/auth",()=>({requireAuth:(req:any,_:any,next:any)=>{req.currentUser={id:"actor",organizationId:"org"};next();}}));
vi.mock("../middlewares/rbac",()=>({
  requireAppAccess:()=> (_:any,__:any,next:any)=>next(),
  requirePermission:()=> (_:any,__:any,next:any)=>next(),
  getAuthorizedProjectScope:async()=>state.scope,
}));
vi.mock("./qaqc-reporting",()=>({historyBaseline:async()=>({baseline:{metrics:{external_ncr:{accumulatedIssued:25,accumulatedClosed:10}}},previous:null}),legacyBaseline:async()=>({})}));
vi.mock("../lib/workspace",()=>({
  HttpError:class extends Error{constructor(public status:number,message:string){super(message);}},
  asyncHandler:(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next),
  writeAuditLog:(...args:any[])=>state.audit(...args),
}));
vi.mock("@workspace/db",async importOriginal=>{
  const actual=await importOriginal<any>();
  const database:any={
    select:()=>{
      let table:any;
      const query:any={from:(t:any)=>{table=t;return query;},where:()=>query,orderBy:()=>query,leftJoin:()=>query,limit:()=>query,for:()=>query,
        then:(resolve:any,reject:any)=>Promise.resolve(table===actual.projects?[state.project]:table===actual.qaqcReportSubmissions?state.reports:[]).then(resolve,reject)};
      return query;
    },
    update:(table:any)=>({set:(value:any)=>({where:async()=>{state.writes.push({table,value});return [];}})}),
    transaction:async(fn:any)=>fn(database),
  };
  return {...actual,db:database};
});
import router from "./qaqc-historical-balances";
const id="11111111-1111-4111-8111-111111111111";
const input=()=>({projectId:id,period:"2026-10-01",version:0,reason:"Validated historical opening balances",
  balances:Object.fromEntries(historicalFields.map(f=>[f.key,f.key.endsWith("Closed")?70:100]))});
const app=express();app.use(express.json());app.use(router);
app.use((err:any,_:any,res:any,__:any)=>res.status(err.status??500).json({error:err.message}));
const server=createServer(app);let base="";
beforeAll(async()=>{await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as any).port}`;});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{state.scope={unrestricted:false,projectIds:[id]};state.project={id,name:"Example",customFields:{unrelated:"preserve",qaqcReporting:{reportingStartDate:"2026-10-01"}}};state.reports=[];state.writes=[];state.audit.mockReset();});
const put=(body:unknown=input())=>fetch(`${base}/historical-balances`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
describe("Historical setup API transaction guards",()=>{
  it("rejects out-of-scope project reads and writes",async()=>{
    state.scope.projectIds=[];
    expect((await fetch(`${base}/historical-balances?projectId=${id}&period=2026-10-01`)).status).toBe(403);
    expect((await put()).status).toBe(403);
    expect(state.writes).toHaveLength(0);expect(state.audit).not.toHaveBeenCalled();
  });
  it("saves all balances, preserves unrelated metadata and records complete old/new values",async()=>{
    const response=await put();
    expect(response.status).toBe(200);expect(await response.json()).toEqual({version:1,updatedDrafts:0});
    const fields=state.writes[0].value.customFields;
    expect(fields.unrelated).toBe("preserve");
    expect(fields.qaqcReporting.reportingStartDate).toBe("2026-10-01");
    expect(fields.qaqcReporting.historicalBalances["2026-10-01"].balances).toEqual(input().balances);
    expect(state.audit).toHaveBeenCalledTimes(1);
    const audit=state.audit.mock.calls[0]![2];
    expect(audit.before.balances["metrics.external_ncr.accumulatedIssued"]).toBe(25);
    expect(audit.after.balances["metrics.external_ncr.accumulatedIssued"]).toBe(100);
    expect(audit.after.reason).toBe(input().reason);
  });
  it("recalculates affected drafts without changing their entered movements or metric targets",async()=>{
    state.reports=[{id:"draft",period:"2026-10-01",state:"draft",submittedAt:null,data:{metrics:{external_ncr:{issued:12,closed:5}}},computed:{metrics:{external_ncr:{target:85}}}}];
    const response=await put();
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({updatedDrafts:1});
    const update=state.writes[0].value;
    expect(update.data).toBeUndefined();
    expect(update.baseline.metrics.external_ncr).toEqual({accumulatedIssued:100,accumulatedClosed:70});
    expect(update.computed.metrics.external_ncr).toMatchObject({issued:12,closed:5,accumulatedIssued:112,accumulatedClosed:75,target:85});
  });
  it.each(["submitted","approved","sent_back"])("blocks %s history before writing anything",async stateName=>{
    state.reports=[{id:"locked",period:"2026-11-01",state:stateName,submittedAt:new Date()}];
    const response=await put();expect(response.status).toBe(409);
    expect(state.writes).toHaveLength(0);expect(state.audit).not.toHaveBeenCalled();
  });
  it("rejects stale setup versions without partial draft or settings writes",async()=>{
    state.project.customFields.qaqcReporting.historicalBalances={"2026-10-01":{...input(),version:2}};
    expect((await put()).status).toBe(409);expect(state.writes).toHaveLength(0);expect(state.audit).not.toHaveBeenCalled();
  });
  it("rejects corrections incompatible with current draft closures atomically",async()=>{
    state.reports=[{id:"draft",period:"2026-10-01",state:"draft",submittedAt:null,data:{metrics:{external_ncr:{issued:0,closed:1000}}},computed:{}}];
    expect((await put()).status).toBe(422);expect(state.writes).toHaveLength(0);expect(state.audit).not.toHaveBeenCalled();
  });
  it("does not accept a derived PQI value or incomplete balance payload",async()=>{
    const body=input();body.balances["pqi.previous"]=80;expect((await put(body)).status).toBe(422);
    delete body.balances["pqi.previous"];delete body.balances["qtbt.accumulatedTalkCount"];
    expect((await put(body)).status).toBe(422);expect(state.writes).toHaveLength(0);
  });
});
