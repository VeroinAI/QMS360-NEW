// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_FINDING_FILTERS, filterFindingRows, findingFilterOptions, type FindingRegisterItem } from "./finding-register";
import { FINDING_COLUMNS, FindingRegisterTable } from "./finding-register-view";

afterEach(cleanup);

const row = (o: Partial<FindingRegisterItem>): FindingRegisterItem => ({
  id: "r", source: "checklist", auditExecutionId: "a1", findingNumber: null, auditId: null, auditTitle: "Site A",
  projectDepartment: null, clauseReference: null, auditArea: null, description: null, findingType: null, riskLevel: null,
  auditTeamLeadId: null, auditTeamLeadName: null, actionTakers: [], ...o,
});
const rows = [
  row({ id: "1", auditTitle: "Site A", riskLevel: "High", auditTeamLeadId: "u1", auditTeamLeadName: "Sam", actionTakers: [{ id: "t1", name: "Lee" }, { id: "t2", name: "Lee" }] }),
  row({ id: "2", auditTitle: "Site B", findingType: "Major NC", auditTeamLeadId: "u2", auditTeamLeadName: "Sam", description: "Calibration overdue", actionTakers: [{ id: "t2", name: "Lee" }] }),
];

describe("finding register filtering", () => {
  it("combines filters on saved values and matches any action taker", () => {
    expect(filterFindingRows(rows, { ...EMPTY_FINDING_FILTERS, actionTaker: "t2" }).map(r => r.id)).toEqual(["1", "2"]);
    expect(filterFindingRows(rows, { ...EMPTY_FINDING_FILTERS, actionTaker: "t2", auditTeamLead: "u2" }).map(r => r.id)).toEqual(["2"]);
    expect(filterFindingRows(rows, { ...EMPTY_FINDING_FILTERS, riskLevel: "High" }).map(r => r.id)).toEqual(["1"]);
    expect(filterFindingRows(rows, { ...EMPTY_FINDING_FILTERS, search: "calibration" }).map(r => r.id)).toEqual(["2"]);
  });
  it("builds options only from saved values and disambiguates duplicate names by id", () => {
    const o = findingFilterOptions(rows);
    expect(o.riskLevels.map(x => x.value)).toEqual(["High"]);
    expect(o.findingTypes.map(x => x.value)).toEqual(["Major NC"]);
    expect(o.leads.map(x => x.value).sort()).toEqual(["u1", "u2"]);
    expect(new Set(o.leads.map(x => x.label)).size).toBe(2);
    expect(new Set(o.actionTakers.map(x => x.label)).size).toBe(2);
  });
});

describe("finding register scrolling", () => {
  it("uses the accessible region as the single direct scroll owner", () => {
    render(<FindingRegisterTable rows={[]} canOpenAudit={false}/>);
    const region = screen.getByRole("region", { name: "Audit finding register" });
    const table = region.querySelector(":scope > table");
    expect(table).not.toBeNull();
    expect(region.querySelectorAll("div")).toHaveLength(0);
    expect(region.className).toContain("overflow-x-auto");
    expect(region.tabIndex).toBe(0);
    expect(table?.className).toContain("min-w-[1600px]");
    expect(screen.getAllByRole("columnheader").map(h => h.textContent)).toEqual(FINDING_COLUMNS);
  });
});
