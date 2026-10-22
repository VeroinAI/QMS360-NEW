import { and, eq, isNull } from "drizzle-orm";
import { masterDataValues } from "@workspace/db";
import { resolveMasterDataGroupId } from "./lov";

type Db = typeof import("@workspace/db").db;

/** Resolve report display text only; stored discipline values and numbering stay unchanged. */
export async function lessonDisciplineLabel(db: Db, organizationId: string, value: string) {
  if (!value) return value;
  const groupId = await resolveMasterDataGroupId(db, organizationId, "disciplines");
  if (!groupId) return value;
  const [master] = await db.select({ label: masterDataValues.label }).from(masterDataValues).where(and(
    eq(masterDataValues.organizationId, organizationId),
    eq(masterDataValues.groupId, groupId),
    eq(masterDataValues.value, value),
    isNull(masterDataValues.deletedAt),
  )).limit(1);
  // Inactive entries still describe historical records. Unmapped legacy values remain readable.
  return master?.label?.trim() || value;
}
