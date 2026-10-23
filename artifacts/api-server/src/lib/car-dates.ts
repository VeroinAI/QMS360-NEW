/** Calendar-day deadlines, measured from CAR creation (not response submission).
 * Unspecified classifications must not silently inherit a different type's SLA.
 */
export function carDueDate(classification: unknown, createdAt: unknown, storedDate?: string | null): string | null {
  const type = typeof classification === "string" ? classification.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const days = ({ "major nc": 2, "minor nc": 3, ofi: 4 } as Record<string, number>)[type];
  if (days === undefined) return storedDate?.slice(0, 10) || null;
  const date = createdAt instanceof Date ? createdAt : typeof createdAt === "string" ? new Date(createdAt) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (name: string) => parts.find(part => part.type === name)!.value;
  const result = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function hasSavedCarResponse(car: { workflowState?: string; rootCause?: string | null; correction?: string | null; correctiveAction?: string | null }) {
  return Boolean(car.rootCause?.trim() || car.correction?.trim() || car.correctiveAction?.trim()
    || ["draft", "submitted", "rejected", "accepted", "closed"].includes(car.workflowState ?? ""));
}
