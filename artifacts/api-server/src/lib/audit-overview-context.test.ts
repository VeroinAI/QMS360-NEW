import { describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { GetAuditResponse } from "@workspace/api-zod";
import { auditOverviewContext, auditOverviewPlanQuery, auditOverviewProjectQuery } from "./audit-overview-context";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const projectName = "Regional Infrastructure Delivery and Long-Term Quality Assurance Programme";
const planNumber = "QMS360/PLAN/REGIONAL-INFRASTRUCTURE/2026/000127";

function databaseWith(projects: unknown[], plans: unknown[]) {
  const results = [projects, plans];
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(results.shift()!) }) }),
  }));
  return { database: { select } as unknown as Pick<typeof db, "select">, select };
}
const readNumber = (plan: { status: string | null }) => {
  try { return JSON.parse(plan.status ?? "{}").planNumber; } catch { return null; }
};

describe("Audit Overview linked context", () => {
  it("returns actual names and saved references on a completed audit without changing its other fields", async () => {
    const { database } = databaseWith([{ name: projectName }], [{ status: JSON.stringify({ planNumber, auditTitle: "Not the reference" }) }]);
    const audit = { id: "audit", projectId, planId, auditPlanId: planId, title: "Completed audit", status: "Complete", closedAt: "2026-10-21T12:00:00Z", checklist: [] };
    const response = GetAuditResponse.parse({ ...audit, ...await auditOverviewContext(database, organizationId, audit, readNumber) });
    expect(response).toMatchObject({ projectName, planNumber, planAvailable: true, status: "Complete", title: audit.title, checklist: [] });
    expect(response.closedAt).toEqual(new Date(audit.closedAt));
    expect(response.projectName).not.toBe(projectId);
    expect(response.planNumber).not.toBe(planId);
  });

  it.each([null, "{}", "legacy status", '{"planNumber":"  "}'])("preserves an existing unnumbered plan (%s)", async status => {
    const { database } = databaseWith([{ name: projectName }], [{ status }]);
    expect(await auditOverviewContext(database, organizationId, { projectId, auditPlanId: planId }, readNumber))
      .toEqual({ projectName, planNumber: null, planAvailable: true });
  });

  it("tolerates missing/deleted or foreign-tenant linked records", async () => {
    const { database } = databaseWith([], []);
    expect(await auditOverviewContext(database, organizationId, { projectId, auditPlanId: planId }, readNumber))
      .toEqual({ projectName: null, planNumber: null, planAvailable: false });
  });

  it("does not invent or look up a project for process audits", async () => {
    const { database, select } = databaseWith([{ status: JSON.stringify({ planNumber }) }], []);
    expect(await auditOverviewContext(database, organizationId, { projectId: null, auditPlanId: planId }, readNumber))
      .toEqual({ projectName: null, planNumber, planAvailable: true });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not query absent links", async () => {
    const { database, select } = databaseWith([], []);
    expect(await auditOverviewContext(database, organizationId, { projectId: null, auditPlanId: null }, readNumber))
      .toEqual({ projectName: null, planNumber: null, planAvailable: false });
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    ["projects", () => auditOverviewProjectQuery(db, organizationId, projectId), projectId],
    ["audit_plans", () => auditOverviewPlanQuery(db, organizationId, planId), planId],
  ] as const)("scopes the %s lookup by organization, linked ID and non-deleted rows", (_table, build, id) => {
    const query = build().toSQL();
    expect(query.sql).toContain('"organization_id" =');
    expect(query.sql).toContain('"deleted_at" is null');
    expect(query.params).toEqual([id, organizationId, 1]);
    // Historical/completed context is not restricted to an active workflow state.
    expect(query.sql).not.toContain('"status" =');
  });
});
