/** Calendar-day deadlines measured from the explicitly recorded Finding Date.
 * Unspecified classifications must not silently inherit a different type's SLA.
 */
export function validFindingDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Checklist state is authoritative; evidence retains dates for standalone findings. */
export function findingDateValue(item?: { findingDate?: unknown } | null, finding?: { evidence?: unknown } | null): unknown {
  return item ? item.findingDate : (finding?.evidence as { findingDate?: unknown } | undefined)?.findingDate;
}

export function carDueDate(classification: unknown, findingDate: unknown, storedDate?: string | null): string | null {
  const type = typeof classification === "string" ? classification.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const days = ({ "major nc": 2, "minor nc": 3, ofi: 4 } as Record<string, number>)[type];
  if (days === undefined) return storedDate?.slice(0, 10) || null;
  // Historical records retain their saved deadline until their actual finding
  // date is entered. Never substitute CAR creation time for a missing date.
  if (!validFindingDate(findingDate)) return storedDate?.slice(0, 10) || null;
  const result = new Date(`${findingDate}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function hasSavedCarResponse(car: { workflowState?: string; rootCause?: string | null; correction?: string | null; correctiveAction?: string | null }) {
  return Boolean(car.rootCause?.trim() || car.correction?.trim() || car.correctiveAction?.trim()
    || ["draft", "submitted", "rejected", "accepted", "closed"].includes(car.workflowState ?? ""));
}
