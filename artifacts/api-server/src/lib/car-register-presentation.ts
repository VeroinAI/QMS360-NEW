type CarLandingEntry = {
  projectId?: string | null; department?: string | null; projectName?: string;
  classification: string; status: string; riskLevel?: string | null;
  actionTakerId?: string | null; actionTakerName: string;
  car?: { carNumber?: string | null };
};

export const carRegisterText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function carFindingDisplay(
  item: { findingNumber?: unknown; riskLevel?: unknown; auditArea?: unknown },
  finding?: { riskLevel?: unknown; evidence?: unknown },
) {
  const evidence = finding?.evidence && typeof finding.evidence === "object" && !Array.isArray(finding.evidence)
    ? finding.evidence as Record<string, unknown> : {};
  return {
    findingNumber: carRegisterText(item.findingNumber) || carRegisterText(evidence.findingNumber),
    riskLevel: carRegisterText(item.riskLevel) || carRegisterText(finding?.riskLevel),
    auditArea: carRegisterText(item.auditArea) || carRegisterText(evidence.auditArea) || "",
  };
}

/** Initial CAR assignment, not a guessed Finding Date or last-edit timestamp. */
export function carRegisterDates(car?: { createdAt?: Date | string | null; workflowState?: string; closedAt?: unknown }) {
  return {
    assignedAt: car?.createdAt ?? null,
    actualClosedAt: car?.workflowState === "closed" ? carRegisterText(car.closedAt) : null,
  };
}

export function carPendingWith(
  state: string, owner: string | null, lead: string | null, routed: boolean, eligibleNames: string[],
) {
  if (state === "closed") return null;
  if (state === "submitted") return routed
    ? [...new Set(eligibleNames.filter(Boolean))].join(", ") || "No eligible approver"
    : lead || "Reviewer unavailable";
  if (state === "extension_requested") return lead || "Reviewer unavailable";
  return owner || "Not assigned";
}

export const carProjectDepartmentKey = (entry: Pick<CarLandingEntry, "projectId" | "department">) =>
  entry.projectId ? `project:${entry.projectId}` : entry.department ? `department:${entry.department}` : null;

export function matchesCarLandingFilters(entry: CarLandingEntry, query: Record<string, unknown>) {
  return (!query.carNumber || entry.car?.carNumber === query.carNumber)
    && (!query.projectDepartment || carProjectDepartmentKey(entry) === query.projectDepartment)
    && (!query.findingType || entry.classification === query.findingType)
    && (!query.riskLevel || entry.riskLevel === query.riskLevel)
    && (!query.actionTakerId || entry.actionTakerId === query.actionTakerId);
}

export function carLandingOptions(entries: CarLandingEntry[]) {
  const options = (key: (entry: CarLandingEntry) => string | null | undefined, name = key) =>
    [...new Map(entries.flatMap(entry => {
      const id = key(entry);
      return id ? [[id, name(entry) || id] as const] : [];
    })).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    carNumbers: options(row => row.car?.carNumber),
    projectDepartments: options(carProjectDepartmentKey, row => row.department || row.projectName),
    auditFindings: options(row => row.classification),
    riskLevels: options(row => row.riskLevel),
    actionTakers: options(row => row.actionTakerId, row => row.actionTakerName),
    statuses: options(row => row.status),
  };
}
