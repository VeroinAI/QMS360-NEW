import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LESSON_NUMBER_FIELDS, projectNumberContext, referencePrefixError, ReferencePrefixError, resolveReferencePrefix,
} from "@workspace/field-controls";

const mocks = vi.hoisted(() => ({
  row: { id: "settings", documentNumbering: {} as Record<string, any> },
  update: vi.fn(), transaction: vi.fn(),
  collision: false, highest: 0,
}));
vi.mock("@workspace/db", () => {
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: (selection?: unknown) => ({ from: () => ({ where: () => ({
      for: () => ({ limit: async () => [mocks.row] }),
      limit: async () => selection ? mocks.collision ? [{ id: "existing" }] : [] : [mocks.row],
    }) }) }),
    execute: async () => ({ rows: [{ highest: mocks.highest }] }),
    update: () => ({ set: (data: any) => ({ where: async () => {
      mocks.update(data); mocks.row.documentNumbering = data.documentNumbering;
    } }) }),
  };
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
  return { db: { transaction: mocks.transaction }, organizationSettings: { id: "id", organizationId: "organization_id", deletedAt: "deleted_at" },
    lessonLearnedForms: { id: "form-id", organizationId: "org", projectId: "project", referenceNumber: "reference" } };
});
import { allocateReferenceNumber, formatReferenceNumber, resetNumberingPattern, saveNumberingPattern, saveLessonProjectCounter, lessonProjectCounter } from "./numbering";

const prefix = "AGH-QAM-LL-{Project->Cost Center}-{Discipline Master->Value}";
const pattern = { prefix, suffix: "", separator: "-", position: "after_prefix" as const, padding: 6, startingNumber: 1 };

beforeEach(() => {
  mocks.row.documentNumbering = { lessons: { ...pattern, nextNumber: 13, custom: true } };
  mocks.update.mockClear();
  mocks.collision = false;
  mocks.highest = 0;
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
  it("starts an unmaintained project at 1 and advances only its counter", async () => {
    const result = await allocateReferenceNumber("org", "lessons", { costCentre: "CC105", disciplineValue: "CIVIL" }, "project-a");
    expect(result).toBe("AGH-QAM-LL-CC105-CIVIL-000001");
    expect(mocks.row.documentNumbering.lessons.prefix).toBe(prefix);
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
    expect(lessonProjectCounter(mocks.row.documentNumbering, "project-a").nextNumber).toBe(2);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
  it("missing values do not update or advance the counter", async () => {
    await expect(allocateReferenceNumber("org", "lessons", { disciplineValue: "CIVIL" }, "project-a")).rejects.toThrow(/Cost Center/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.row.documentNumbering.lessons.nextNumber).toBe(13);
  });
  it("different projects start independently, and disciplines within a project share its counter", async () => {
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "A", disciplineValue: "CIVIL" }, "a")).toContain("-000001");
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "B", disciplineValue: "MEP" }, "b")).toContain("-000001");
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "A", disciplineValue: "MEP" }, "a")).toContain("-000002");
  });
  it("uses a manually maintained go-live start and rejects reusing an allocated number", async () => {
    await saveLessonProjectCounter("org", "a", 500);
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "A", disciplineValue: "CIVIL" }, "a")).toContain("-000500");
    await expect(saveLessonProjectCounter("org", "a", 500)).rejects.toThrow(/greater than/);
    await saveLessonProjectCounter("org", "a", 700);
    expect(lessonProjectCounter(mocks.row.documentNumbering, "a").nextNumber).toBe(700);
    expect(lessonProjectCounter(mocks.row.documentNumbering, "b").nextNumber).toBe(1);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 1_000_000_000_000])("rejects invalid manual next numbers (%s)", async number => {
    await expect(saveLessonProjectCounter("org", "a", number)).rejects.toThrow(/whole next number/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves project ranges through pattern edits and resets", async () => {
    await saveLessonProjectCounter("org", "a", 500);
    await saveNumberingPattern("org", "lessons", { ...pattern, prefix: "NEW", startingNumber: 1000 });
    expect(lessonProjectCounter(mocks.row.documentNumbering, "a").nextNumber).toBe(500);
    await resetNumberingPattern("org", "lessons");
    expect(lessonProjectCounter(mocks.row.documentNumbering, "a").nextNumber).toBe(500);
  });
  it("skips colliding historical references only in the selected project", async () => {
    mocks.collision = true;
    mocks.highest = 22;
    expect(await allocateReferenceNumber("org", "lessons", { costCentre: "A", disciplineValue: "CIVIL" }, "a")).toContain("-000023");
    expect(lessonProjectCounter(mocks.row.documentNumbering, "a").lastIssued).toBe(23);
  });
  it("never silently falls back to the old global Lessons counter", async () => {
    await expect(allocateReferenceNumber("org", "lessons")).rejects.toThrow(/project is required/);
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
