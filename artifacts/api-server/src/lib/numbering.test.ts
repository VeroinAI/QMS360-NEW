import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LESSON_NUMBER_FIELDS, projectNumberContext, referencePrefixError, ReferencePrefixError, resolveReferencePrefix,
} from "@workspace/field-controls";

const mocks = vi.hoisted(() => ({
  row: { id: "settings", documentNumbering: {} as Record<string, any> },
  update: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@workspace/db", () => {
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => [mocks.row] }) }) }) }),
    update: () => ({ set: (data: any) => ({ where: async () => {
      mocks.update(data); mocks.row.documentNumbering = data.documentNumbering;
    } }) }),
  };
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
  return { db: { transaction: mocks.transaction }, organizationSettings: { id: "id", organizationId: "organization_id", deletedAt: "deleted_at" } };
});
import { allocateReferenceNumber, formatReferenceNumber, resetNumberingPattern, saveNumberingPattern } from "./numbering";

const prefix = "AGH-QAM-LL-{Project->Cost Center}-{Discipline Master->Value}";
const pattern = { prefix, suffix: "", separator: "-", position: "after_prefix" as const, padding: 6, startingNumber: 1 };

beforeEach(() => {
  mocks.row.documentNumbering = { lessons: { ...pattern, nextNumber: 13, custom: true } };
  mocks.update.mockClear();
});

describe("Lessons reference prefix fields", () => {
  it("resolves the two approved fields, using the Value verbatim rather than an ID or label", () => {
    expect(resolveReferencePrefix(prefix, { costCentre: "CC105", disciplineValue: "civil_engineering" }))
      .toBe("AGH-QAM-LL-CC105-civil_engineering");
  });
  it("keeps existing fixed prefixes compatible without any context", () => {
    expect(resolveReferencePrefix("AGH-QAM-LL")).toBe("AGH-QAM-LL");
  });
  it("allows each field alone and repeated tokens", () => {
    expect(resolveReferencePrefix("{Project->Cost Center}/{Project->Cost Center}", { costCentre: "CC1" })).toBe("CC1/CC1");
    expect(resolveReferencePrefix("{Discipline Master->Value}", { disciplineValue: "MEP" })).toBe("MEP");
  });
  it.each(["{Other->Field}", "{Project->Cost Centre}", "{Project->Cost Center", "Project->Cost Center}", "{{Project->Cost Center}}"])("rejects unknown or malformed token %s", value => {
    expect(referencePrefixError(value)).toMatch(/Unknown or incomplete/);
    expect(() => resolveReferencePrefix(value)).toThrow(ReferencePrefixError);
  });
  it("accepts the expanded prefix length but rejects excessively long text", () => {
    expect(referencePrefixError(prefix)).toBeNull();
    expect(referencePrefixError("x".repeat(201))).toMatch(/200/);
  });
  it.each([undefined, null, "", "   ", 123])("rejects missing or invalid Cost Center %s", costCentre => {
    expect(() => resolveReferencePrefix(prefix, { costCentre, disciplineValue: "CIVIL" })).toThrow(/Cost Center is missing/);
  });
  it("rejects a missing discipline rather than silently deleting a prefix segment", () => {
    expect(() => resolveReferencePrefix(prefix, { costCentre: "CC105" })).toThrow(/Value is missing/);
  });
  it.each(["CC\n105", "CC{105}", "\u0000CC"])("rejects unsafe master values %s", costCentre => {
    expect(() => resolveReferencePrefix(prefix, { costCentre, disciplineValue: "CIVIL" })).toThrow(/unsupported/);
  });
  it("supports legacy project cost_centre and gives current costCentre precedence", () => {
    expect(projectNumberContext({ cost_centre: "OLD" }, "CIVIL")).toEqual({ costCentre: "OLD", disciplineValue: "CIVIL" });
    expect(projectNumberContext({ costCentre: "NEW", cost_centre: "OLD" }).costCentre).toBe("NEW");
  });
  it("trims source boundary whitespace", () => {
    expect(resolveReferencePrefix(prefix, { costCentre: " CC105 ", disciplineValue: " CIVIL " })).toBe("AGH-QAM-LL-CC105-CIVIL");
  });
});

describe("number allocation and pattern preservation", () => {
  it("issues a resolved reference and advances only the global Lessons counter", async () => {
    const result = await allocateReferenceNumber("org", "lessons", { costCentre: "CC105", disciplineValue: "CIVIL" });
    expect(result).toBe("AGH-QAM-LL-CC105-CIVIL-000013");
    expect(mocks.row.documentNumbering.lessons.prefix).toBe(prefix);
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(14);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("missing values do not update or advance the counter", async () => {
    await expect(allocateReferenceNumber("org", "lessons", { disciplineValue: "CIVIL" })).rejects.toThrow(/Cost Center/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
  });
  it("different projects share the existing counter", async () => {
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "A", disciplineValue: "CIVIL" })).toContain("-000013");
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "B", disciplineValue: "MEP" })).toContain("-000014");
  });
  it("changing a saved pattern preserves an already issued counter and unrelated modules", async () => {
    mocks.row.documentNumbering.audit = { untouched: true };
    await saveNumberingPattern("org", "lessons", { ...pattern, prefix: "NEW-{Project->Cost Center}", startingNumber: 100 });
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
    expect(mocks.row.documentNumbering.lessons.startingNumber).toBe(1);
    expect(mocks.row.documentNumbering.audit).toEqual({ untouched: true });
    await saveNumberingPattern("org", "lessons", { ...pattern, startingNumber: 500 });
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
  });
  it("reset removes dynamic fields without restarting an issued counter", async () => {
    await resetNumberingPattern("org", "lessons");
    expect(mocks.row.documentNumbering.lessons.prefix).toBe("LL");
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
  });
  it("QA/QC and Audit retain their literal formatter and counters", async () => {
    mocks.row.documentNumbering.audit = { ...pattern, prefix: "AUD", nextNumber: 9 };
    expect(await allocateReferenceNumber("org", "audit")).toBe("AUD-000009");
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
  });
  it.each(["before_prefix", "after_prefix", "after_suffix"] as const)("retains %s running-number positioning", position => {
    const result = formatReferenceNumber({ ...pattern, prefix: "P", suffix: "S", position }, 13);
    expect(result).toBe(position === "before_prefix" ? "000013-P-S" : position === "after_suffix" ? "P-S-000013" : "P-000013-S");
  });
});
