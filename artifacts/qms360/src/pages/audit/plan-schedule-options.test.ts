import { describe, expect, it, vi } from "vitest";
import type { AuditSchedule } from "@workspace/api-client-react";
import { eligiblePlanAudits, loadPlanOptionPages } from "./plan-schedule-options";

const audit = (overrides: Partial<AuditSchedule> = {}) => ({
  id: "audit", parentId: "programme", hasPlan: false, feasibilityDecision: null,
  ...overrides,
}) as AuditSchedule;

describe("new Audit Plan source selection", () => {
  it("requires selecting a New Schedule first", () => {
    expect(eligiblePlanAudits([audit()], "")).toEqual([]);
  });
  it("lists only children of the selected schedule", () => {
    expect(eligiblePlanAudits([audit(), audit({ id: "other", parentId: "other-programme" })], "programme"))
      .toEqual([audit()]);
  });
  it("excludes standalone legacy audits not belonging to New Schedule", () => {
    expect(eligiblePlanAudits([audit({ parentId: null }), audit({ parentId: undefined })], "programme")).toEqual([]);
  });
  it("excludes audits already occupied by a plan", () => {
    expect(eligiblePlanAudits([audit({ hasPlan: true })], "programme")).toEqual([]);
  });
  it("excludes cancelled audits but keeps rescheduled audits eligible", () => {
    expect(eligiblePlanAudits([audit({ feasibilityDecision: "cancelled" }), audit({ id: "rescheduled", feasibilityDecision: "reschedule" })], "programme"))
      .toHaveLength(1);
  });
  it("allows an audit again when its active plan has been deleted", () => {
    expect(eligiblePlanAudits([audit({ hasPlan: false })], "programme")).toHaveLength(1);
  });
  it("returns no old-parent audits after changing schedules", () => {
    expect(eligiblePlanAudits([audit()], "other-programme")).toEqual([]);
  });
  it("loads all option pages", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ["first"], total: 2 })
      .mockResolvedValueOnce({ items: ["second"], total: 2 });
    expect(await loadPlanOptionPages(fetchPage)).toEqual(["first", "second"]);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2);
  });
  it("handles an authoritative empty server result", async () => {
    expect(await loadPlanOptionPages(async () => ({ items: [], total: 0 }))).toEqual([]);
  });
  it("fails explicitly if a later page cannot supply the advertised options", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ["first"], total: 2 })
      .mockResolvedValueOnce({ items: [], total: 2 });
    await expect(loadPlanOptionPages(fetchPage)).rejects.toThrow("fully loaded");
  });
});