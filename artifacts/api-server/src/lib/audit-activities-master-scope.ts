import { and, eq, isNull, sql } from "drizzle-orm";
import { db, masterDataGroups } from "@workspace/db";

type Db = typeof db;

/** Data correction only: preserve group IDs, values, metadata and saved plan references. */
export function moveAuditActivitiesMaster(database: Db = db) {
  return database.update(masterDataGroups)
    .set({ appScope: "audit", updatedAt: new Date() })
    .where(and(
      eq(sql<string>`lower(${masterDataGroups.code})`, "activities"),
      eq(masterDataGroups.appScope, "qaqc"),
      isNull(masterDataGroups.deletedAt),
    ))
    .returning({ id: masterDataGroups.id });
}
