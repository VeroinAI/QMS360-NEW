import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditPlanAuditCriteriaItem, AuditPlanAuditMethodsItem } from "@workspace/api-client-react";
import { getFormDefinition, auditPlanReplayMatches } from "@workspace/field-controls";
import { PlanSelection } from "./plan-selection";

describe("Audit Plan selection fields", () => {
  it("uses the exact requested fixed options", () => {
    expect(Object.values(AuditPlanAuditMethodsItem)).toEqual(["Interviews", "Observation of activities", "Sample-based review of records", "Site / store walk-down", "Supplier or third-party verification"]);
    expect(Object.values(AuditPlanAuditCriteriaItem)).toEqual(["ISO 9001:2015", "ISO 45001:2018", "ISO/IEC 17025:2017", "Client specifications (e.g. PTS, SOW)", "Project Quality Plan", "Company procedures: [list]", "Approved drawings and specifications"]);
  });
  it("shows all saved values in a labelled, wrapping, read-only control", () => {
    const html = renderToStaticMarkup(<PlanSelection id="criteria" number={9} label="Audit Criteria"
      options={Object.values(AuditPlanAuditCriteriaItem)} value={["ISO 45001:2018", "Approved drawings and specifications"]}
      onChange={() => {}} disabled required={false}/>);
    expect(html).toContain("9. Audit Criteria");
    expect(html).toContain('aria-label="Audit Criteria"');
    expect(html).toContain("disabled");
    expect(html).toContain("ISO 45001:2018, Approved drawings and specifications");
    expect(html).toContain("whitespace-normal");
    expect(html).not.toContain("truncate");
    expect(html).toContain('aria-required="false"');
  });
  it("registers both administrator-controllable fields and displays required errors accessibly", () => {
    expect(getFormDefinition("audit", "plan")?.fields.map(field => field.key)).toEqual(expect.arrayContaining(["auditMethods", "auditCriteria"]));
    const html = renderToStaticMarkup(<PlanSelection id="methods" number={8} label="Audit Method"
      options={Object.values(AuditPlanAuditMethodsItem)} value={[]} onChange={() => {}} disabled={false}
      required error="Choose a method"/>);
    expect(html).toContain("8. Audit Method *");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="methods-error"');
    expect(html).toContain("Choose a method");
  });
  it("keeps the two questions directly after Audit Type and consistently shifts later questions", () => {
    const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
    const ordered = ["7. Audit Type", 'id="auditMethods" number={8}', 'id="auditCriteria" number={9}',
      "10. Audit Language", "11. QA/QC References", "12. Description of Audit",
      'number={13} label="Start Date & Time"', 'number={14} label="End Date & Time"',
      'number={15} label="Opening Meeting"', 'number={16} label="Closing Meeting"',
      "17. Activity Details", "18. Audit Plan Circulation"];
    const positions = ordered.map(text => source.indexOf(text));
    expect(positions.every(at => at >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it("does not acknowledge stale offline selections and treats empty legacy data and reordered selections consistently", () => {
    expect(auditPlanReplayMatches({}, { auditMethods: [], auditCriteria: [] })).toBe(true);
    expect(auditPlanReplayMatches({ auditMethods: ["Interviews", "Observation of activities"] },
      { auditMethods: ["Observation of activities", "Interviews"] })).toBe(true);
    for (const field of ["auditMethods", "auditCriteria"]) {
      expect(auditPlanReplayMatches({ [field]: ["value"] }, { [field]: [] })).toBe(false);
    }
  });
});
