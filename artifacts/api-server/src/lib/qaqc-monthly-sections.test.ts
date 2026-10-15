import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { monthlySectionPayload, monthlySections } from "@workspace/field-controls";

const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("../middlewares/rbac", () => ({ getAuthorizedProjectScope: mocks.scope }));
import { mergeMonthlySections, monthlySectionAccess } from "./qaqc-monthly-sections";

describe("monthly report section enforcement", () => {
  beforeEach(() => { mocks.scope.mockReset(); });
  it("merges an assigned section without wiping another contributor's section or legacy metadata", () => {
    const before = { pqpStatus: "Approved A", training: { trainingCount: 2 }, historical: { source: "legacy" }, assessmentConfirmed: true };
    const result = mergeMonthlySections(before, { training: { trainingCount: 3 } }, ["training"]);
    expect(result).toMatchObject({ pqpStatus: "Approved A", training: { trainingCount: 3 }, historical: before.historical, assessmentConfirmed: false });
    expect(before.training.trainingCount).toBe(2);
  });
  it("rejects a forged write to a read-only section", () => {
    expect(() => mergeMonthlySections({ pqpStatus: "Under Preparation" }, { pqpStatus: "Approved A" }, ["training"])).toThrow(/cannot maintain/);
  });
  it("rejects arbitrary new metadata and whole-report zero-fill bypasses", () => {
    for (const key of ["unknownField", "noUpdates", "assessmentConfirmationRequired"])
      expect(() => mergeMonthlySections({}, { [key]: true }, ["training"])).toThrow(/cannot maintain/);
  });
  it("retains unchanged legacy values sent by an older client without granting a write", () => {
    expect(mergeMonthlySections({ old: "keep" }, { old: "keep" }, [])).toEqual({ old: "keep" });
  });
  it("only allows the assessment role to explicitly confirm after editing", () => {
    expect(mergeMonthlySections({ narrative: "old" }, { narrative: "new", assessmentConfirmed: true }, ["assessment"]).assessmentConfirmed).toBe(true);
    expect(() => mergeMonthlySections({}, { assessmentConfirmed: true }, ["training"])).toThrow();
    expect(mergeMonthlySections({ assessmentConfirmed: true }, { training: { trainingCount: 1 } }, ["training"]).assessmentConfirmed).toBe(false);
  });
  it("projects only authorized top-level fields, including the PQP and reference dates", () => {
    expect(monthlySectionPayload({ pqpStatus: "Approved A", pqpApprovedDate: "2026-10-01", reportFrom: "2026-10-01", training: {}, privateOldField: 1 }, ["pqp", "reference"]))
      .toEqual({ pqpStatus: "Approved A", pqpApprovedDate: "2026-10-01", reportFrom: "2026-10-01" });
  });
  it("requires base edit permission for the SAME project, not a section role in a different project", async () => {
    mocks.scope.mockResolvedValue({ unrestricted: false, projectIds: ["other"] });
    expect(await monthlySectionAccess({} as Request, "selected")).toEqual([]);
    expect(mocks.scope).toHaveBeenCalledTimes(1);
  });
  it("resolves section-specific scopes, combines granted sections and never makes PQI editable", async () => {
    mocks.scope.mockImplementation(async (_req, _app, target) => ({
      unrestricted: false,
      projectIds: target.module === "monthly_reports" || target.module === "monthly_section_training" ? ["selected"] : ["other"],
    }));
    const req = {} as Request;
    expect(await monthlySectionAccess(req, "selected")).toEqual(["training"]);
    await monthlySectionAccess(req, "selected");
    expect(mocks.scope).toHaveBeenCalledTimes(monthlySections.length);
  });
  it("retains platform-admin scope and returns every maintainable section", async () => {
    mocks.scope.mockResolvedValue({ unrestricted: true, projectIds: [] });
    const result = await monthlySectionAccess({} as Request, "selected");
    expect(result).toHaveLength(monthlySections.length - 1);
    expect(result).not.toContain("pqi");
  });
});
