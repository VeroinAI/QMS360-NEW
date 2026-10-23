import { HttpError } from "./workspace";
import { numberedFindingTypes } from "./audit-finding-numbering";

type Row = Record<string, any>;
const numberKeys = ["findingNumber", "findingNumberScope", "findingNumberYear", "findingNumberSequence", "findingNumberType"] as const;

/** Numbering metadata is server-owned, including after a historical repair. */
export function preserveFindingNumber(input: Row, previous?: Row): Row {
  const clean = { ...input };
  for (const key of numberKeys) {
    delete clean[key];
    if (previous && previous[key] !== undefined) clean[key] = previous[key];
  }
  return clean;
}

export function findingForNumberRepair(checklist: Row[], itemId: string): Row {
  const item = checklist.find(row => row.id === itemId);
  if (!item) throw new HttpError(404, "Finding not found in this audit");
  if (!numberedFindingTypes.includes(item.auditFinding)) {
    throw new HttpError(422, "Only saved Minor NC, Moderate NC, Major NC or OFI findings can receive a finding number.");
  }
  return item;
}
