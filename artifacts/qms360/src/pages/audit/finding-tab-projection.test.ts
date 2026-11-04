import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "@workspace/api-client-react";
import type { FindingRegisterItem } from "./finding-register";
import { FINDING_TAB_COLUMNS, FINDING_TAB_FILTERS, projectFindingTab } from "./finding-tab-projection";

const reg = (o: Partial<FindingRegisterItem>): FindingRegisterItem => ({
  id: "x", source: "checklist", auditExecutionId: "a1", findingNumber: null, auditId: null, auditTitle: "Old title",
  projectDepartment: null, clauseReference: null, auditArea: null, description: null, findingType: null, riskLevel: null,
  auditTeamLeadId: null, auditTeamLeadName: null, actionTakers: [], ...o,
});
const item = (o: Partial<ChecklistItem>) => ({ id: "i1", clause: "7.1", auditFinding: "Major NC", ...o }) as ChecklistItem;

describe("audit findings tab projection", () => {
  it("shows the newly saved risk before register metadata is refreshed", () => {
    const rows = projectFindingTab({
      auditId: "a1", auditTitle: "Audit",
      items: [item({ riskLevel: "High" })],
      registerRows: [reg({ id: "checklist:a1:i1", riskLevel: "Low" })],
    });
    expect(rows[0]?.reg.riskLevel).toBe("High");
  });
  it("keeps the requested 11 columns first and exposes exactly 7 filters", () => {
    expect(FINDING_TAB_COLUMNS.slice(0, 11)).toEqual(["Finding ID", "Audit ID", "Audit Title", "Project/Department", "Clause Reference", "Audit Area", "Description", "Finding Type", "Risk Level", "Audit Team Lead", "Action Taker"]);
    expect(FINDING_TAB_COLUMNS.slice(11)).toEqual(["Finding Date", "Evidence", "Recommended priority actions"]);
    expect(FINDING_TAB_FILTERS.map(f => f[1])).toEqual(["Audit Title", "Project/Department", "Audit Area", "Finding Type", "Risk Level", "Audit Team Lead", "Action Taker"]);
  });
  it("merges same-audit metadata while current item fields and assignee win", () => {
    const rows = projectFindingTab({ auditId: "a1", auditTitle: "Live", items: [item({ actionTakerId: "u2", description: "new" })], registerRows: [
      reg({ id: "checklist:a1:i1", auditId: "AUD-7", riskLevel: "High", projectDepartment: "Tower B", auditTeamLeadId: "L", auditTeamLeadName: "Lena", description: "stale", actionTakers: [{ id: "u1", name: "Old" }] }),
    ] });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.kind).toBe("current");
    expect(r.reg).toMatchObject({ auditId: "AUD-7", riskLevel: "High", projectDepartment: "Tower B", auditTeamLeadName: "Lena", description: "new", findingType: "Major NC" });
    expect(r.reg.actionTakers.map(a => a.id)).toEqual(["u2"]);
  });
  it("ignores cross-audit rows, orphan metadata and N/A items; never borrows other audit context", () => {
    const rows = projectFindingTab({ auditId: "a1", auditTitle: "Live", items: [item({}), item({ id: "na", auditFinding: "Not applicable" })], registerRows: [
      reg({ id: "checklist:a1:i1", auditExecutionId: "a2", riskLevel: "High", auditId: "AUD-9" }),
      reg({ id: "checklist:a1:gone", riskLevel: "Low" }),
      reg({ id: "legacy:z", source: "legacy", auditExecutionId: "a2" }),
    ] });
    expect(rows.map(r => r.key)).toEqual(["i1"]);
    expect(rows[0].reg).toMatchObject({ auditId: null, riskLevel: null, auditTitle: "Live", auditTeamLeadName: null, projectDepartment: null });
  });
  it("keeps same-audit legacy rows as read-only legacy kind", () => {
    const rows = projectFindingTab({ auditId: "a1", auditTitle: "Live", items: [], registerRows: [reg({ id: "legacy:1", source: "legacy", findingNumber: "F-1" })] });
    expect(rows).toEqual([expect.objectContaining({ kind: "legacy", key: "legacy:1" })]);
    expect("item" in rows[0]).toBe(false);
  });
});
