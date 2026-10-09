import { randomUUID } from "node:crypto";

type Item = Record<string, any>;
export class ChecklistImportError extends Error {}

/** The three visible identity columns, not a workbook's optional hidden ID. */
function checklistKey(item: Item): string | undefined {
  const parts = [item.clause, item.auditArea, item.question];
  if (parts.some(value => typeof value !== "string" || !value.trim())) return undefined;
  return JSON.stringify(parts.map(value => value.trim()));
}

/**
 * Merge one audit's workbook without replacing IDs, evidence or finding links.
 * Repeated keys in the workbook update the same row; the last row's values win.
 * Existing duplicate records are retained, never deleted by an import.
 */
export function mergeAuditChecklistImport(
  existing: Item[], rows: Item[],
  values: (row: Item, evidenceIds: string[]) => Item,
  createId: () => string = randomUUID,
) {
  const checklist = [...existing];
  const byId = new Map(existing.map(item => [item.id, item]));
  const byKey = new Map<string, number>();
  existing.forEach((item, index) => {
    const key = checklistKey(item);
    if (item.source !== "finding" && key && !byKey.has(key)) byKey.set(key, index);
  });
  const matches = rows.map((item, index) => {
    const referenced = item.id ? byId.get(item.id) : undefined;
    if (item.id && !referenced) throw new ChecklistImportError(`Row ${index + 2}: Checklist item is not in this audit`);
    if (referenced?.source === "finding") {
      throw new ChecklistImportError(`Row ${index + 2}: finding-only rows cannot be imported as checklist items`);
    }
    const key = checklistKey(item);
    if (!key) throw new ChecklistImportError(`Row ${index + 2}: Clause, Audit Area and Audit Question are required`);
    const target = byKey.get(key);
    const previous = target === undefined ? undefined : checklist[target];
    const updated = previous
      ? { ...previous, ...values(item, previous.evidenceIds ?? []) }
      : { id: createId(), ...values(item, []) };
    if (target === undefined) {
      byKey.set(key, checklist.length);
      checklist.push(updated);
    } else {
      checklist[target] = updated;
    }
    return { item, previous, index };
  });
  return { checklist, matches };
}
