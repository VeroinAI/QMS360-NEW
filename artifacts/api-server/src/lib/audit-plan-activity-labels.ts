import { and, eq, isNull, sql } from "drizzle-orm";
import { masterDataGroups, masterDataValues } from "@workspace/db";

type Db = typeof import("@workspace/db").db;

export function auditPlanActivityLabelsQuery(db: Db, organizationId: string) {
  // Master group codes may retain title case. Include inactive values for historical plans.
  return db.select({ value: masterDataValues.value, label: masterDataValues.label }).from(masterDataValues)
    .innerJoin(masterDataGroups, eq(masterDataGroups.id, masterDataValues.groupId))
    .where(and(eq(masterDataGroups.organizationId, organizationId),
      eq(sql<string>`lower(${masterDataGroups.code})`, "activities"),
      isNull(masterDataGroups.deletedAt), eq(masterDataValues.organizationId, organizationId),
      isNull(masterDataValues.deletedAt)));
}

export function auditAreaLabelsQuery(db: Db, organizationId: string) {
  return db.select({ value: masterDataValues.value, label: masterDataValues.label }).from(masterDataValues)
    .innerJoin(masterDataGroups, eq(masterDataGroups.id, masterDataValues.groupId))
    .where(and(eq(masterDataGroups.organizationId, organizationId),
      eq(sql<string>`regexp_replace(lower(${masterDataGroups.code}), '[^a-z]', '', 'g')`, "auditarea"),
      isNull(masterDataGroups.deletedAt), eq(masterDataValues.organizationId, organizationId),
      isNull(masterDataValues.deletedAt)));
}
