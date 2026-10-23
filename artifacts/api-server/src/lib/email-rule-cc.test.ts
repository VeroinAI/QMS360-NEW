import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import {
  auditUserWorkspaceRoles, lessonsUserWorkspaceRoles, userWorkspaceRoles,
  db, emailEventRules, users, auditWorkspaceRoles, lessonsWorkspaceRoles, workspaceRoles,
} from "@workspace/db";

const { enqueueEmail } = vi.hoisted(() => ({ enqueueEmail: vi.fn() }));
vi.mock("./email-queue", () => ({ enqueueEmail }));
import { resolveEmailRuleCc, resolveEmailRule, queueAuditApprovalEmail } from "./email-rules";
import { CreateEmailRuleBody } from "@workspace/api-zod";

const cc = [{ email: "cc@example.test", name: "Role member" }];
function databaseFor(app: string, rule?: any) {
  const predicates: Array<{ table: unknown; params: unknown[]; sql: string }> = [];
  const assignments = app === "audit" ? auditUserWorkspaceRoles : app === "lessons" ? lessonsUserWorkspaceRoles : userWorkspaceRoles;
  const select = vi.fn(() => {
    let table: unknown;
    const chain: any = {
      from(t: unknown) { table = t; return chain; },
      innerJoin() { return chain; },
      where(condition: any) {
        predicates.push({ table, ...new PgDialect().sqlToQuery(condition) });
        return table === emailEventRules ? chain : Promise.resolve(table === assignments ? [{ userId: "member" }] : table === users ? cc : []);
      },
      orderBy: async () => rule ? [rule] : [],
    };
    return chain;
  });
  return { database: { select } as unknown as typeof db, predicates, select };
}

describe("Email Rule CC roles", () => {
  beforeEach(() => { vi.clearAllMocks(); enqueueEmail.mockResolvedValue({ queued: 1 }); });

  it("preserves CC role configuration through the API validator", () => {
    const body = CreateEmailRuleBody.parse({
      name: "CC rule", enabled: true, priority: 1, eventType: "lessons.lesson_form.approve",
      recipientMode: "linked_creator", recipientConfig: { ccRoleNames: ["Reviewer", "Manager"] },
    });
    expect(body.recipientConfig?.ccRoleNames).toEqual(["Reviewer", "Manager"]);
  });

  it.each(["lessons", "audit", "qaqc"])("resolves only active tenant-scoped %s role members", async app => {
    const { database, predicates } = databaseFor(app);
    expect(await resolveEmailRuleCc(database, { organizationId: "tenant-one", app }, { ccRoleNames: [" Reviewer ", "Reviewer"] })).toEqual(cc);
    const roleQuery = predicates[0]!;
    expect(roleQuery.params).toContain("Reviewer");
    expect(roleQuery.params.filter(value => value === "Reviewer")).toHaveLength(1);
    expect(roleQuery.params.filter(value => value === "tenant-one")).toHaveLength(3);
    expect(roleQuery.params.filter(value => value === "active")).toHaveLength(3);
    expect(roleQuery.sql.match(/"deleted_at" is null/g)).toHaveLength(3);
    expect(predicates[1]!.params).toContain("member");
    expect(predicates[1]!.params).toContain("tenant-one");
  });

  it("does not query for legacy/empty CC configuration or unsupported apps", async () => {
    const { database, select } = databaseFor("audit");
    for (const config of [undefined, {}, { ccRoleNames: [] }]) {
      expect(await resolveEmailRuleCc(database, { organizationId: "tenant-one", app: "audit" }, config)).toEqual([]);
    }
    expect(await resolveEmailRuleCc(database, { organizationId: "tenant-one", app: "other" }, { ccRoleNames: ["Manager"] })).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps To recipients unchanged while resolving a generic rule's CC roles", async () => {
    const rule = {
      enabled: true, eventType: "qaqc.metric.approve", recipientMode: "external_email",
      receiverEmail: "to@example.test", receiverName: "Recipient",
      recipientConfig: { ccRoleNames: ["Reviewer"] },
    };
    const { database } = databaseFor("qaqc", rule);
    const resolved = await resolveEmailRule(database, { organizationId: "tenant-one", app: "qaqc", entityType: "metric", action: "approve" });
    expect(resolved.recipients).toEqual([{ email: "to@example.test", name: "Recipient" }]);
    expect(resolved.ccRecipients).toEqual(cc);
  });

  it.each(["submit", "approve", "approved_final", "send_back"] as const)("adds explicitly configured CC roles to protected Audit %s emails", async action => {
    const rule = { id: "rule", enabled: true, eventType: `audit.audit_schedule.${action}`, recipientConfig: { ccRoleNames: ["Reviewer"] } };
    const { database } = databaseFor("audit", rule);
    await queueAuditApprovalEmail(database, {
      organizationId: "tenant-one", actorId: "actor", entityType: "audit_schedule", entityId: "schedule",
      action, recipientIds: ["workflow-to"], ccRecipientIds: ["existing-cc"], subject: "Notice", text: "Text",
    });
    expect(enqueueEmail).toHaveBeenCalledWith(database, expect.objectContaining({
      recipientIds: ["workflow-to"], ccRecipients: [...cc, ...cc],
    }));
    // The existing queue removes repeated addresses and To/CC overlap.
  });

  it("does not queue CC for a disabled approval rule", async () => {
    const { database } = databaseFor("audit", { enabled: false, eventType: "audit.audit_schedule.submit", recipientConfig: { ccRoleNames: ["Reviewer"] } });
    await queueAuditApprovalEmail(database, { organizationId: "tenant-one", actorId: "actor", entityType: "audit_schedule", entityId: "schedule", action: "submit", recipientIds: ["to"], subject: "Notice", text: "Text" });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});

function targetDatabase(results: Record<string, unknown>[][]) {
  const predicates: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const select = vi.fn(() => {
    const chain: any = {
      from() { return chain; }, innerJoin() { return chain; },
      where(condition: any) { predicates.push(new PgDialect().sqlToQuery(condition)); return chain; },
      orderBy() { return chain; }, limit() { return chain; },
      then(resolve: any, reject: any) { return Promise.resolve(results.shift() ?? []).then(resolve,reject); },
    };
    return chain;
  });
  return {database:{select} as unknown as typeof db,predicates,select};
}
describe("Explicit CC recipient modes",()=>{
  it("resolves an external CC address without querying users or changing Reply-To",async()=>{
    const {database,select}=targetDatabase([]);
    expect(await resolveEmailRuleCc(database,{organizationId:"tenant-one",app:"lessons"},
      {ccRecipient:{mode:"external_email",name:"Copy",email:"copy@example.test"}}))
      .toEqual([{name:"Copy",email:"copy@example.test"}]);
    expect(select).not.toHaveBeenCalled();
  });
  it.each([
    {mode:"internal_user",userId:"selected-user"},
    {mode:"all_users"},
    {mode:"project_members",projectIds:["selected-project"]},
    {mode:"workspace_role",roleNames:["Selected Role"]},
    {mode:"project_role",roleName:"Selected Role",projectIds:["selected-project"]},
  ])("resolves tenant-scoped active CC users using $mode",async target=>{
    const {database,predicates}=targetDatabase([cc]);
    expect(await resolveEmailRuleCc(database,{organizationId:"tenant-one",app:"lessons"},{ccRecipient:target})).toEqual(cc);
    expect(predicates[0]!.params).toContain("tenant-one");
    expect(predicates[0]!.params).toContain("active");
    expect(predicates[0]!.sql).toContain('"deleted_at" is null');
    if("userId" in target)expect(predicates[0]!.params).toContain("selected-user");
    if("projectIds" in target)expect(predicates[0]!.params).toContain("selected-project");
    if(target.mode.includes("role"))expect(predicates[0]!.params).toContain("Selected Role");
  });
  it.each(["audit","lessons","qaqc"])("resolves new workspace-role CC in the correct %s application",async app=>{
    const {database,predicates}=targetDatabase([cc]);
    await resolveEmailRuleCc(database,{organizationId:"tenant-one",app},{ccRecipient:{mode:"workspace_role",roleNames:["Reviewer"]}});
    const table=getTableConfig(app==="lessons"?lessonsWorkspaceRoles:app==="audit"?auditWorkspaceRoles:workspaceRoles);
    expect(predicates[0]!.sql).toContain(table.schema?`"${table.schema}"."${table.name}"`:`"${table.name}"`);
    expect(predicates[0]!.params.filter(value=>value==="tenant-one")).toHaveLength(3);
    expect(predicates[0]!.params.filter(value=>value==="active")).toHaveLength(3);
  });
  it("resolves the linked Lessons creator as CC without adopting the CC target's sender",async()=>{
    const {database}=targetDatabase([[{creatorEmail:"creator@example.test",creatorName:"Creator"}],[{email:"actor@example.test",name:"Actor"}]]);
    expect(await resolveEmailRuleCc(database,{organizationId:"tenant-one",app:"lessons",entityType:"lesson_form",entityId:"form",actorId:"actor"},
      {ccRecipient:{mode:"linked_creator"}})).toEqual([{email:"creator@example.test",name:"Creator"}]);
  });
  it("resolves the linked Lessons approver as CC",async()=>{
    const {database}=targetDatabase([[{approverEmail:"approver@example.test",approverName:"Approver",creatorId:"creator"}],[{email:"creator@example.test",name:"Creator"}]]);
    expect(await resolveEmailRuleCc(database,{organizationId:"tenant-one",app:"lessons",entityType:"lesson_form",entityId:"form"},
      {ccRecipient:{mode:"linked_approver"}})).toEqual([{email:"approver@example.test",name:"Approver"}]);
  });
  it("preserves To and Reply-To when resolving a distinct CC target in a generic event",async()=>{
    const rule={recipientMode:"linked_creator",recipientConfig:{ccRecipient:{mode:"external_email",name:"CC",email:"copy@example.test"}},
      enabled:true,eventType:"lessons.lesson_form.approve"};
    const {database}=targetDatabase([[rule],[{creatorEmail:"creator@example.test",creatorName:"Creator"}],[{email:"actor@example.test",name:"Actor"}]]);
    const result=await resolveEmailRule(database,{organizationId:"tenant-one",app:"lessons",entityType:"lesson_form",action:"approve",entityId:"form",actorId:"actor"});
    expect(result.recipients).toEqual([{email:"creator@example.test",name:"Creator"}]);
    expect(result.sender).toEqual({email:"actor@example.test",name:"Actor"});
    expect(result.ccRecipients).toEqual([{email:"copy@example.test",name:"CC"}]);
  });
  it("adds an explicit CC mode to the protected Audit queue without replacing workflow participants",async()=>{
    enqueueEmail.mockClear();enqueueEmail.mockResolvedValue({queued:1});
    const {database}=targetDatabase([[{enabled:true,eventType:"audit.audit_schedule.approve",recipientMode:"workspace_role",
      recipientConfig:{ccRecipient:{mode:"external_email",name:"Copy",email:"copy@example.test"}}}]]);
    await queueAuditApprovalEmail(database,{organizationId:"tenant-one",actorId:"reviewer",entityType:"audit_schedule",entityId:"schedule",action:"approve",
      recipientIds:["next-reviewer"],subject:"Review",text:"Existing comments"});
    expect(enqueueEmail).toHaveBeenCalledWith(database,expect.objectContaining({recipientIds:["next-reviewer"],
      ccRecipients:[{email:"copy@example.test",name:"Copy"}],text:"Existing comments"}));
  });
});
