import { formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import type { AuditReportApprovalState } from "./audit-report-approval";
import type { ReportSectionData } from "./audit-consolidated-report";

export type AuditReportSigner = { userId?: string; name: string; at?: string };
export type AuditPptxSignoff = { prepared: AuditReportSigner; reviewed: AuditReportSigner[]; approved?: AuditReportSigner;
  history: Array<{ level: number; decision: string; name: string; at: string; remarks: string }> };

/** Only actual decisions in the current report submission cycle can sign this report. */
export function auditPptxSignoff(input: {
  leadId?: string | null; completedAt?: string | null; approval?: AuditReportApprovalState;
}, names: Map<string, string>): AuditPptxSignoff {
  const state = input.approval;
  const history = state?.history ?? [];
  const submitted = Date.parse(state?.submittedAt ?? "");
  const lastReturn = history.map(row => row.decision).lastIndexOf("send_back");
  const approvals = history.filter((row, index) => row.decision === "approve"
    && Number.isFinite(Date.parse(row.at))
    && (Number.isFinite(submitted) ? Date.parse(row.at) >= submitted : index > lastReturn))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const finalLevel = state?.steps?.at(-1)?.level;
  const final = state?.status === "Approved"
    ? approvals.filter(row => finalLevel == null || row.level === finalLevel).at(-1) : undefined;
  const signer = (row: typeof approvals[number]): AuditReportSigner => ({
    userId: row.userId, name: row.userName?.trim() || names.get(row.userId) || "-", at: row.at,
  });
  return {
    prepared: { userId: input.leadId || undefined, name: names.get(input.leadId ?? "") || "-", at: input.completedAt || undefined },
    reviewed: approvals.filter(row => row !== final).map(signer),
    ...(final ? { approved: signer(final) } : {}),
    history: history.filter(row => Number.isFinite(Date.parse(row.at)))
      .map(row => ({ level: row.level, decision: row.decision,
        name: row.userName?.trim() || names.get(row.userId) || "-", at: row.at, remarks: row.remarks }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  };
}

export function applyAuditPptxSignoff(sections: ReportSectionData[], signoff: AuditPptxSignoff) {
  const conclusion = sections.find(section => section.key === "conclusion");
  if (!conclusion) throw new Error("Audit report conclusion section is missing");
  const date = (at?: string) => at && Number.isFinite(Date.parse(at)) ? formatDateInTimeZone(at, "Asia/Riyadh") : "-";
  const groups: Array<[string, AuditReportSigner[]]> = [
    ["Prepared by", [signoff.prepared]], ["Reviewed by", signoff.reviewed],
    ["Approved by", signoff.approved ? [signoff.approved] : []],
  ];
  const table = { title: "Sign-off", columns: ["Role", "Name", "Signature", "Date"],
    rows: groups.map(([role, people]) => [role, people.map(person => person.name).join("\n") || "-", "-",
      people.map(person => date(person.at)).join("\n") || "-"]) };
  conclusion.tables = [table];
  const control = sections.find(section => section.key === "document-control");
  if (control) {
    control.tables = [{ ...table, title: "Approval" }, {
      title: "Approval History", columns: ["Date", "Approval details", "By"],
      rows: signoff.history.map(row => [date(row.at),
        `L${row.level} — ${row.decision === "approve" ? "Approved" : row.decision === "send_back" ? "Sent back" : row.decision}`
          + (row.remarks?.trim() ? `\n${row.remarks.trim()}` : ""), row.name]),
    }];
    control.notes = [];
  }
  const issue = conclusion.fields.find(field => field.label === "Report issue date");
  if (issue) issue.value = date(signoff.approved?.at);
}
