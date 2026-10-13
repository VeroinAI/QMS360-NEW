import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organizations, organizationSettings, projects, masterDataGroups, masterDataValues, auditAuditLogEntries } from "@workspace/db";
import { lockScheduleNumbering } from "../src/lib/audit-schedule-numbering";
import { allocatePlanNumber, previewPlanNumber, readPlanNumberState, savePlanNumbering } from "../src/lib/audit-plan-numbering";
import { writeAuditLog } from "../src/lib/workspace";
const org = randomUUID(), a = randomUUID(), b = randomUUID(), noCost = randomUUID(), group = randomUUID(), department = randomUUID();
const issue = (project: string | null, date: string, dept?: string) => db.transaction(async tx => {
  const { settings } = await lockScheduleNumbering(tx, org);
  return allocatePlanNumber(tx, settings, project, dept, date);
});
describe("Audit Plan yearly range allocation in PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(organizations).values({ id: org, name: "Plan numbering fixture", code: org });
    await db.insert(projects).values([
      { id: a, organizationId: org, code: "A", name: "A", customFields: { costCentre: "CC100" } },
      { id: b, organizationId: org, code: "B", name: "B", customFields: { costCentre: "CC200" } },
      { id: noCost, organizationId: org, code: "MISSING", name: "Missing cost center" },
    ]);
    await db.insert(masterDataGroups).values({ id: group, organizationId: org, name: "Departments", code: "departments", appKey: "audit" });
    await db.insert(masterDataValues).values({ id: department, organizationId: org, groupId: group, value: "ENG", label: "Engineering label" });
    await savePlanNumbering(org, { prefix: "AGH", middle: "AP", separator: "-", padding: 4 });
  });
  afterAll(async () => {
    await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, org));
    await db.delete(masterDataValues).where(eq(masterDataValues.organizationId, org));
    await db.delete(masterDataGroups).where(eq(masterDataGroups.organizationId, org));
    await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, org));
    await db.delete(projects).where(eq(projects.organizationId, org));
    await db.delete(organizations).where(eq(organizations.id, org));
  });
  it("starts separate projects and years at1 using Schedule From Date", async () => {
    const before = await readPlanNumberState(org);
    expect(await previewPlanNumber(org, a, undefined, "2027-06-15")).toEqual({ planNumber: "AGH-CC100-AP-27-0001" });
    expect(await previewPlanNumber(org, a, undefined, "2027-06-15")).toEqual({ planNumber: "AGH-CC100-AP-27-0001" });
    expect(await readPlanNumberState(org)).toEqual(before);
    expect((await issue(a, "2027-06-15")).planNumber).toBe("AGH-CC100-AP-27-0001");
    expect((await issue(b, "2027-06-15")).planNumber).toBe("AGH-CC200-AP-27-0001");
    expect((await issue(a, "2028-01-01")).planNumber).toBe("AGH-CC100-AP-28-0001");
    expect((await issue(a, "2027-06-16")).planNumberSequence).toBe(2);
    expect((await previewPlanNumber(org, a, undefined, "2027-06-16")).planNumber).toBe("AGH-CC100-AP-27-0003");
  });
  it("uses Department master Value, not its label, with a department-specific yearly range", async () => {
    expect((await previewPlanNumber(org, null, "Engineering label", "2027-06-15")).planNumber).toBe("AGH-ENG-AP-27-0001");
    const first = await issue(null, "2027-06-15", "ENG");
    expect(first.planNumber).toBe("AGH-ENG-AP-27-0001");
    expect(first.planNumberScope).toBe(`department:${department}`);
    expect((await issue(null, "2028-01-01", "Engineering label")).planNumberSequence).toBe(1);
    expect((await issue(null, "2027-07-01", department)).planNumberSequence).toBe(2);
  });
  it("supports last-number go-live entry, maintains year isolation and prevents rewind", async () => {
    await savePlanNumbering(org, undefined, { scope: `project:${a}`, year: 2027, lastNumber: 100 });
    expect((await issue(a, "2027-09-01")).planNumberSequence).toBe(101);
    await expect(savePlanNumbering(org, undefined, { scope: `project:${a}`, year: 2027, lastNumber: 99 })).rejects.toThrow(/cannot be below/);
    expect((await issue(a, "2028-02-01")).planNumberSequence).toBe(2);
  });
  it("serializes concurrent allocations without duplicate project/year sequences", async () => {
    const allocated = await Promise.all(Array.from({ length: 5 }, () => issue(b, "2027-08-01")));
    expect(allocated.map(value => value.planNumberSequence).sort()).toEqual([2, 3, 4, 5, 6]);
  });
  it("rolls back an allocation if plan insertion fails and does not consume numbers for missing source data", async () => {
    const before = await readPlanNumberState(org);
    await expect(db.transaction(async tx => {
      const { settings } = await lockScheduleNumbering(tx, org);
      await allocatePlanNumber(tx, settings, a, undefined, "2027-09-01");
      throw new Error("Simulated insert failure");
    })).rejects.toThrow(/insert failure/);
    await expect(issue(noCost, "2027-09-01")).rejects.toThrow(/Cost Center/);
    await expect(issue(null, "2027-09-01", "unknown")).rejects.toThrow(/Department master Value/);
    expect(await readPlanNumberState(org)).toEqual(before);
  });
  it("format changes never reset ranges", async () => {
    const before = await readPlanNumberState(org);
    await savePlanNumbering(org, { prefix: "NEW", middle: "", separator: "/", padding: 3 });
    expect((await readPlanNumberState(org)).ranges).toEqual(before.ranges);
    expect((await issue(b, "2027-09-01")).planNumber).toBe("NEW/CC200/27/007");
  });
  it("logs range maintenance with a UUID entity and retains the composite scope in metadata", async () => {
    const scope = `project:${a}`;
    await writeAuditLog(db, "audit", {
      organizationId: org, action: "maintain_plan_number_range", entityType: "audit_plan_numbering",
      entityId: scope.split(":")[1], after: { scope, year: 2027, lastNumber: 101 },
    }, { dispatch: false });
    const [log] = await db.select().from(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, org));
    expect(log.entityId).toBe(a);
    expect(log.after).toMatchObject({ scope, year: 2027, lastNumber: 101 });
  });
});
