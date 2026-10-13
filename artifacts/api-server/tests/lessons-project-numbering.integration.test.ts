import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, organizations, organizationSettings, projects, users, lessonLearnedForms } from "@workspace/db";
import { allocateReferenceNumber, getNumberingMap, lessonProjectCounter, saveLessonProjectCounter, saveNumberingPattern } from "../src/lib/numbering";

const org = randomUUID(), projectA = randomUUID(), projectB = randomUUID(), creator = randomUUID();
const pattern = { prefix: "LL", suffix: "", separator: "-", position: "after_prefix" as const, padding: 4, startingNumber: 99 };
const insertForm = async (projectId: string, referenceNumber: string) => db.insert(lessonLearnedForms).values({
  organizationId: org, projectId, creatorId: creator, referenceNumber, title: "Numbering integration fixture",
  issueCategory: "test", impact: "test", capturedAt: new Date(),
});

describe("Lessons project numbering against PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(organizations).values({ id: org, name: "Numbering integration fixture", code: org });
    await db.insert(projects).values([
      { id: projectA, organizationId: org, code: "A", name: "Numbering fixture A" },
      { id: projectB, organizationId: org, code: "B", name: "Numbering fixture B" },
    ]);
    await db.insert(users).values({ id: creator, organizationId: org, username: org, email: `${org}@example.test`, fullName: "Numbering fixture" });
    await saveNumberingPattern(org, "lessons", pattern);
  });
  afterAll(async () => {
    await db.delete(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, org));
    await db.delete(users).where(eq(users.organizationId, org));
    await db.delete(organizationSettings).where(eq(organizationSettings.organizationId, org));
    await db.delete(projects).where(eq(projects.organizationId, org));
    await db.delete(organizations).where(eq(organizations.id, org));
  });
  it("defaults to 1 despite the old shared pattern seed and permits identical references in different projects", async () => {
    const a = await allocateReferenceNumber(org, "lessons", undefined, projectA);
    const b = await allocateReferenceNumber(org, "lessons", undefined, projectB);
    expect(a).toBe("LL-0001");
    expect(b).toBe("LL-0001");
    await insertForm(projectA, a);
    await insertForm(projectB, b);
    await expect(insertForm(projectA, a)).rejects.toMatchObject({ cause: { code: "23505", constraint: "lesson_project_reference_active_idx" } });
  });
  it("serializes simultaneous allocation within a project without modifying the other project's counter", async () => {
    const references = await Promise.all(Array.from({ length: 5 }, () => allocateReferenceNumber(org, "lessons", undefined, projectA)));
    expect(new Set(references).size).toBe(5);
    expect(references.sort()).toEqual(["LL-0002", "LL-0003", "LL-0004", "LL-0005", "LL-0006"]);
    expect(lessonProjectCounter(await getNumberingMap(org), projectB).nextNumber).toBe(2);
  });
  it("supports manual go-live numbering, blocks backward maintenance and preserves stored old references", async () => {
    await saveLessonProjectCounter(org, projectB, 500);
    expect(await allocateReferenceNumber(org, "lessons", undefined, projectB)).toBe("LL-0500");
    await expect(saveLessonProjectCounter(org, projectB, 499)).rejects.toThrow(/greater than/);
    const stored = await db.select().from(lessonLearnedForms).where(eq(lessonLearnedForms.organizationId, org));
    expect(stored.map(form => form.referenceNumber)).toEqual(["LL-0001", "LL-0001"]);
  });
  it("protects against an existing same-project go-live reference using the real regex query", async () => {
    await insertForm(projectA, "LL-0800");
    await insertForm(projectA, "LL-0805");
    await saveLessonProjectCounter(org, projectA, 800);
    expect(await allocateReferenceNumber(org, "lessons", undefined, projectA)).toBe("LL-0806");
    const [stored] = await db.select().from(lessonLearnedForms).where(and(eq(lessonLearnedForms.projectId, projectA), eq(lessonLearnedForms.referenceNumber, "LL-0800")));
    expect(stored).toBeTruthy();
  });
});
