import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db, organizations, organizationSettings, projects, users, masterDataGroups, masterDataValues,
  auditSchedules, auditPlans, audits, auditFindings, correctiveActionReports,
} from "@workspace/db";
import { lockScheduleNumbering } from "../src/lib/audit-schedule-numbering";
import { allocatePlanNumber, previewPlanNumber, readPlanNumberState, savePlanNumbering } from "../src/lib/audit-plan-numbering";
import { allocateReportNumber, readReportNumberState, saveReportNumbering } from "../src/lib/audit-report-numbering";
import { allocateFindingNumber, readFindingNumberState, saveFindingNumbering } from "../src/lib/audit-finding-numbering";
import { lockNumberedCarResponse, readCarNumberState, saveCarNumbering } from "../src/lib/audit-car-numbering";

const org = randomUUID(), userId = randomUUID(), groupId = randomUUID(), departmentId = randomUUID();
const scope = (id: string | null) => id ? `project:${id}` : `department:${departmentId}`;
const project = async () => {
  const id = randomUUID();
  await db.insert(projects).values({ id, organizationId: org, code: id, name: "Continuous fixture",
    customFields: { qmsAdditionalData: { contractProjectNumber: "CTR001" } } });
  return id;
};
const issue = (kind: "plan" | "report" | "finding", id: string | null, date = "2026-12-31", type = "Major NC") =>
  db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, org);
    if (kind === "plan") return allocatePlanNumber(tx, settings, id, "CIV", date);
    if (kind === "report") return allocateReportNumber(tx, settings, id, "CIV", date);
    return allocateFindingNumber(tx, settings, type, id, "CIV", date);
  });
const issueCar = async (id: string | null, date = "2026-12-31", savedNumber?: string) => {
  const [schedule] = await db.insert(auditSchedules).values({ organizationId: org, projectId: id, year: Number(date.slice(0, 4)),
    title: "Numbering fixture", status: JSON.stringify({ plannedStartDate: date, departmentProject: "CIV",
      auditTypes: [id ? "Quality Internal Product Audit" : "Quality Internal Process Audit"] }) }).returning();
  const [plan] = await db.insert(auditPlans).values({ organizationId: org, projectId: id, auditScheduleId: schedule.id }).returning();
  const [audit] = await db.insert(audits).values({ organizationId: org, projectId: id, auditPlanId: plan.id, referenceNumber: randomUUID() }).returning();
  const [finding] = await db.insert(auditFindings).values({ organizationId: org, auditId: audit.id, classification: "Major NC" }).returning();
  const [car] = await db.insert(correctiveActionReports).values({ organizationId: org, auditFindingId: finding.id,
    responsibleDepartment: "CIV", ownerId: userId, effectivenessNotes: savedNumber ? JSON.stringify({ carNumber: savedNumber }) : null }).returning();
  const result = await db.transaction(async tx => {
    const { settings } = await lockScheduleNumbering(tx, org);
    const result = await lockNumberedCarResponse(tx, settings, car.id, userId);
    await tx.update(correctiveActionReports).set({ effectivenessNotes: JSON.stringify(result.meta) }).where(eq(correctiveActionReports.id, car.id));
    return result.meta;
  });
  return { car, result };
};

describe("Continuous Audit numbering in PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(organizations).values({ id: org, name: "Continuous numbering fixture", code: org });
    await db.insert(users).values({ id: userId, organizationId: org, username: userId,
      email: `${userId}@example.invalid`, fullName: "Numbering fixture user" });
    await db.insert(masterDataGroups).values({ id: groupId, organizationId: org, name: "Departments", code: "departments", appKey: "audit" });
    await db.insert(masterDataValues).values({ id: departmentId, organizationId: org, groupId, value: "CIV", label: "Civil", metadata: { costId: "001" } });
    await savePlanNumbering(org);
  });
  afterAll(async () => {
    for (const table of [correctiveActionReports, auditFindings, audits, auditPlans, auditSchedules,
      masterDataValues, masterDataGroups, organizationSettings, users, projects] as const) {
      await db.delete(table).where(eq(table.organizationId, org));
    }
    await db.delete(organizations).where(eq(organizations.id, org));
  });

  it("continues all four legacy yearly ranges above their highest saved value across New Year", async () => {
    const id = await project(), key = scope(id);
    await db.transaction(async tx => {
      const { settings } = await lockScheduleNumbering(tx, org);
      const ranges = { [key]: { "2025": 125, "2026": 12 } };
      await tx.update(organizationSettings).set({ documentNumbering: {
        ...settings.documentNumbering, audit_plan_numbering: { ranges }, audit_report_numbering: { ranges },
        audit_car_numbering: { ranges }, audit_finding_numbering: { ranges: { "Major NC": ranges } },
      } as any }).where(eq(organizationSettings.id, settings.id));
    });
    const before = await readPlanNumberState(org);
    expect(await previewPlanNumber(org, id, undefined, "2027-01-01")).toEqual({ planNumber: "AP-CTR001-0126" });
    expect(await readPlanNumberState(org)).toEqual(before);
    expect((await issue("plan", id) as any).planNumber).toBe("AP-CTR001-0126");
    expect((await issue("plan", id, "2027-01-01") as any).planNumber).toBe("AP-CTR001-0127");
    expect((await issue("report", id) as any).reportNumber).toBe("AR-CTR001-0126");
    expect((await issue("report", id, "2027-01-01") as any).reportNumber).toBe("AR-CTR001-0127");
    expect((await issue("finding", id) as any).findingNumber).toBe("AF-CTR001-MAJ-0126");
    expect((await issue("finding", id, "2027-01-01") as any).findingNumber).toBe("AF-CTR001-MAJ-0127");
    expect((await issueCar(id)).result.carNumber).toBe("CAR-CTR001-0126");
    expect((await issueCar(id, "2027-01-01")).result.carNumber).toBe("CAR-CTR001-0127");
    expect((await readPlanNumberState(org)).ranges[key]["2025"]).toBe(125);
  });
  it("uses last-used plus one for all go-live settings and rejects rewinds", async () => {
    const id = await project(), key = scope(id);
    const range = { scope: key, lastNumber: 250 };
    await savePlanNumbering(org, undefined, range);
    await saveReportNumbering(org, undefined, range);
    await saveFindingNumbering(org, undefined, { ...range, findingType: "Major NC" });
    await saveCarNumbering(org, undefined, range);
    expect((await issue("plan", id) as any).planNumber).toBe("AP-CTR001-0251");
    expect((await issue("report", id) as any).reportNumber).toBe("AR-CTR001-0251");
    expect((await issue("finding", id) as any).findingNumber).toBe("AF-CTR001-MAJ-0251");
    expect((await issueCar(id)).result.carNumber).toBe("CAR-CTR001-0251");
    await expect(savePlanNumbering(org, undefined, range)).rejects.toThrow("cannot be below 251");
    await expect(saveReportNumbering(org, undefined, range)).rejects.toThrow("cannot be below 251");
    await expect(saveFindingNumbering(org, undefined, { ...range, findingType: "Major NC" })).rejects.toThrow("cannot be below 251");
    await expect(saveCarNumbering(org, undefined, range)).rejects.toThrow("cannot be below 251");
    expect((await issue("finding", id, "2028-01-01", "Minor NC") as any).findingNumber).toBe("AF-CTR001-MIN-0001");
  });
  it("keeps department Cost ID, source scopes and finding-type counters independent", async () => {
    expect((await issue("plan", null) as any).planNumber).toBe("AP-001-0001");
    expect((await issue("report", null, "2027-01-01") as any).reportNumber).toBe("AR-001-0001");
    expect((await issue("finding", null) as any).findingNumber).toBe("AF-001-MAJ-0001");
    expect((await issueCar(null)).result.carNumber).toBe("CAR-001-0001");
    expect((await issue("plan", null, "2028-01-01") as any).planNumber).toBe("AP-001-0002");
    expect((await issue("finding", null, "2028-01-01", "Minor NC") as any).findingNumber).toBe("AF-001-MIN-0001");
  });
  it("serializes concurrent allocations across calendar years and rolls back failed saves", async () => {
    const id = await project(), key = scope(id);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      issue("plan", id, index % 2 ? "2027-01-01" : "2026-12-31")));
    expect(results.map(r => (r as any).planNumberSequence).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(db.transaction(async tx => {
      const { settings } = await lockScheduleNumbering(tx, org);
      await allocateReportNumber(tx, settings, id, undefined, "2027-01-01");
      throw new Error("Rollback fixture");
    })).rejects.toThrow("Rollback fixture");
    expect((await readReportNumberState(org)).ranges[key]).toBeUndefined();
    expect((await issue("report", id) as any).reportNumber).toBe("AR-CTR001-0001");
  });
  it("does not rewrite issued CAR numbers, including legacy year-bearing identifiers", async () => {
    const id = await project(), key = scope(id);
    const before = await readCarNumberState(org);
    const { car, result } = await issueCar(id, "2027-01-01", "LEGACY-CTR001-26-0007");
    expect(result.carNumber).toBe("LEGACY-CTR001-26-0007");
    expect((await readCarNumberState(org)).ranges[key]).toEqual(before.ranges[key]);
    const [saved] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, car.id));
    expect(JSON.parse(saved.effectivenessNotes!).carNumber).toBe("LEGACY-CTR001-26-0007");
    expect((await readFindingNumberState(org)).ranges["Minor NC"][scope(null)].continuous).toBe(1);
  });
});
