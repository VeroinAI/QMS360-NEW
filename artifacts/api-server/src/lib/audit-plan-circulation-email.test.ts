import { afterEach, describe, expect, it, vi } from "vitest";
import { auditPlans, auditUserWorkspaceRoles, db, emailEventRules } from "@workspace/db";
import { dispatchEmailRule, resolveAuditPlanCirculation, resolveEmailRule } from "./email-rules";
import { enqueueEmail } from "./email-queue";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("./email-queue", () => ({ enqueueEmail: vi.fn() }));
const roleId = "00000000-0000-4000-8000-000000000002";
const event = { organizationId: "00000000-0000-4000-8000-000000000001", app: "audit", entityType: "audit_plan", action: "send_for_audit", entityId: roleId };
const member = { email: "circulation@example.com", name: "Circulation member" };
function database(options: { rule?: object; status?: string; members?: typeof member[]; missing?: boolean } = {}) {
  const queries: Array<{ table: unknown; condition: any }> = [];
  const select = vi.fn(() => {
    let table: unknown;
    const q: any = {
      from(value: unknown) { table = value; return q; },
      innerJoin() { return q; },
      where(condition: unknown) {
        queries.push({ table, condition });
        if (table === emailEventRules) return q;
        return Promise.resolve(table === auditPlans ? options.missing ? [] : [{ status: options.status ?? JSON.stringify({ circulationRoleIds: [roleId] }) }]
          : table === auditUserWorkspaceRoles ? options.members ?? [member] : []);
      },
      orderBy() { return Promise.resolve(options.rule ? [options.rule] : []); },
    };
    return q;
  });
  return { connection: { select } as unknown as typeof db, queries };
}
describe("Audit Plan send circulation email", () => {
  afterEach(() => vi.restoreAllMocks());
  it("queues the circulation email without inventing attachments when no custom rule exists", async () => {
    const { connection } = database();
    vi.spyOn(db, "select").mockImplementation(connection.select);
    vi.mocked(enqueueEmail).mockResolvedValue({ queued: 1 });
    await dispatchEmailRule(event);
    expect(enqueueEmail).toHaveBeenCalledWith(db, expect.objectContaining({
      recipients: [member], ruleTemplate: undefined,
      context: expect.objectContaining({ eventType: "audit.audit_plan.send_for_audit", entityId: event.entityId }),
    }));
    expect(vi.mocked(enqueueEmail).mock.calls.at(-1)?.[1].attachments).toBeUndefined();
  });
  it("adds saved circulation members to existing rule To recipients and preserves CC", async () => {
    const { connection } = database({ rule: { id: roleId, enabled: true, eventType: "audit.audit_plan.send_for_audit",
      recipientMode: "external_email", receiverEmail: "rule@example.com", recipientConfig: {
        ccRecipient: { mode: "external_email", email: "cc@example.com" }, reportAttachment: "audit_plan_pdf",
      } } });
    const result = await resolveEmailRule(connection, event);
    expect(result.recipients.map(user => user.email)).toEqual(["rule@example.com", member.email]);
    expect(result.ccRecipients?.map(user => user.email)).toEqual(["cc@example.com"]);
    expect(result.rule?.recipientConfig).toMatchObject({ reportAttachment: "audit_plan_pdf" });
  });
  it("deduplicates recipients across circulation roles and rule To", async () => {
    const { connection } = database({ members: [member, { ...member, email: member.email.toUpperCase() }],
      rule: { enabled: true, eventType: "audit.audit_plan.send_for_audit", recipientMode: "external_email", receiverEmail: member.email } });
    expect((await resolveEmailRule(connection, event)).recipients).toHaveLength(1);
  });
  it("delivers to saved circulation when no custom rule exists", async () => {
    expect((await resolveEmailRule(database().connection, event)).recipients).toEqual([member]);
  });
  it("respects an explicitly disabled send rule", async () => {
    const { connection } = database({ rule: { enabled: false, eventType: "audit.audit_plan.send_for_audit" } });
    expect((await resolveEmailRule(connection, event)).recipients).toEqual([]);
  });
  it.each(["Draft", "null", "{}", '{"auditPlanCirculation":"Historical text"}', '{"circulationRoleIds":["invalid"]}'])("does not guess roles from legacy or malformed metadata %s", async status => {
    expect(await resolveAuditPlanCirculation(database({ status }).connection, event)).toEqual([]);
  });
  it("retains tenant, role and user active/deleted constraints", async () => {
    const { connection, queries } = database();
    await resolveAuditPlanCirculation(connection, event);
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(queries.find(query => query.table === auditUserWorkspaceRoles)!.condition);
    expect(query.params).toContain(roleId);
    expect(query.params.filter(value => value === event.organizationId)).toHaveLength(3);
    expect(query.params.filter(value => value === "active")).toHaveLength(3);
    expect(query.sql.match(/deleted_at/g)).toHaveLength(3);
  });
  it("leaves other event recipients unchanged", async () => {
    const { connection, queries } = database();
    expect((await resolveEmailRule(connection, { ...event, action: "update" })).recipients).toEqual([]);
    expect(queries.some(query => query.table === auditPlans)).toBe(false);
  });
});
