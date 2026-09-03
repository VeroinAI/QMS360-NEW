import { and, asc, eq, isNull } from "drizzle-orm";
import { masterDataGroups, masterDataValues } from "@workspace/db";
import { HttpError } from "./workspace";

type Db = typeof import("@workspace/db").db;

type LovOptions = {
  allowLegacy?: string | string[] | null;
};

export async function assertLovValue(
  db: Db,
  organizationId: string,
  groupCode: string,
  value: string,
  { allowLegacy }: LovOptions = {},
): Promise<void> {
  const legacyValues = Array.isArray(allowLegacy) ? allowLegacy : allowLegacy == null ? [] : [allowLegacy];
  if (legacyValues.includes(value)) return;

  const [group] = await db.select({ id: masterDataGroups.id }).from(masterDataGroups).where(and(
    eq(masterDataGroups.organizationId, organizationId),
    eq(masterDataGroups.code, groupCode),
    eq(masterDataGroups.status, "active"),
    isNull(masterDataGroups.deletedAt),
  )).limit(1);

  const validValues = group
    ? await db.select({ value: masterDataValues.value }).from(masterDataValues).where(and(
      eq(masterDataValues.organizationId, organizationId),
      eq(masterDataValues.groupId, group.id),
      eq(masterDataValues.active, true),
      eq(masterDataValues.status, "active"),
      isNull(masterDataValues.deletedAt),
    )).orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label))
    : [];

  const options = validValues.map((row) => row.value);
  if (!options.includes(value)) {
    throw new HttpError(
      422,
      `Invalid value "${value}" for ${groupCode}. Valid options: ${options.length ? options.join(", ") : "(none configured)"}`,
    );
  }
}