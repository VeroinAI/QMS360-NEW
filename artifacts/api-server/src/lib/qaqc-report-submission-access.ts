import type { Request } from "express";
import { getAuthorizedProjectScope } from "../middlewares/rbac";
import { HttpError } from "./workspace";

/** Monthly preparation and submission may be performed by different scoped users. */
export async function assertReportSubmissionAccess(req: Request, report: {
  reportType: string; projectId: string; createdById: string;
}) {
  if (report.reportType !== "monthly" && report.createdById !== req.currentUser!.id)
    throw new HttpError(403, "Only the report creator may submit this report");
  const modules: Record<string, string> = { monthly: "monthly_reports", daily: "daily_reports", csat: "csat_reports" };
  const module = modules[report.reportType];
  if (!module) throw new HttpError(422, "Invalid report type");
  const scope = await getAuthorizedProjectScope(req, "qaqc", { module, action: "own", operation: "submit" });
  if (!req.permissionAdminBypass && !scope.unrestricted && !scope.projectIds.includes(report.projectId))
    throw new HttpError(403, "Submit permission is required for this report type and project");
}
