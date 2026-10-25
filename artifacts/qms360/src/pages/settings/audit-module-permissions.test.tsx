import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { auditModuleGroups, auditModulePermissionCatalog, auditModulePermissionMatches, auditModuleReadMatches } from "@workspace/field-controls";
import { AuditModulePermissions } from "./audit-module-permissions";

describe("Audit module controls", () => {
  it("renders all module controls with a saved grant checked", () => {
    const html = renderToStaticMarkup(<AuditModulePermissions permissions={[
      { key: "audit.plans.view_all", name: "Plans view" },
    ]} onToggle={() => {}}/>);
    for (const group of auditModuleGroups) expect(html).toContain(group.label.replaceAll("&", "&amp;"));
    for (const permission of auditModulePermissionCatalog) expect(html).toContain(`permission-${permission.key}`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="permission-audit.plans.view_all"|data-testid="permission-audit.plans.view_all"[^>]*aria-checked="true"/);
  });
  it("never treats one module or action as another", () => {
    expect(auditModuleReadMatches("audit.plans.view_all", "plans")).toBe(true);
    expect(auditModuleReadMatches("audit.plans.view_all", "audits")).toBe(false);
    expect(auditModuleReadMatches("audit.plans.create_edit", "plans")).toBe(false);
    expect(auditModulePermissionMatches("audit.schedules.create_edit", "plans", "create_edit")).toBe(false);
    expect(auditModulePermissionMatches("audit_program_manager", "schedules", "create_edit")).toBe(false);
  });
  it("requires a module for a global approval grant and offers independent schedule and report choices", () => {
    const html = renderToStaticMarkup(<AuditModulePermissions permissions={[
      { key: "approve_reject", name: "Approve / reject" },
    ]} onToggle={() => {}}/>);
    expect(html).toContain("Approval applies to *");
    expect(html).toContain("Select an approval module before saving this role.");
    expect(html).toContain("approval-module-audit.schedules.approve_reject");
    expect(html).toContain("approval-module-audit.audits.approve_reject");
  });
  it("accepts report-only approval without implicitly selecting scheduling", () => {
    const html = renderToStaticMarkup(<AuditModulePermissions permissions={[
      { key: "audit.audits.approve_reject", name: "Report approval" },
    ]} onToggle={() => {}}/>);
    expect(html).not.toContain("Select an approval module before saving this role.");
    expect(html).toMatch(/data-testid="approval-module-audit.audits.approve_reject"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="approval-module-audit.audits.approve_reject"/);
    expect(html).toMatch(/data-testid="approval-module-audit.schedules.approve_reject"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-testid="approval-module-audit.schedules.approve_reject"/);
  });
});