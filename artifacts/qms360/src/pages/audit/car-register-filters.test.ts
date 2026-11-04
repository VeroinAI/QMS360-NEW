import { describe, expect, it } from "vitest";
import { buildCarRegisterParams, CAR_FILTERS, EMPTY_CAR_FILTERS, filterOptions } from "./car-register-filters";

describe("CAR Register filter params", () => {
  it("sends only pagination and legacy when nothing is selected", () => {
    expect(buildCarRegisterParams(EMPTY_CAR_FILTERS, 1, 10, false)).toEqual({ page: 1, limit: 10, includeLegacy: false });
  });
  it("maps each selected filter to its server param", () => {
    const params = buildCarRegisterParams({ ...EMPTY_CAR_FILTERS, carNumber: "CAR-1", projectDepartment: "project:abc",
      findingType: "Major NC", riskLevel: "High", actionTakerId: "u1", status: "Open", auditTitle: "A1" }, 3, 10, true);
    expect(params).toEqual({ page: 3, limit: 10, includeLegacy: true, carNumber: "CAR-1", projectDepartment: "project:abc",
      findingType: "Major NC", riskLevel: "High", actionTakerId: "u1", status: "Open", auditTitle: "A1" });
  });
  it("defines exactly seven filters in the requested order and reads backend options only", () => {
    expect(CAR_FILTERS.map(f => f.label)).toEqual(["CAR Number", "Audit Title", "Project/Department", "Audit Finding", "Risk Level", "Action Taker", "CAR Status"]);
    expect(filterOptions(undefined, "riskLevels")).toEqual([]);
    expect(filterOptions({ riskLevels: [{ id: "High", name: "High" }] } as never, "riskLevels")).toEqual([{ id: "High", name: "High" }]);
  });
});
