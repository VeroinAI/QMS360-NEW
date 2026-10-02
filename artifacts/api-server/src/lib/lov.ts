import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { masterDataGroups, masterDataValues } from "@workspace/db";
import { HttpError } from "./workspace";

type Db = typeof import("@workspace/db").db;

type LovOptions = {
  allowLegacy?: string | string[] | null;
};

export function masterDataGroupCodeAliases(groupCode: string): string[] {
  const normalized = groupCode.trim().toLowerCase();
  return ["departments", "department", "department master"].includes(normalized)
    ? ["departments", "department", "department master"]
    : [normalized];
}

export async function getLovValues(db: Db, organizationId: string, groupCode: string) {
  const aliases = masterDataGroupCodeAliases(groupCode);
  const groups = await db.select({ id: masterDataGroups.id, code: masterDataGroups.code }).from(masterDataGroups).where(and(
    eq(masterDataGroups.organizationId, organizationId),
    inArray(sql<string>`lower(${masterDataGroups.code})`, aliases),
    eq(masterDataGroups.status, "active"),
    isNull(masterDataGroups.deletedAt),
  ));
  const group = aliases.map((alias) => groups.find((candidate) => candidate.code.toLowerCase() === alias)).find(Boolean);
  if (!group) return [];
  return db.select({
    value: masterDataValues.value, label: masterDataValues.label,
    sortOrder: masterDataValues.sortOrder, metadata: masterDataValues.metadata,
  }).from(masterDataValues).where(and(
    eq(masterDataValues.organizationId, organizationId), eq(masterDataValues.groupId, group.id),
    eq(masterDataValues.active, true), eq(masterDataValues.status, "active"), isNull(masterDataValues.deletedAt),
  )).orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label));
}

export async function assertLovValue(
  db: Db,
  organizationId: string,
  groupCode: string,
  value: string,
  { allowLegacy }: LovOptions = {},
): Promise<void> {
  const legacyValues = Array.isArray(allowLegacy) ? allowLegacy : allowLegacy == null ? [] : [allowLegacy];
  if (legacyValues.includes(value)) return;

  const aliases = masterDataGroupCodeAliases(groupCode);
  const groups = await db.select({ id: masterDataGroups.id, code: masterDataGroups.code }).from(masterDataGroups).where(and(
    eq(masterDataGroups.organizationId, organizationId),
    inArray(sql<string>`lower(${masterDataGroups.code})`, aliases),
    eq(masterDataGroups.status, "active"),
    isNull(masterDataGroups.deletedAt),
  ));
  const group = aliases
    .map((alias) => groups.find((candidate) => candidate.code.toLowerCase() === alias))
    .find(Boolean);

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