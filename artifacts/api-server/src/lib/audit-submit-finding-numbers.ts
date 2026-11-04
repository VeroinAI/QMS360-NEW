import { numberedFindingTypes, type NumberedFindingType, type allocateFindingNumber } from "./audit-finding-numbering";

type Row = Record<string, any>;
type IssuedNumber = Awaited<ReturnType<typeof allocateFindingNumber>>;

export function unnumberedFindingType(row: Row): NumberedFindingType | null {
  if (typeof row.findingNumber === "string" && row.findingNumber.trim()) return null;
  const type = row.auditFinding || row.result;
  return numberedFindingTypes.includes(type as NumberedFindingType) ? type as NumberedFindingType : null;
}

/** Call inside the submission transaction; allocation is sequential, never parallel. */
export async function numberSubmittedFindings<T extends Row>(
  rows: T[], allocate: (type: NumberedFindingType) => Promise<IssuedNumber>,
): Promise<T[]> {
  const result: T[] = [];
  for (const row of rows) {
    const type = unnumberedFindingType(row);
    result.push(type ? { ...row, ...await allocate(type) } : row);
  }
  return result;
}
