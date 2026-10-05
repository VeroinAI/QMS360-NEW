import type { AuditPlanActivity } from "@workspace/api-client-react";

export function newPlanActivity(): AuditPlanActivity {
  return { id: crypto.randomUUID(), section: "", remarks: "", auditeeId: "" };
}

/** Master selections copy remarks only; they must never reset entered dates or auditees. */
export function selectPlanActivity(
  rows: AuditPlanActivity[], id: string, section: string, defaultRemarks: string, remarksLocked: boolean,
): AuditPlanActivity[] {
  return rows.map(row => row.id === id
    ? { ...row, section, remarks: remarksLocked ? row.remarks : defaultRemarks }
    : row);
}