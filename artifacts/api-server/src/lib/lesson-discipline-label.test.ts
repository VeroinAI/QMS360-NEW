import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { lessonDisciplineLabel } from "./lesson-discipline-label";
import { resolveMasterDataGroupId } from "./lov";

vi.mock("./lov", () => ({ resolveMasterDataGroupId: vi.fn() }));

describe("Lesson report discipline labels", () => {
  beforeEach(() => vi.mocked(resolveMasterDataGroupId).mockResolvedValue("discipline-group"));

  function reader(label?: string) {
    const limit = vi.fn().mockResolvedValue(label === undefined ? [] : [{ label }]);
    const where = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) });
    return { db: { select } as unknown as Parameters<typeof lessonDisciplineLabel>[0], where, select };
  }

  it("uses the matching organization's master label, including inactive historical entries", async () => {
    const { db, where } = reader("Civil Engineering");
    expect(await lessonDisciplineLabel(db, "organization-a", "CIV")).toBe("Civil Engineering");
    expect(resolveMasterDataGroupId).toHaveBeenCalledWith(db, "organization-a", "disciplines");
    const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
    expect(query.params).toEqual(["organization-a", "discipline-group", "CIV"]);
    expect(query.sql).toContain('"deleted_at" is null');
    expect(query.sql).not.toContain('"active"');
  });

  it.each([undefined, ""])("keeps a legacy value when no usable label exists (%s)", async label => {
    const { db } = reader(label);
    expect(await lessonDisciplineLabel(db, "organization-a", "OLD")).toBe("OLD");
  });

  it("keeps legacy data when the discipline master is unavailable", async () => {
    vi.mocked(resolveMasterDataGroupId).mockResolvedValue(undefined);
    const { db, select } = reader();
    expect(await lessonDisciplineLabel(db, "organization-a", "CIV")).toBe("CIV");
    expect(select).not.toHaveBeenCalled();
  });
});
