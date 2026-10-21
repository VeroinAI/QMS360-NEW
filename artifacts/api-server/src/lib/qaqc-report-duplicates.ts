import { db, projects, qaqcReportSubmissions } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { HttpError } from "./workspace";

const PERIOD_INDEX = "qaqc_report_project_type_period_active_idx";
type Reader = Pick<typeof db, "select">;

/** Only disclose existence/status, not another creator's report data or identity. */
export async function monthlyDuplicateReason(organizationId: string, projectId: string, period: string, reader: Reader = db) {
  const [existing] = await reader.select({ state: qaqcReportSubmissions.state }).from(qaqcReportSubmissions).where(and(
    eq(qaqcReportSubmissions.organizationId, organizationId),
    eq(qaqcReportSubmissions.projectId, projectId),
    eq(qaqcReportSubmissions.reportType, "monthly"),
    eq(qaqcReportSubmissions.period, period),
    isNull(qaqcReportSubmissions.deletedAt),
  )).limit(1);
  return existing ? monthlyDuplicateMessage(period, existing.state) : null;
}

export function monthlyDuplicateMessage(period: string, state: string) {
  const month = new Date(`${period.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const labels: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", sent_back: "Sent back" };
  const status = labels[state] ?? state.replace(/_/g, " ").replace(/^./, s => s.toUpperCase());
  return `A monthly QA/QC report already exists for this project for ${month}. Report status: ${status}. Open the existing report from QA/QC Metrics; another report cannot be created for the same project and month.`;
}

export async function assertNoMonthlyDuplicate(organizationId: string, projectId: string, period: string, reader: Reader = db) {
  const reason = await monthlyDuplicateReason(organizationId, projectId, period, reader);
  if (reason) throw new HttpError(409, reason);
}

/** Call inside the creation transaction; all creators share this project lock. */
export async function lockMonthlyCreation(organizationId: string, projectId: string, period: string, transaction: Reader) {
  await transaction.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, organizationId),
  )).for("update");
  await assertNoMonthlyDuplicate(organizationId, projectId, period, transaction);
}

/** Drizzle wraps the PostgreSQL code/constraint inside cause, not message. */
export function isReportPeriodDuplicate(error: unknown) {
  const seen = new Set<object>();
  for (let depth = 0; error && typeof error === "object" && depth < 20 && !seen.has(error); depth++) {
    seen.add(error);
    const item = error as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (item.code === "23505" && item.constraint === PERIOD_INDEX) return true;
    if (!item.cause && (!item.code || item.code === "23505") && typeof item.message === "string" &&
        item.message.includes(PERIOD_INDEX) && /duplicate key|unique constraint/i.test(item.message)) return true;
    error = item.cause;
  }
  return false;
}
