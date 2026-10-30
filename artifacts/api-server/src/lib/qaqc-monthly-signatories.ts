import type { QaqcReportExport } from "./qaqc-reporting-export";

type Signatory = { name: string; at: string; final: boolean };
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? value as Record<string, any> : {};
const time = (value: unknown) => new Date(String(value ?? "")).getTime();

/** Only completed actions in the current submission cycle are signatories.
 * Assigned candidates and earlier, sent-back cycles are not approvals.
 */
export function monthlySignatories(report: QaqcReportExport): Signatory[] {
  const workflow = object(report.baseline.__monthlyApproval);
  const audit = report.history ?? [];
  const names = new Map(audit.filter(e => typeof e.actorId === "string" && typeof e.actorName === "string")
    .map(e => [e.actorId as string, e.actorName as string]));
  if (workflow.version === 1 && Array.isArray(workflow.history) && Array.isArray(workflow.stages)) {
    const events = workflow.history.filter((e: any) =>
      e.cycle === workflow.cycle && e.decision === "approve" && Number.isFinite(time(e.at)))
      .sort((a: any, b: any) => time(a.at) - time(b.at));
    const finalLevel = workflow.stages.at(-1)?.level;
    return events.map((event: any) => {
      const candidate = workflow.stages.flatMap((s: any) => s.candidates ?? [])
        .find((c: any) => c.id === event.userId);
      return {
        name: names.get(event.userId) ?? candidate?.name ?? "Former or unavailable user",
        at: event.at,
        final: report.state === "approved" && event.level === finalLevel,
      };
    });
  }
  // Legacy single-level reports have no workflow snapshot. Require a real
  // approval audit entry after the latest submission, never an assigned user.
  const submittedAt = time(report.submittedAt);
  return audit.filter(entry => entry.action === "approve" &&
    Number.isFinite(time(entry.createdAt)) &&
    (!Number.isFinite(submittedAt) || time(entry.createdAt) >= submittedAt))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .map(entry => ({
      name: typeof entry.actorName === "string" ? entry.actorName : "Former or unavailable user",
      at: String(entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt),
      final: report.state === "approved" && object(entry.after).state === "approved",
    }));
}
