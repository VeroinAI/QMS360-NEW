type Snapshot = Record<string, unknown>;
const object = (value: unknown): Snapshot => value && typeof value === "object" && !Array.isArray(value) ? value as Snapshot : {};
const text = (value: unknown) => value == null ? null : Array.isArray(value) ? value.map(String).join(", ") : String(value);
function metadata(row: Snapshot): Snapshot {
  if (typeof row.status !== "string") return {};
  try { return object(JSON.parse(row.status)); } catch { return {}; }
}
const labels: Record<string, string> = {
  title: "Title", year: "Year", workflowState: "Status", projectId: "Project ID", ownerId: "Owner ID",
  fromDate: "Schedule From Date", toDate: "Schedule To Date", teamLeadIds: "Audit Team Lead IDs",
  projectIds: "Project IDs", auditTypes: "Audit type", auditCategory: "Audit category",
  departmentProject: "Department / project", location: "Location", processProductOwner: "Process / product owner",
  plannedStartDate: "Audit From Date", plannedEndDate: "Audit To Date",
  auditNumber: "Audit number", qaqcReference: "QA/QC reference", qaqcScope: "QA/QC scope", qaqcClauses: "QA/QC clauses",
  remarks: "Remarks", reviewComments: "Review comments", submissionReference: "Submission reference",
  submissionFrom: "Submission From", submissionTo: "Submission To", submissionSubject: "Submission subject",
  submissionMailBody: "Submission memo", memoDescription: "Memo description", memoCirculation: "Memo circulation",
  feasibilityDecision: "Feasibility decision", feasibilityFeedback: "Feasibility feedback",
  l1ReviewStatus: "L1 review status", l1ReviewComments: "L1 review comments",
  l2ReviewStatus: "L2 review status", l2ReviewComments: "L2 review comments",
  fileName: "Attachment filename", mimeType: "Attachment type", sizeBytes: "Attachment size (bytes)",
};
const topLevel = new Set(["title", "year", "workflowState", "projectId", "ownerId", "fileName", "mimeType", "sizeBytes"]);
function fields(row: Snapshot) {
  const meta = metadata(row);
  return Object.fromEntries(Object.keys(labels).map(key => [key, text(topLevel.has(key) ? row[key] : meta[key])]));
}
function status(row: Snapshot) {
  const value = text(row.workflowState);
  const meta = metadata(row);
  const role = Array.isArray(meta.approvalRoles) ? object(meta.approvalRoles[Number(meta.approvalIndex ?? 0)]).name : null;
  return value ? value.replaceAll("_", " ") + (value === "submitted" && role ? ` — ${role}` : "") : null;
}
/** Expose business changes only, never raw snapshots containing private paths or signatures. */
export function scheduleActivityEntry(entry: {
  id: string; actorId: string | null; action: string; entityType: string; entityId: string | null;
  before: unknown; after: unknown; createdAt: Date;
}, actorName?: string, fallbackTitle?: string) {
  const before = object(entry.before); const after = object(entry.after);
  const context = object(after._auditContext);
  const priorFields = fields(before); const nextFields = fields(after);
  const hasAfter = Object.keys(after).some(key => !key.startsWith("_"));
  const changes = Object.keys(labels).filter(key => {
    // Old delete events contain only a "before" snapshot; do not manufacture a mass field-clear.
    return hasAfter && nextFields[key] !== priorFields[key];
  }).map(key => ({ field: key, label: labels[key]!, before: priorFields[key] ?? null, after: nextFields[key] ?? null }));
  const beforeMeta = metadata(before); const afterMeta = metadata(after);
  const approvalRole = Array.isArray(beforeMeta.approvalRoles)
    ? text(object(beforeMeta.approvalRoles[Number(beforeMeta.approvalIndex ?? 0)]).name) : null;
  const action = entry.action === "submit" && before.workflowState === "sent_back" ? "resubmit" : entry.action;
  return {
    id: entry.id, actorId: entry.actorId,
    actorName: text(context.actorName) ?? actorName ?? (entry.actorId ? "User unavailable" : "System"),
    action, recordId: entry.entityId ?? "",
    recordTitle: text(after.title ?? before.title ?? after.fileName ?? before.fileName) ?? fallbackTitle ?? "Audit schedule record",
    recordKind: (entry.entityType === "audit_programme" ? "programme" : entry.entityType === "evidence" ? "attachment" : "audit") as "programme" | "audit" | "attachment",
    occurredAt: entry.createdAt.toISOString(), previousStatus: status(before), status: entry.action === "delete" ? "deleted" : hasAfter ? status(after) : status(before),
    remarks: text(context.reason) ?? (/approve|send_back|cancel|reschedule/.test(entry.action) ? text(afterMeta.reviewComments ?? afterMeta.feasibilityFeedback) : null)
      ?? (entry.action === "approve" && approvalRole ? `Approval recorded at ${approvalRole}` : null),
    requestId: text(context.requestId), changes,
  };
}