import { describe, expect, it } from "vitest";
import { pendingApplicationRequests, type Access, type Application, type Member } from "./application-access-requests";

const apps: Application[] = ["qaqc", "lessons", "audit"];
const member: Member = { id: "user", username: "user", fullName: "User", email: "", roleId: "role",
  projectIds: ["managed"], businessUnitIds: [], updatedAt: new Date("2026-10-01") };
const access: Access = {
  id: "access", organizationId: "org", username: "user", projectId: null,
  canOpenQaqc: false, canOpenLessons: false, canOpenAudit: false,
  isInitialAdminQaqc: false, isInitialAdminLessons: false, isInitialAdminAudit: false,
  applicationReviews: {}, status: "pending", deletedAt: null,
  createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"),
};
describe("Application-specific review timestamps and scope", () => {
  for (const app of apps) {
    it(`${app}: unrelated updatedAt changes cannot hide a renewed request`, () => {
      const row = { ...access, updatedAt: new Date("2026-12-01"),
        applicationReviews: { [app]: { status: "rejected" as const, reviewedAt: "2026-10-02T00:00:00Z" } } };
      expect(pendingApplicationRequests(app, [row], [member], () => true)).toEqual([]);
      expect(pendingApplicationRequests(app, [row], [{ ...member, updatedAt: new Date("2026-10-03") }], () => true)).toHaveLength(1);
    });
    it(`${app}: an out-of-scope assignment cannot renew a rejection`, () => {
      const row = { ...access, applicationReviews: { [app]: { status: "rejected" as const, reviewedAt: "2026-10-02T00:00:00Z" } } };
      const outside = { ...member, projectIds: ["outside"], updatedAt: new Date("2026-10-03") };
      expect(pendingApplicationRequests(app, [row], [member, outside], ids => ids.includes("managed"))).toEqual([]);
    });
    it(`${app}: explicit project records cannot be bypassed by synthetic requests`, () => {
      expect(pendingApplicationRequests(app, [{ ...access, projectId: "outside" }], [member], ids => ids.includes("managed"))).toEqual([]);
    });
    it(`${app}: a synthetic shared record does not inherit the application's project`, () => {
      expect(pendingApplicationRequests(app, [], [member], ids => ids.includes("managed"))[0]!.projectId).toBeNull();
    });
  }
});