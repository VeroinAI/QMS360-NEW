export type ChecklistDeletionFields = {
  auditFinding?: string | null;
  result?: string | null;
  evidenceIds?: string[] | null;
  source?: string;
};

/** Keep the row-button rule and server deletion guard identical. */
export function checklistDeletionBlockReason(item: ChecklistDeletionFields): string | null {
  if (item.source === "finding") return "Finding-only records cannot be deleted from the Checklist.";
  if (item.auditFinding?.trim() || item.result?.trim()) {
    return "This checklist item cannot be deleted because Audit Findings has been recorded.";
  }
  if (item.evidenceIds?.length) {
    return "This checklist item cannot be deleted because Evidence has been attached.";
  }
  return null;
}
