import type { ReportType } from "./qaqc-reporting-model";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

// The six-section Metrics entry specifies manpower departments as free text.
// All other report department fields retain their existing master-data policy.
export function reportDepartmentReferences(type: ReportType, data: Record<string, unknown>): string[] {
  if (type !== "monthly") return [];
  const references: string[] = [];
  const collect = (value: unknown) => {
    for (const row of rows(value)) {
      const department = object(row).department;
      if (typeof department === "string" && department.trim()) references.push(department);
    }
  };
  if (data.manpowerDepartmentInput !== "text") collect(data.manpower);
  const metrics = object(data.metrics);
  for (const key of ["external_ncr", "internal_ncr"]) collect(object(metrics[key]).ageing);
  return references;
}