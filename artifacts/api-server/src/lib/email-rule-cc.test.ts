import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  auditUserWorkspaceRoles, lessonsUserWorkspaceRoles, userWorkspaceRoles,
  db, emailEventRules, users,
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
