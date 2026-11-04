import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ select: vi.fn(), selectDistinct: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn(), log: vi.fn() }));
vi.mock("@workspace/db", async original => ({
  ...await original<Record<string, unknown>>(), db: mocks,
}));
vi.mock("../lib/field-access", () => ({ assertFieldAccess: vi.fn() }));
vi.mock("../lib/workspace", async original => ({
  ...await original<Record<string, unknown>>(), writeAuditLog: mocks.log,
}));
vi.mock("../lib/numbering", () => ({ hasNumberingPattern: vi.fn().mockResolvedValue(false), allocateReferenceNumber: vi.fn() }));
vi.mock("../middlewares/rbac", async original => ({
  ...await original<Record<string, unknown>>(), assertProjectAccess: vi.fn(),
  getAuthorizedProjectScope: vi.fn().mockResolvedValue({ unrestricted: true, projectIds: [] }),
}));
import router from "./audit";

const id = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
let saved: any, schedule: any, conditions: SQL[], locks: string[];
function query(rows: unknown[]) {
  const q: any = {
    from: () => q, innerJoin: () => q, orderBy: () => q, limit: () => q,
    where: (condition: SQL) => { conditions.push(condition); return q; },
    for: (mode: string) => { locks.push(mode); return q; },
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return q;
}
async function request(path: string, body: unknown, method = "put") {
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]);
  const req = { params: { id }, path: path.replace(":id", id), body,
    currentUser: { id, organizationId: org }, permissionAdminBypass: true };
  const res: any = { status: vi.fn(() => res), json: vi.fn() };
  await new Promise<void>((resolve, reject) => {
    res.json.mockImplementation(() => resolve());
    layer.route.stack[0].handle(req, res, reject);
  });
  if (res.status.mock.calls[0]?.[0] >= 400) {
    expect(res.status.mock.calls[0][0]).toBe(422);
    throw new Error(res.json.mock.calls[0][0].error);
  }
  return res.json.mock.calls[0][0];
}
const minutes = (heldAt: unknown) => ({ heldAt, attendees: [], minutes: "Recorded minutes" });
beforeEach(() => {
  vi.clearAllMocks(); conditions = []; locks = [];
  saved = { id, organizationId: org, auditPlanId: id, projectId: id, referenceNumber: "Audit",
    workflowState: "planned", checklistState: [], status: "{}" };
  schedule = { status: JSON.stringify({ plannedStartDate: "2026-10-04", plannedEndDate: "2026-10-06" }) };
  mocks.select.mockImplementation(() => {
    const q = query([]);
    q.from = (table: any) => {
      const name = getTableName(table);
      const rows = name === "audits" ? [saved] : name === "audit_plans"
        ? [{ id, projectId: id, auditScheduleId: id, ...schedule }] : name === "audit_schedules" ? [schedule] : [];
      return query(rows);
    };
    return q;
  });
  mocks.selectDistinct.mockImplementation(() => query([]));
  mocks.transaction.mockImplementation(async fn => {
    const original = structuredClone(saved);
    try { return await fn(mocks); } catch (error) { saved = original; throw error; }
  });
  mocks.update.mockImplementation(() => ({
    set: (values: any) => ({ where: () => ({ returning: async () => { saved = { ...saved, ...values }; return [saved]; } }) }),
  }));
  mocks.insert.mockImplementation(() => ({
    values: (values: any) => ({ returning: async () => { saved = { ...saved, ...values }; return [saved]; } }),
  }));
});

describe.each(["opening", "closing"] as const)("%s meeting API calendar window", kind => {
  const path = `/audits/:id/${kind}-meeting`;
  it.each(["2026-10-04T00:00+14:00", "2026-10-06T23:59:59.999-12:00"])("retains raw wall-clock input and timestamp storage: %s", async heldAt => {
    const result = await request(path, minutes(heldAt));
    expect(result[`${kind}Meeting`].heldAtLocal).toBe(heldAt);
    expect(new Date(result[`${kind}Meeting`].heldAt).toISOString()).toBe(new Date(heldAt).toISOString());
    expect(saved.workflowState).toBe(kind === "opening" ? "in progress" : "planned");
    expect(locks).toContain("share");
    const sql = conditions.map(c => new PgDialect().sqlToQuery(c));
    expect(sql.some(c => c.params.includes(org) && c.sql.includes("audit_plans") && c.sql.includes("audit_schedules"))).toBe(true);
  });
  it.each(["2026-10-03T23:59-12:00", "2026-10-07T00:00+14:00", "bad", "2026-10-04T24:00", "2026-02-30T10:00"])("rejects invalid writes without persistence: %s", async heldAt => {
    const before = structuredClone(saved);
    await expect(request(path, minutes(heldAt))).rejects.toThrow(kind === "closing" ? "Closing Meeting Held at" : "Opening meeting Held at");
    expect(saved).toEqual(before);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each([{}, { programme: true, plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31" },
    { plannedStartDate: "bad", plannedEndDate: "2026-10-06" },
    { plannedStartDate: "2026-10-07", plannedEndDate: "2026-10-04" }])("blocks unavailable or unusable source bounds %s", async meta => {
    schedule.status = JSON.stringify(meta);
    await expect(request(path, minutes("2026-10-04T12:00"))).rejects.toThrow("Correct the Audit schedule dates");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("accepts the complete single day", async () => {
    schedule.status = JSON.stringify({ plannedStartDate: "2026-10-04", plannedEndDate: "2026-10-04" });
    await request(path, minutes("2026-10-04T00:00"));
    await request(path, minutes("2026-10-04T23:59:59.999"));
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
  it("keeps invalid history intact on rejection and allows explicit correction", async () => {
    saved.status = JSON.stringify({ [`${kind}Meeting`]: minutes("2026-10-01T10:00:00Z") });
    const before = saved.status;
    await expect(request(path, minutes("2026-10-01T10:00:00Z"))).rejects.toThrow("must be within");
    expect(saved.status).toBe(before);
    const result = await request(path, minutes("2026-10-04T10:00"));
    expect(result[`${kind}Meeting`].heldAtLocal).toBe("2026-10-04T10:00");
  });
});

describe("Nested Closing Meeting writes", () => {
  const execution = (heldAt: string) => ({ id, planId: id, projectId: id, title: "Audit", status: "Planned", closingMeeting: minutes(heldAt) });
  it.each([["/audits", "post"], ["/audits/:id", "put"]])("rejects out-of-window data via %s", async (path, method) => {
    await expect(request(path, execution("2026-10-07T00:00"), method)).rejects.toThrow("Closing Meeting Held at must be within");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("retains new nested closing wall-clock values", async () => {
    const result = await request("/audits", execution("2026-10-06T23:59-12:00"), "post");
    expect(result.closingMeeting.heldAtLocal).toBe("2026-10-06T23:59-12:00");
  });
  it("validates both nested meetings atomically without imposing sequencing", async () => {
    const data = { ...execution("2026-10-04T00:00+14:00"), openingMeeting: minutes("2026-10-06T23:59-12:00") };
    const result = await request("/audits/:id", data);
    expect(result.openingMeeting.heldAtLocal).toBe("2026-10-06T23:59-12:00");
    expect(result.closingMeeting.heldAtLocal).toBe("2026-10-04T00:00+14:00");
    expect(result.status).toBe("Planned");
  });
  it("rejects invalid nested closing data without changing an existing opening instant", async () => {
    saved.status = JSON.stringify({ openingMeeting: minutes("2026-10-04T10:00:00.123Z") });
    const before = structuredClone(saved);
    await expect(request("/audits/:id", { ...execution("2026-10-07T00:00"),
      openingMeeting: minutes("2026-10-04T10:00:00.123Z") })).rejects.toThrow("Closing Meeting");
    expect(saved).toEqual(before);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
