import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let mustChangePasswordColumnAvailable: boolean | undefined;

export async function hasMustChangePasswordColumn(): Promise<boolean> {
  if (mustChangePasswordColumnAvailable !== undefined) {
    return mustChangePasswordColumnAvailable;
  }

  const result = await db.execute<{ available: boolean }>(sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'shared'
        and table_name = 'users'
        and column_name = 'must_change_password'
    ) as available
  `);
  mustChangePasswordColumnAvailable = result.rows[0]?.available ?? false;
  return mustChangePasswordColumnAvailable;
}