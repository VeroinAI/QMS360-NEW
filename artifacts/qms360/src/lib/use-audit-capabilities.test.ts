import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuditCapabilities } from "./use-audit-capabilities";

const query = vi.hoisted(() => ({ data: { keys: [] as string[], administrator: false }, isError: false, isLoading: false }));
vi.mock("@workspace/api-client-react", () => ({
  getGetAuditCapabilitiesQueryKey: () => ["/api/audit/capabilities"],
  useGetAuditCapabilities: () => query,
}));
beforeEach(() => {
  query.data = { keys: [], administrator: false };
  query.isError = false;
});
describe("Audit module action capabilities", () => {
  it("keeps module View separate from changes and from other modules", () => {
    query.data.keys = ["audit.schedules.view_all", "audit.plans.view_all"];
    const access = useAuditCapabilities();
    expect(access.canRead("schedules")).toBe(true);
    for (const action of ["create_edit", "delete", "submit", "approve_reject", "export"] as const) {
      expect(access.can("schedules", action)).toBe(false);
    }
    expect(access.canRead("audits")).toBe(false);
  });
  it("recognizes each explicit action without implying other actions", () => {
    for (const action of ["create_edit", "delete", "submit", "approve_reject", "export"] as const) {
      query.data.keys = [`audit.schedules.${action}`];
      const access = useAuditCapabilities();
      expect(access.can("schedules", action)).toBe(true);
      expect(access.can("plans", action)).toBe(false);
      expect(access.canRead("schedules")).toBe(false);
    }
  });
  it("retains legacy additive grants while keeping data entry Schedule-only", () => {
    query.data.keys = ["data_entry"];
    const legacy = useAuditCapabilities();
    expect(legacy.can("schedules", "create_edit")).toBe(true);
    expect(legacy.can("plans", "create_edit")).toBe(false);
    expect(legacy.canCreateProgramme).toBe(false);
    query.data.keys = ["audit.schedules.create_edit"];
    expect(useAuditCapabilities().canCreateProgramme).toBe(true);
    query.data.keys = ["create_audit_programme"];
    expect(useAuditCapabilities().canCreateProgramme).toBe(true);
  });
  it("preserves administrator behavior but fails closed when controls cannot load", () => {
    query.data.administrator = true;
    expect(useAuditCapabilities().can("findings", "delete")).toBe(true);
    query.isError = true;
    expect(useAuditCapabilities().can("findings", "delete")).toBe(false);
  });
});
