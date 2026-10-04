import { describe, expect, it } from "vitest";
import { pendingQaqcRequests } from "./qaqc-access-requests";

const member = { id: "person", username: "test.user", fullName: "Test User", email: "test@example.invalid",
  roleId: "role", projectIds: ["project"], businessUnitIds: [], updatedAt: new Date("2026-10-04") };
const access = (values = {}) => ({
  id: "access", username: member.username, organizationId: "org", projectId: null,
  canOpenQaqc: false, canOpenLessons: true, canOpenAudit: true,
  isInitialAdminQaqc: false, isInitialAdminLessons: false, isInitialAdminAudit: false,
  applicationReviews: {},
  status: "active", createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"), deletedAt: null, ...values,
});
describe("QA/QC access request recovery", () => {
  it("queues a role assignment even when an existing active row only grants other apps", () => {
    const record = access();
    const requests = pendingQaqcRequests([record], [member], () => true);
    expect(requests[0]).toMatchObject({ id: "missing:person", persistedId: "access", requestedRoleId: "role", status: "pending" });
    expect(record).toMatchObject({ canOpenQaqc: false, canOpenLessons: true, canOpenAudit: true, status: "active" });
  });
  it("queues existing assignments with no application-access row without granting access", () => {
    expect(pendingQaqcRequests([], [member], () => true)[0]?.id).toBe("missing:person");
  });
  it("does not queue already approved users", () => {
    expect(pendingQaqcRequests([access({ canOpenQaqc: true })], [member], () => true)).toEqual([]);
  });
  it("keeps rejection until a role is explicitly assigned again", () => {
    const rejected = access({ status: "rejected", applicationReviews: { qaqc: { status: "rejected" as const, reviewedAt: "2026-10-05T00:00:00Z" } }, updatedAt: new Date("2026-10-05") });
    expect(pendingQaqcRequests([rejected], [member], () => true)).toEqual([]);
    expect(pendingQaqcRequests([rejected], [{ ...member, updatedAt: new Date("2026-10-06") }], () => true)).toHaveLength(1);
  });
  it("deduplicates multiple assigned roles", () => {
    expect(pendingQaqcRequests([], [member, { ...member, roleId: "second" }], () => true)).toHaveLength(1);
  });
  it("keeps access approval within the administrator's project scope", () => {
    expect(pendingQaqcRequests([], [member], () => false)).toEqual([]);
    expect(pendingQaqcRequests([], [member], projects => projects.includes("project"))).toHaveLength(1);
  });
  it("preserves explicitly pending records, including imported requests awaiting a role", () => {
    const request = access({ status: "pending" });
    expect(pendingQaqcRequests([request], [member], () => true)[0]?.id).toBe("access");
    expect(pendingQaqcRequests([request], [], () => true)[0]?.id).toBe("access");
  });
});
