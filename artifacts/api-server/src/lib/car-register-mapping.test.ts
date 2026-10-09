import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const fixture = vi.hoisted(() => {
  const tables = Object.fromEntries([
    "auditFindings", "auditPlans", "auditSchedules", "audits", "correctiveActionReports", "projects", "users",
    "auditUserWorkspaceRoles", "auditWorkspaceRoles", "auditWorkspaceRolePermissions", "auditPermissions",
  ].map(name => [name, new Proxy({ name }, { get: (object, key) => key === "name" ? object.name : String(key) })]));
  return { tables, rows: new Map<object, any[]>() };
});
vi.mock("@workspace/db", () => ({
  ...fixture.tables,
  db: { select: () => ({
    from: (table: object) => {
      const query = {
        innerJoin: () => query,
        where: async () => fixture.rows.get(table) ?? [],
      };
      return query;
    },
  }) },
}));
vi.mock("../middlewares/rbac", () => ({
  getAuthorizedProjectScope: async () => ({ unrestricted: true, projectIds: [] }),
  getAuthorizedFullProjectScope: async () => ({ unrestricted: true, projectIds: [] }),
}));
vi.mock("./workspace", () => ({ HttpError: class extends Error {} }));
import { carRegister } from "./car-register";

const request = (query: Record<string, string> = {}) => ({
  currentUser: { id: "assignee", organizationId: "organization" }, query,
}) as unknown as Request;
const get = (query: Record<string, string> = {}) => carRegister(request(query), row => row);
const rows = (name: string) => fixture.rows.get(fixture.tables[name])!;

beforeEach(() => {
  fixture.rows.clear();
  fixture.rows.set(fixture.tables.auditSchedules, [
    { id: "programme", title: "Audit Schedule - 2026", status: JSON.stringify({ programme: true }) },
    { id: "audit-title-1", title: "AM-1709-2106", status: JSON.stringify({ parentId: "programme", auditTypes: ["Quality Internal Product Audit"] }) },
    { id: "audit-title-2", title: "AM-1710-2107", status: JSON.stringify({ parentId: "programme", auditTypes: ["Quality Internal Product Audit"] }) },
  ]);
  fixture.rows.set(fixture.tables.auditPlans, [
    { id: "plan-1", auditScheduleId: "audit-title-1", status: "{}", teamMemberIds: [] },
    { id: "plan-2", auditScheduleId: "audit-title-2", status: "{}", teamMemberIds: [] },
  ]);
  fixture.rows.set(fixture.tables.audits, [1, 2].map(number => ({
    id: `execution-${number}`, auditPlanId: `plan-${number}`, projectId: "project",
    status: JSON.stringify({ title: `Execution title ${number}` }), referenceNumber: `Execution reference ${number}`,
    checklistState: [{
      id: `finding-${number}`, auditFinding: "Minor NC", auditArea: "pmo",
      actionTakerId: "assignee", description: `Description ${number}`, evidenceIds: [],
    }],
  })));
  fixture.rows.set(fixture.tables.users, [{ id: "assignee", name: "Assigned user" }]);
  fixture.rows.set(fixture.tables.projects, [{ id: "project", name: "Project" }]);
});

describe("CAR Register Plan-field mapping", () => {
  it("maps Audit Schedule to the parent programme and Audit Title to the Plan's selected child audit", async () => {
    const data = await get();
    expect(data.items[0]).toMatchObject({
      scheduleId: "programme", scheduleName: "Audit Schedule - 2026", auditTitle: "AM-1709-2106",
      auditId: "execution-1", itemId: "finding-1", auditArea: "pmo", canRespond: true,
    });
    expect(data.items[1].auditTitle).toBe("AM-1710-2107");
    expect(data.items[0].auditTitle).not.toBe("Execution title 1");
  });
  it("groups the schedule filter by parent programme instead of individual audit titles", async () => {
    const data = await get();
    expect(data.schedules).toEqual([{ id: "programme", name: "Audit Schedule - 2026" }]);
    expect((await get({ scheduleId: "programme" })).total).toBe(2);
    expect((await get({ scheduleId: "programme", auditTitle: "AM-1709-2106" })).items).toHaveLength(1);
    expect((await get({ auditTitle: "AM-1710-2107" })).items[0].itemId).toBe("finding-2");
  });
  it("does not substitute the child title for a missing parent schedule", async () => {
    rows("auditSchedules")[1].status = "{}";
    const entry = (await get()).items[0];
    expect(entry.scheduleId).toBeNull();
    expect(entry.scheduleName).toBe("No linked schedule");
    expect(entry.auditTitle).toBe("AM-1709-2106");
  });
  it("keeps recoverable historical execution titles when the linked child no longer exists", async () => {
    rows("auditPlans")[0].auditScheduleId = "missing-child";
    const entry = (await get()).items[0];
    expect(entry.auditTitle).toBe("Execution title 1");
    expect(entry.scheduleName).toBe("No linked schedule");
  });
  it("remains a read-only projection and preserves source records and permission behavior", async () => {
    const original = JSON.stringify([...fixture.rows.values()]);
    const entry = (await get()).items[0];
    expect(JSON.stringify([...fixture.rows.values()])).toBe(original);
    expect(entry.canRespond).toBe(true);
    expect(entry.canReview).toBe(false);
    expect(entry.description).toBe("Description 1");
    expect(entry.evidenceIds).toEqual([]);
  });
});
