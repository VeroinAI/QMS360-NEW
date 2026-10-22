import { describe, expect, it, vi } from "vitest";
import { auditDepartmentNumberSourceValue, auditProjectNumberSourceValue } from "./audit-number-source";
import { nextPlanNumber, planNumberSource, type PlanNumberState } from "./audit-plan-numbering";

vi.mock("./lov", () => ({ resolveMasterDataGroupId: vi.fn(async () => "department-group") }));

function readerFor(rows: Record<string, unknown>[]) {
  const query = Object.assign(Promise.resolve(rows), { limit: async () => rows });
  return { select: () => ({ from: () => ({ where: () => query }) }) } as unknown as Parameters<typeof planNumberSource>[0];
}

describe("Audit numbering master-field mapping", () => {
  it("uses Contract / project no., never Cost Center, Contractor or project code", () => {
    expect(auditProjectNumberSourceValue({
      costCentre: "OLD-COST-CENTER", code: "OLD-CODE",
      qmsAdditionalData: { contractProjectNumber: " 001-CTR/2026 ", contractor: "NOT-CONTRACT-NO" },
    })).toBe("001-CTR/2026");
  });
  it("uses Department Cost ID as text, preserving leading zeroes", () => {
    expect(auditDepartmentNumberSourceValue({ costId: " 0042 ", value: "Civil", label: "Civil Department" })).toBe("0042");
  });
  it.each([undefined, null, {}, { qmsAdditionalData: null }, { costCentre: "OLD" },
    { qmsAdditionalData: { contractProjectNumber: " " } }, { qmsAdditionalData: { contractProjectNumber: 42 } }])(
    "does not fall back when Contract / project no. is missing: %j", fields => {
      expect(auditProjectNumberSourceValue(fields)).toBe("");
    });
  it.each([undefined, null, {}, { value: "Civil" }, { costId: " " }, { costId: 42 }])(
    "does not fall back when Cost ID is missing: %j", metadata => {
      expect(auditDepartmentNumberSourceValue(metadata)).toBe("");
    });
  it("resolves a project's contract while keeping its UUID as the sequence identity", async () => {
    const source = await planNumberSource(readerFor([{
      id: "project-id", name: "Project A", customFields: {
        costCentre: "OLD", qmsAdditionalData: { contractProjectNumber: "0007/CTR" },
      },
    }]), "org", "project-id");
    expect(source).toEqual({ key: "project:project-id", kind: "project", label: "Project A", sourceValue: "0007/CTR" });
  });
  it.each(["Civil", "Civil Department", "department-id"])("retains department identity lookup by %s but inserts Cost ID", async selected => {
    const source = await planNumberSource(readerFor([{
      id: "department-id", value: "Civil", label: "Civil Department", metadata: { costId: "CIVIL_CID_001" },
    }]), "org", null, selected);
    expect(source).toEqual({ key: "department:department-id", kind: "department", label: "Civil Department", sourceValue: "CIVIL_CID_001" });
  });
  it.each(["Audit Plan", "Audit Report", "Audit Finding", "Audit CAR"])(
    "%s rejects missing master data before allocating or changing counters", async document => {
      await expect(planNumberSource(readerFor([{
        id: "project-id", name: "Project A", customFields: { costCentre: "OLD" },
      }]), "org", "project-id", undefined, document)).rejects.toThrow(`Contract / project no.`);
      await expect(planNumberSource(readerFor([{
        id: "department-id", value: "Civil", label: "Civil", metadata: {},
      }]), "org", null, "Civil", document)).rejects.toThrow("Maintain Cost ID");
    });
  it.each(["AP", "AR", "MNC", "CAR"])("%s preserves source/year counters when the master mapping changes", prefix => {
    const state: PlanNumberState = {
      pattern: { prefix, middle: "", separator: "-", padding: 4 },
      ranges: { "project:p": { "2026": 25 }, "department:d": { "2026": 9 } },
    };
    expect(nextPlanNumber(state, { key: "project:p", sourceValue: "CTR001" }, 2026).number).toBe(`${prefix}-CTR001-26-0026`);
    expect(nextPlanNumber(state, { key: "department:d", sourceValue: "0042" }, 2026).number).toBe(`${prefix}-0042-26-0010`);
    expect(state.ranges).toEqual({ "project:p": { "2026": 25 }, "department:d": { "2026": 9 } });
  });
});
