import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { assertNoMonthlyDuplicate, isReportPeriodDuplicate, lockMonthlyCreation, monthlyDuplicateMessage, monthlyDuplicateReason } from "./qaqc-report-duplicates";

const index = "qaqc_report_project_type_period_active_idx";
type Reader = NonNullable<Parameters<typeof monthlyDuplicateReason>[3]>;
const reader = (state?: string) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state ? [{ state }] : [] }) }) }),
}) as unknown as Reader;

describe("Monthly report duplicate guards", () => {
  it.each(["draft", "submitted", "approved", "sent_back", "rejected"])("blocks an existing %s report with its status and reporting month", async state => {
    const reason = await monthlyDuplicateReason("org", "project", "2026-10-01", reader(state));
    expect(reason).toBe(monthlyDuplicateMessage("2026-10-01", state));
    expect(reason).toContain("October 2026");
    expect(reason).toContain("Report status:");
    await expect(assertNoMonthlyDuplicate("org", "project", "2026-10-01", reader(state))).rejects.toMatchObject({ status: 409, message: reason });
  });
  it("allows creation when no existing report is found", async () => {
    expect(await monthlyDuplicateReason("org", "project", "2026-10-01", reader())).toBeNull();
    await expect(assertNoMonthlyDuplicate("org", "project", "2026-10-01", reader())).resolves.toBeUndefined();
  });
  it("looks up the exact tenant, project, monthly type and period, excluding deleted reports without disclosing their contents", async () => {
    let condition: SQL | undefined;
    let selected: Record<string, unknown> = {};
    const scoped = {
      select: (fields: Record<string, unknown>) => {
        selected = fields;
        return { from: () => ({ where: (sql: SQL) => { condition = sql; return { limit: async () => [] }; } }) };
      },
    } as unknown as Reader;
    await monthlyDuplicateReason("tenant-a", "project-b", "2026-09-01", scoped);
    const query = new PgDialect().sqlToQuery(condition!);
    expect(query.params).toEqual(["tenant-a", "project-b", "monthly", "2026-09-01"]);
    expect(query.sql).toContain('"deleted_at" is null');
    expect(Object.keys(selected)).toEqual(["state"]);
  });
  it("rechecks using the supplied locked transaction rather than an earlier availability result", async () => {
    expect(await monthlyDuplicateReason("org", "project", "2026-10-01", reader())).toBeNull();
    // Another creator commits before this request obtains its project lock.
    await expect(assertNoMonthlyDuplicate("org", "project", "2026-10-01", reader("draft"))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Report status: Draft") });
  });
  it("awaits the project lock before checking the committed report state", async () => {
    const events: string[] = [];
    let unlock!: () => void;
    const lock = new Promise<void>(resolve => { unlock = resolve; });
    const transaction = {
      select: (fields: Record<string, unknown>) => ({ from: () => ({ where: () => "id" in fields
        ? { for: () => { events.push("lock"); return lock; } }
        : { limit: async () => { events.push("check"); return [{ state: "draft" }]; } },
      }) }),
    } as unknown as Reader;
    const pending = lockMonthlyCreation("org", "project", "2026-10-01", transaction);
    expect(events).toEqual(["lock"]);
    unlock();
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(events).toEqual(["lock", "check"]);
  });
});

describe("Wrapped PostgreSQL duplicate errors", () => {
  it("recognizes the original raw constraint violation", () => {
    expect(isReportPeriodDuplicate({ code: "23505", constraint: index })).toBe(true);
  });
  it("recognizes Drizzle's nested cause even though its outer message has no constraint name", () => {
    const error = Object.assign(new Error("Failed query: insert into report submissions"), {
      cause: Object.assign(new Error("Prepared query failed"), { cause: { code: "23505", constraint: index } }),
    });
    expect(isReportPeriodDuplicate(error)).toBe(true);
  });
  it("preserves detection for older errors containing the index in the message", () => {
    expect(isReportPeriodDuplicate(new Error(`duplicate key violates unique constraint "${index}"`))).toBe(true);
  });
  it("does not mistake an index name in logged query data for the real database failure", () => {
    expect(isReportPeriodDuplicate({
      message: `Failed query with user text: duplicate key violates unique constraint "${index}"`,
      cause: { code: "23503", constraint: "some_foreign_key" },
    })).toBe(false);
  });
  it.each([null, undefined, "error", { code: "23505", constraint: "different_index" }, { code: "23503", constraint: index }, { message: {} }])("does not misclassify unrelated errors: %j", error => {
    expect(isReportPeriodDuplicate(error)).toBe(false);
  });
  it("terminates safely for cyclic error causes", () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(isReportPeriodDuplicate(cycle)).toBe(false);
  });
});
