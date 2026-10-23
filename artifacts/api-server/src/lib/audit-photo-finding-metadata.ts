type Row = Record<string, any>;
const isFinding = (row: Row) => ["Major NC", "Moderate NC", "Minor NC", "OFI"].includes(row.auditFinding);

/** A checklist's insertion time is not necessarily its finding's creation time.
 * Read only retained transitions into a finding; never infer from later edits,
 * CAR creation, evidence timestamps or the audit's creation date.
 */
export function findingCreationDates(events: Row[]): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const event of [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
    const before = event.before?.checklistState;
    const after = event.after?.checklistState;
    if (!Array.isArray(after) || !Array.isArray(before)) continue;
    for (const item of after) {
      if (!item.id || !isFinding(item) || result.has(item.id)) continue;
      const previous = before.find((row: Row) => row.id === item.id);
      if (!previous || !isFinding(previous)) result.set(item.id, event.createdAt);
    }
  }
  return result;
}
