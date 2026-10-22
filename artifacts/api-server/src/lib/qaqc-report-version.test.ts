import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { exactReportVersion } from "./qaqc-report-version";

describe("QA/QC report atomic save versions", () => {
  const stored = "2026-10-19 09:16:39.899913+00";
  it("binds the exact database timestamp, without a lossy Date conversion", () => {
    const query = new PgDialect().sqlToQuery(exactReportVersion(sql`updated_at`, stored));
    expect(query.sql).toBe("updated_at = $1::timestamptz");
    expect(query.params).toEqual([stored]);
    expect(new Date(stored).toISOString()).toBe("2026-10-19T09:16:39.899Z");
  });
  it("accepts unchanged microsecond versions and rejects real concurrent changes, even within one millisecond", async () => {
    // Read-only, self-contained PostgreSQL fixture: no customer records are changed.
    const result = await db.execute(sql`
      WITH fixture(updated_at) AS (VALUES (${stored}::timestamptz))
      SELECT
        ${exactReportVersion(sql`updated_at`, stored)} AS unchanged,
        ${exactReportVersion(sql`updated_at`, "2026-10-19 09:16:39.899914+00")} AS concurrent,
        ${exactReportVersion(sql`updated_at`, new Date(stored).toISOString())} AS lossy,
        ${exactReportVersion(sql`updated_at`, "2026-10-19 12:16:39.899913+03")} AS same_instant
      FROM fixture
    `);
    expect(result.rows[0]).toEqual({ unchanged: true, concurrent: false, lossy: false, same_instant: true });
  });
  it("continues to accept timestamps written with millisecond precision", async () => {
    const value = "2026-10-19T09:16:39.899Z";
    const result = await db.execute(sql`
      WITH fixture(updated_at) AS (VALUES (${value}::timestamptz))
      SELECT ${exactReportVersion(sql`updated_at`, value)} AS matches FROM fixture
    `);
    expect(result.rows[0]).toEqual({ matches: true });
  });
});
