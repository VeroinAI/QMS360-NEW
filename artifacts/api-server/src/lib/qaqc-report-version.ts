import { sql, type SQLWrapper } from "drizzle-orm";

/** Keep PostgreSQL microseconds intact for the atomic compare-and-save check.
 * A schema-decoded JS Date has already discarded the last three digits.
 */
export function exactReportVersion(column: SQLWrapper, databaseTimestamp: string) {
  return sql`${column} = ${databaseTimestamp}::timestamptz`;
}
