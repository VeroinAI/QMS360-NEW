import type { AuditSchedule } from "@workspace/api-client-react";

/** Only children of the selected New Schedule can be selected for a new plan. */
export function eligiblePlanAudits(schedules: AuditSchedule[], programmeId: string) {
  if (!programmeId) return [];
  return schedules.filter(schedule =>
    schedule.parentId === programmeId
    && !schedule.hasPlan
    && schedule.feasibilityDecision !== "cancelled");
}

/** Fetch every page rather than silently omitting options beyond the first page. */
export async function loadPlanOptionPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await fetchPage(page);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error("Audit options could not be fully loaded. Please retry.");
  }
}