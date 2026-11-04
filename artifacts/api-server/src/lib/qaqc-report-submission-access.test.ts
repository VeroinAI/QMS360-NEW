import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("../middlewares/rbac", () => ({ getAuthorizedProjectScope: mocks.scope }));
import { assertReportSubmissionAccess } from "./qaqc-report-submission-access";
const req = () => ({ currentUser: { id: "submitter" } }) as Request;
const report = (reportType = "monthly") => ({ reportType, projectId: "project-a", createdById: "contributor" });
beforeEach(() => { mocks.scope.mockReset(); mocks.scope.mockResolvedValue({ unrestricted: false, projectIds: ["project-a"] }); });
describe("Shared monthly report submission authorization", () => {
  it("allows a non-creator with Monthly Reports submit permission for the project", async () => {
    const request = req();
    await expect(assertReportSubmissionAccess(request, report())).resolves.toBeUndefined();
    expect(mocks.scope).toHaveBeenCalledWith(request, "qaqc", { module: "monthly_reports", action: "own", operation: "submit" });
  });
  it("allows an organization-wide Monthly Reports submit role", async () => {
    mocks.scope.mockResolvedValue({ unrestricted: true, projectIds: [] });
    await expect(assertReportSubmissionAccess(req(), report())).resolves.toBeUndefined();
  });
  it.each([{projectIds:[]}, {projectIds:["project-b"]}])("rejects absent or unrelated submit scope %j even for a creator", async ({projectIds}) => {
    mocks.scope.mockResolvedValue({ unrestricted: false, projectIds });
    await expect(assertReportSubmissionAccess(req(), report())).rejects.toMatchObject({ status: 403 });
    await expect(assertReportSubmissionAccess(req(), { ...report(), createdById: "submitter" })).rejects.toMatchObject({ status: 403 });
  });
  it("does not borrow an unrestricted read/edit scope from the request", async () => {
    const request = req();
    request.permissionProjectScope = { unrestricted: true, projectIds: [] };
    mocks.scope.mockResolvedValue({ unrestricted: false, projectIds: [] });
    await expect(assertReportSubmissionAccess(request, report())).rejects.toMatchObject({ status: 403 });
  });
  it.each(["daily", "csat"])("retains the creator-only policy for %s", async type => {
    await expect(assertReportSubmissionAccess(req(), report(type))).rejects.toMatchObject({ status: 403, message: "Only the report creator may submit this report" });
    await expect(assertReportSubmissionAccess(req(), { ...report(type), createdById: "submitter" })).resolves.toBeUndefined();
  });
});
