import type { CarRegisterEntry, CarRegisterOption, CarRegisterPage, ListCarRegisterParams } from "@workspace/api-client-react";

export type CarRegisterRow = CarRegisterEntry;
export type CarRegisterPageWithOptions = CarRegisterPage;

export const CAR_FILTERS = [
  { key: "carNumber", label: "CAR Number", option: "carNumbers", testId: "car-number" },
  { key: "auditTitle", label: "Audit Title", option: "auditTitles", testId: "audit-title" },
  { key: "projectDepartment", label: "Project/Department", option: "projectDepartments", testId: "project-department" },
  { key: "findingType", label: "Audit Finding", option: "auditFindings", testId: "audit-finding" },
  { key: "riskLevel", label: "Risk Level", option: "riskLevels", testId: "risk-level" },
  { key: "actionTakerId", label: "Action Taker", option: "actionTakers", testId: "action-taker" },
  { key: "status", label: "CAR Status", option: "statuses", testId: "status" },
] as const;

export type CarFilterKey = typeof CAR_FILTERS[number]["key"];
export type CarFilterState = Record<CarFilterKey, string>;
export const ALL = "all";
export const EMPTY_CAR_FILTERS: CarFilterState = Object.fromEntries(CAR_FILTERS.map(f => [f.key, ALL])) as CarFilterState;

export type CarRegisterParams = ListCarRegisterParams;

/** Build server params: only selected filters are sent; pagination/legacy always sent. */
export function buildCarRegisterParams(filters: CarFilterState, page: number, limit: number, includeLegacy: boolean): CarRegisterParams {
  const params: CarRegisterParams = { page, limit, includeLegacy };
  for (const { key } of CAR_FILTERS) if (filters[key] && filters[key] !== ALL) params[key] = filters[key];
  return params;
}

export const filterOptions = (data: CarRegisterPageWithOptions | undefined, option: typeof CAR_FILTERS[number]["option"]): CarRegisterOption[] =>
  data?.[option] ?? [];
