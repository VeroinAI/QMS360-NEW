type Finding = {
  id: string;
  classification: string;
  status?: string | null;
  evidence?: Record<string, unknown> | null;
};
type Car = { auditFindingId: string; workflowState: string };
type ChecklistFinding = { id?: string; auditFinding?: string; result?: string };

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();
const closed = (value: unknown) => ["closed", "verified"].includes(normalized(value));
const applicable = (value: unknown) => Boolean(normalized(value))
  && !["not applicable", "not_applicable", "n/a"].includes(normalized(value));

/** Current checklist findings and historical standalone findings count once per source. */
export function auditExecutionFindingCounts(checklist: unknown, findings: Finding[], cars: Car[]) {
  const items = (Array.isArray(checklist) ? checklist : []) as ChecklistFinding[];
  const carsByFinding = new Map<string, Car[]>();
  for (const car of cars) {
    const group = carsByFinding.get(car.auditFindingId) ?? [];
    group.push(car);
    carsByFinding.set(car.auditFindingId, group);
  }
  const isOpen = (linked: Finding[]) => {
    const responses = linked.flatMap(f => carsByFinding.get(f.id) ?? []);
    // An unfinished response keeps the finding open, even with an older closed snapshot.
    if (responses.length) return responses.some(car => !closed(car.workflowState));
    return !linked.length || linked.some(f => !closed(f.status));
  };
  let findingCount = 0, openFindingCount = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (!applicable(item.auditFinding || item.result) || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    findingCount++;
    if (isOpen(findings.filter(f => f.evidence?.sourceChecklistItemId === item.id))) openFindingCount++;
  }
  for (const finding of findings) {
    // Mirrors of deleted/not-applicable checklist sources are history, not new standalone findings.
    if (finding.evidence?.sourceChecklistItemId || !applicable(finding.classification)
      || normalized(finding.status) === "deleted") continue;
    findingCount++;
    if (isOpen([finding])) openFindingCount++;
  }
  return { findingCount, openFindingCount };
}
