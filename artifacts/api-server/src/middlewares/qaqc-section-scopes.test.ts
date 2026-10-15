import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
const state = vi.hoisted(() => ({ rows: [] as any[], calls: 0 }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const query: any = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: async () => { state.calls++; return state.rows; },
  };
  return { ...actual, db: { select: () => query } };
});
import { getAuthorizedProjectScope } from "./rbac";

const req = (extra = {}) => ({ currentUser: { id: "user", organizationId: "org", platformRole: "User" }, ...extra }) as Request;
const row = (roleId: string, key: string, projectIds: string[] = ["one"]) => ({ roleId, key, projectIds, businessUnitIds: [], roleName: roleId, grant: "own" });
const scope = (r: Request, section: string) => getAuthorizedProjectScope(r, "qaqc", { module: `monthly_section_${section}`, action: "own" });

describe("QA/QC section permissions remain capability-scoped", () => {
  beforeEach(() => { state.rows = []; state.calls = 0; });
  it("keeps unconfigured legacy whole-report roles compatible", async () => {
    state.rows = [row("legacy", "data_entry")];
    expect(await scope(req(), "training")).toEqual({ unrestricted: false, projectIds: ["one"] });
  });
  it("does not let global edit bypass an enabled section restriction", async () => {
    state.rows = [row("restricted", "data_entry"), row("restricted", "qaqc.monthly_sections.configured"), row("restricted", "qaqc.monthly_section_training.create_edit")];
    const request = req();
    expect((await scope(request, "training")).projectIds).toEqual(["one"]);
    expect((await scope(request, "pqp")).projectIds).toEqual([]);
    expect(state.calls).toBe(1);
  });
  it("combines role grants without leaking one project's section into another", async () => {
    state.rows = [
      row("training-role", "qaqc.monthly_sections.configured"),
      row("training-role", "qaqc.monthly_section_training.create_edit"),
      row("pqp-role", "qaqc.monthly_sections.configured", ["two"]),
      row("pqp-role", "qaqc.monthly_section_pqp.create_edit", ["two"]),
    ];
    const request = req();
    expect((await scope(request, "training")).projectIds).toEqual(["one"]);
    expect((await scope(request, "pqp")).projectIds).toEqual(["two"]);
    expect((await scope(request, "metrics")).projectIds).toEqual([]);
  });
  it("does not infer section edit from a view-only or daily-only role", async () => {
    state.rows = [row("viewer", "qaqc.monthly_reports.view_all"), row("daily", "qaqc.daily_reports.create_edit")];
    expect((await scope(req(), "training")).projectIds).toEqual([]);
  });
  it("keeps a second unconfigured edit role additive", async () => {
    state.rows = [row("restricted", "qaqc.monthly_sections.configured"), row("legacy", "data_entry", ["two"])];
    expect((await scope(req(), "training")).projectIds).toEqual(["two"]);
  });
  it("keeps Drona's project boundary even for platform administrators", async () => {
    expect((await scope(req({ currentUser: { platformRole: "Super Admin" }, dronaProjectIds: ["allowed"] }), "training")).projectIds).toEqual(["allowed"]);
  });
});
