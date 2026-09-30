import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueEmail } = vi.hoisted(() => ({ enqueueEmail: vi.fn() }));
vi.mock("./email-queue", () => ({ enqueueEmail }));

import { auditProgrammeFinalRoleOverride, configuredWorkspaceRoleNames, queueAuditApprovalEmail, resolveEmailRule } from "./email-rules";
import { db, emailEventRules, auditUserWorkspaceRoles } from "@workspace/db";

function fakeDatabase(rule: any, roleUsers: Array<{ userId: string }> = []) {
  return {
    select: () => {
      let table: unknown;
      const query: any = {
        from(value: unknown) { table = value; return query; },
        innerJoin() { return query; },
        where() {
          return table === emailEventRules
            ? query
            : Promise.resolve(table === auditUserWorkspaceRoles ? roleUsers : []);
        },
        orderBy() {
          return Promise.resolve(table === emailEventRules ? (rule ? [rule] : []) : table === auditUserWorkspaceRoles ? roleUsers : []);
        },
      };
      return query;
    },
  } as unknown as typeof db;
}

describe("email rule workspace role recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueEmail.mockResolvedValue({ queued: 1 });
  });

  it("reads multiple role names and remains compatible with legacy roleName", () => {
    expect(configuredWorkspaceRoleNames({ roleNames: [" Auditor ", "Reviewer", "Auditor"] }))
      .toEqual(["Auditor", "Reviewer"]);
    expect(configuredWorkspaceRoleNames({ roleName: "Auditor" })).toEqual(["Auditor"]);
    expect(configuredWorkspaceRoleNames({ roleName: "Auditor", roleNames: ["Reviewer"] }))
      .toEqual(["Reviewer", "Auditor"]);
  });

  it("limits role-based approval override to enabled Programme final approval rules", () => {
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.approved_final", { enabled: true, recipientMode: "workspace_role" })).toBe(true);
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.submit", { enabled: true, recipientMode: "workspace_role" })).toBe(false);
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.approve", { enabled: true, recipientMode: "workspace_role" })).toBe(false);
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.send_back", { enabled: true, recipientMode: "workspace_role" })).toBe(false);
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.approved_final", { enabled: true, recipientMode: "all_users" })).toBe(false);
    expect(auditProgrammeFinalRoleOverride("audit.audit_programme.approved_final", { enabled: false, recipientMode: "workspace_role" })).toBe(false);
  });

  it("replaces only final Programme approval recipients with users assigned selected Audit roles", async () => {
    const database = fakeDatabase({
      id: "rule-1",
      eventType: "audit.audit_programme.approved_final",
      enabled: true,
      recipientMode: "workspace_role",
      recipientConfig: { roleNames: ["Auditor", "Quality Manager"] },
    }, [{ userId: "role-user-1" }, { userId: "role-user-2" }, { userId: "role-user-1" }]);

    await queueAuditApprovalEmail(database, {
      organizationId: "org-1",
      actorId: "actor-1",
      entityType: "audit_programme",
      entityId: "programme-1",
      action: "approved_final",
      recipientIds: ["workflow-participant"],
      subject: "Final approval",
      text: "Approved",
    });

    expect(enqueueEmail).toHaveBeenCalledWith(database, expect.objectContaining({
      organizationId: "org-1",
      recipientIds: ["role-user-1", "role-user-2"],
    }));
  });

  it("resolves generic workspace_role rules across selected roles and deduplicates recipients by email", async () => {
    const rule = {
      id: "rule-2",
      eventType: "audit.audit_finding.create",
      enabled: true,
      priority: 0,
      createdByUserId: null,
      recipientMode: "workspace_role",
      recipientConfig: { roleNames: ["Auditor", "Quality Manager"] },
    };
    const database = {
      select: () => {
        let table: unknown;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          innerJoin() { return query; },
          where() {
            return table === emailEventRules
              ? query
              : Promise.resolve([
                { email: "reviewer@example.com", name: "Reviewer" },
                { email: "REVIEWER@example.com", name: "Reviewer duplicate" },
                { email: "manager@example.com", name: "Manager" },
              ]);
          },
          orderBy() { return Promise.resolve([rule]); },
        };
        return query;
      },
    } as unknown as typeof db;

    const result = await resolveEmailRule(database, {
      organizationId: "org-1",
      app: "audit",
      entityType: "audit_finding",
      action: "create",
    });

    expect(result.rule).toBe(rule);
    expect(result.recipients).toEqual([
      { email: "REVIEWER@example.com", name: "Reviewer duplicate" },
      { email: "manager@example.com", name: "Manager" },
    ]);
  });

  it.each([
    ["audit_schedule", "approved_final", "workspace_role"],
    ["audit_programme", "submit", "workspace_role"],
    ["audit_programme", "approve", "workspace_role"],
    ["audit_programme", "send_back", "workspace_role"],
    ["audit_programme", "approved_final", "all_users"],
  ] as const)("retains workflow recipients for %s %s with mode %s", async (entityType, action, recipientMode) => {
    const database = fakeDatabase({
      id: "rule-1",
      eventType: `audit.${entityType}.${action}`,
      enabled: true,
      recipientMode,
      recipientConfig: { roleNames: ["Auditor"] },
    }, [{ userId: "role-user" }]);

    await queueAuditApprovalEmail(database, {
      organizationId: "org-1",
      actorId: "actor-1",
      entityType,
      entityId: "record-1",
      action,
      recipientIds: ["workflow-participant"],
      subject: "Notice",
      text: "Notice",
    });

    expect(enqueueEmail).toHaveBeenCalledWith(database, expect.objectContaining({
      recipientIds: ["workflow-participant"],
    }));
  });
});