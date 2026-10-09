export const projectProgressPhases = [
  ["project-preparation", "Project Preparation"],
  ["engineering-design", "Engineering & Design"],
  ["equipment-material", "Equipment & Material"],
  ["construction", "Construction"],
  ["installation", "Installation"],
  ["testing-commissioning-energization", "Testing, Commissioning & Energization"],
  ["project-close-out", "Project Close-out"],
] as const;

export type ProjectProgressInput = {
  id: string;
  weight?: number | null;
  plan?: number | null;
  actual?: number | null;
  priorPeriod?: number | null;
  remarks?: string | null;
};

export function projectProgressVariance(plan?: number | null, actual?: number | null): number | null {
  return plan == null || actual == null ? null : Number((actual - plan).toFixed(10));
}

export function projectProgressTotalWeight(rows: ProjectProgressInput[]): number {
  return Number(rows.reduce((sum, row) => sum + (row.weight ?? 0), 0).toFixed(10));
}

// Compare decimal weights exactly, including fractional/exponential inputs.
// Floating-point summation must neither reject exactly 100% nor allow >100%.
function weightsExceed100(rows: ProjectProgressInput[]): boolean {
  const parts = rows.map(row => {
    const [mantissa, exponent = "0"] = String(row.weight ?? 0).split("e");
    const decimals = mantissa.split(".")[1]?.length ?? 0;
    const scale = decimals - Number(exponent);
    const digits = BigInt(mantissa.replace(".", ""));
    return scale < 0 ? { digits: digits * 10n ** BigInt(-scale), scale: 0 } : { digits, scale };
  });
  const scale = Math.max(...parts.map(part => part.scale));
  const total = parts.reduce((sum, part) => sum + part.digits * 10n ** BigInt(scale - part.scale), 0n);
  return total > 100n * 10n ** BigInt(scale);
}

/** Authoritative validation and computation; never accept client variance or phase labels. */
export function normalizeProjectProgress(rows: ProjectProgressInput[]) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!projectProgressPhases.some(([id]) => id === row.id) || ids.has(row.id)) {
      throw new Error("Each project phase must be listed once using a valid phase.");
    }
    ids.add(row.id);
    for (const field of ["weight", "plan", "actual", "priorPeriod"] as const) {
      const value = row[field];
      const maximum = field === "weight" ? 100 : 1_000_000_000;
      if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum)) {
        throw new Error(`${field === "weight" ? "Weight" : field} must be a non-negative number up to ${maximum}${field === "weight" ? "%" : ""}.`);
      }
    }
  }
  if (ids.size !== projectProgressPhases.length) throw new Error("Enter all seven project phases.");
  if (weightsExceed100(rows)) throw new Error("Total Weight must be less than or equal to 100%.");
  return projectProgressPhases.map(([id, phase]) => {
    const row = rows.find(value => value.id === id)!;
    return {
      id, phase, weight: row.weight ?? null, plan: row.plan ?? null, actual: row.actual ?? null,
      variance: projectProgressVariance(row.plan, row.actual), priorPeriod: row.priorPeriod ?? null,
      remarks: row.remarks?.trim() ?? "",
    };
  });
}
