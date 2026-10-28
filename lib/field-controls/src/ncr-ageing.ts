type AgeingRow = { department?: unknown; bucket?: unknown } | null | undefined;
const departmentKey = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

export function ncrAgeingBucketUsed(rows: AgeingRow[], index: number, department: unknown, bucket: unknown): boolean {
  const key = departmentKey(department);
  return !!key && typeof bucket === "string" && !!bucket
    && rows.some((row, other) => other !== index && departmentKey(row?.department) === key && row?.bucket === bucket);
}

/** External and Internal NCR each have their own independent ageing breakdown. */
export function duplicateNcrAgeingRows(rows: AgeingRow[]) {
  const seen = new Map<string, number>();
  const duplicates: Array<{ index: number; firstIndex: number }> = [];
  rows.forEach((row, index) => {
    const department = departmentKey(row?.department);
    if (!department || !["0-15", "15-45", "over45"].includes(String(row?.bucket))) return;
    const key = JSON.stringify([department, row?.bucket]);
    const firstIndex = seen.get(key);
    if (firstIndex === undefined) seen.set(key, index);
    else duplicates.push({ index, firstIndex });
  });
  return duplicates;
}
