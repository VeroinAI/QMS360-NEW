import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CreateMasterDataGroupBody,
  CreateMasterDataGroupResponse,
  CreateMasterDataValueBody,
  CreateMasterDataValueResponse,
  GetMasterDataLovResponse,
  ListMasterDataResponse,
  UpdateMasterDataGroupBody,
  UpdateMasterDataGroupResponse,
  UpdateMasterDataValueBody,
  UpdateMasterDataValueResponse,
} from "@workspace/api-zod";
import { db, masterDataGroups, masterDataValues } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { asyncHandler, HttpError, writeAuditLog } from "../lib/workspace";
import { masterDataGroupCodeAliases } from "../lib/lov";

const router: IRouter = Router();
router.use(requireAuth);

type Group = typeof masterDataGroups.$inferSelect;
type Value = typeof masterDataValues.$inferSelect;

function valueResponse(row: Value) {
  return {
    id: row.id,
    groupId: row.groupId,
    value: row.value,
    label: row.label,
    sortOrder: row.sortOrder,
    active: row.active,
    metadata: row.metadata,
  };
}

function groupResponse(row: Group, values: Value[]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    appScope: row.appScope as "global" | "qaqc" | "lessons" | "audit",
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    values: values.filter((value) => value.groupId === row.id).map(valueResponse),
  };
}

async function auditAll(input: {
  organizationId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
}) {
  await Promise.all([
    writeAuditLog(db, "qaqc", input),
    writeAuditLog(db, "lessons", input),
    writeAuditLog(db, "audit", input),
  ]);
}

router.get("/platform/master-data", requireAdmin, asyncHandler(async (req, res) => {
  const organizationId = req.currentUser!.organizationId;
  const [groups, values] = await Promise.all([
    db.select().from(masterDataGroups).where(and(
      eq(masterDataGroups.organizationId, organizationId),
      isNull(masterDataGroups.deletedAt),
    )).orderBy(asc(masterDataGroups.sortOrder), asc(masterDataGroups.name)),
    db.select().from(masterDataValues).where(and(
      eq(masterDataValues.organizationId, organizationId),
      isNull(masterDataValues.deletedAt),
    )).orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label)),
  ]);
  res.json(ListMasterDataResponse.parse({
    items: groups.map((group) => groupResponse(group, values)),
    total: groups.length,
  }));
}));

router.get("/platform/master-data/lov/:code", asyncHandler(async (req, res) => {
  const organizationId = req.currentUser!.organizationId;
  const requestedCode = String(req.params.code);
  const aliases = masterDataGroupCodeAliases(requestedCode);
  const groups = await db.select().from(masterDataGroups).where(and(
    eq(masterDataGroups.organizationId, organizationId),
    inArray(sql<string>`lower(${masterDataGroups.code})`, aliases),
    isNull(masterDataGroups.deletedAt),
  ));
  const group = aliases
    .map((alias) => groups.find((candidate) => candidate.code.toLowerCase() === alias))
    .find(Boolean);
  if (!group) throw new HttpError(404, "Master data group not found");
  const values = await db.select().from(masterDataValues).where(and(
    eq(masterDataValues.organizationId, organizationId),
    eq(masterDataValues.groupId, group.id),
    eq(masterDataValues.active, true),
    isNull(masterDataValues.deletedAt),
  )).orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label));
  res.json(GetMasterDataLovResponse.parse({
    code: group.code,
    values: values.map(({ value, label, sortOrder, metadata }) => ({ value, label, sortOrder, metadata })),
  }));
}));

router.post("/platform/master-data/groups", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = CreateMasterDataGroupBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid master data group");
  const user = req.currentUser!;
  const [duplicate] = await db.select({ id: masterDataGroups.id }).from(masterDataGroups).where(and(
    eq(masterDataGroups.organizationId, user.organizationId),
    eq(masterDataGroups.code, parsed.data.code),
    isNull(masterDataGroups.deletedAt),
  )).limit(1);
  if (duplicate) throw new HttpError(409, "Master data group code already exists");
  const [created] = await db.insert(masterDataGroups).values({
    organizationId: user.organizationId,
    ...parsed.data,
  }).returning();
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "create",
    entityType: "master_data_group", entityId: created!.id, after: created!, ipAddress: req.ip,
  });
  res.status(201).json(CreateMasterDataGroupResponse.parse(groupResponse(created!, [])));
}));

router.put("/platform/master-data/groups/:id", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = UpdateMasterDataGroupBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid master data group");
  const user = req.currentUser!;
  const [before] = await db.select().from(masterDataGroups).where(and(
    eq(masterDataGroups.id, String(req.params.id)),
    eq(masterDataGroups.organizationId, user.organizationId),
    isNull(masterDataGroups.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Master data group not found");
  const [updated] = await db.update(masterDataGroups).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(
      eq(masterDataGroups.id, before.id),
      eq(masterDataGroups.organizationId, user.organizationId),
    )).returning();
  const values = await db.select().from(masterDataValues).where(and(
    eq(masterDataValues.organizationId, user.organizationId),
    eq(masterDataValues.groupId, before.id),
    isNull(masterDataValues.deletedAt),
  )).orderBy(asc(masterDataValues.sortOrder), asc(masterDataValues.label));
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "update",
    entityType: "master_data_group", entityId: before.id, before, after: updated!, ipAddress: req.ip,
  });
  res.json(UpdateMasterDataGroupResponse.parse(groupResponse(updated!, values)));
}));

router.delete("/platform/master-data/groups/:id", requireAdmin, asyncHandler(async (req, res) => {
  const user = req.currentUser!;
  const [before] = await db.select().from(masterDataGroups).where(and(
    eq(masterDataGroups.id, String(req.params.id)),
    eq(masterDataGroups.organizationId, user.organizationId),
    isNull(masterDataGroups.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Master data group not found");
  if (before.isSystem) throw new HttpError(409, "System master data groups cannot be deleted");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(masterDataValues).set({ deletedAt: now, status: "deleted", updatedAt: now })
      .where(and(
        eq(masterDataValues.organizationId, user.organizationId),
        eq(masterDataValues.groupId, before.id),
        isNull(masterDataValues.deletedAt),
      ));
    await tx.update(masterDataGroups).set({ deletedAt: now, status: "deleted", updatedAt: now })
      .where(and(
        eq(masterDataGroups.id, before.id),
        eq(masterDataGroups.organizationId, user.organizationId),
      ));
  });
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "delete",
    entityType: "master_data_group", entityId: before.id, before, ipAddress: req.ip,
  });
  res.status(204).send();
}));

router.post("/platform/master-data/groups/:groupId/values", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = CreateMasterDataValueBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid master data value");
  const user = req.currentUser!;
  const [group] = await db.select({ id: masterDataGroups.id }).from(masterDataGroups).where(and(
    eq(masterDataGroups.id, String(req.params.groupId)),
    eq(masterDataGroups.organizationId, user.organizationId),
    isNull(masterDataGroups.deletedAt),
  )).limit(1);
  if (!group) throw new HttpError(404, "Master data group not found");
  const [duplicate] = await db.select({ id: masterDataValues.id }).from(masterDataValues).where(and(
    eq(masterDataValues.organizationId, user.organizationId),
    eq(masterDataValues.groupId, group.id),
    eq(masterDataValues.value, parsed.data.value),
    isNull(masterDataValues.deletedAt),
  )).limit(1);
  if (duplicate) throw new HttpError(409, "Master data value already exists");
  const [created] = await db.insert(masterDataValues).values({
    organizationId: user.organizationId,
    groupId: group.id,
    ...parsed.data,
    label: parsed.data.label ?? parsed.data.value,
  }).returning();
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "create",
    entityType: "master_data_value", entityId: created!.id, after: created!, ipAddress: req.ip,
  });
  res.status(201).json(CreateMasterDataValueResponse.parse(valueResponse(created!)));
}));

router.put("/platform/master-data/values/:id", requireAdmin, asyncHandler(async (req, res) => {
  const parsed = UpdateMasterDataValueBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid master data value");
  const user = req.currentUser!;
  const [before] = await db.select().from(masterDataValues).where(and(
    eq(masterDataValues.id, String(req.params.id)),
    eq(masterDataValues.organizationId, user.organizationId),
    isNull(masterDataValues.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Master data value not found");
  if (parsed.data.value && parsed.data.value !== before.value) {
    const [duplicate] = await db.select({ id: masterDataValues.id }).from(masterDataValues).where(and(
      eq(masterDataValues.organizationId, user.organizationId),
      eq(masterDataValues.groupId, before.groupId),
      eq(masterDataValues.value, parsed.data.value),
      isNull(masterDataValues.deletedAt),
    )).limit(1);
    if (duplicate) throw new HttpError(409, "Master data value already exists");
  }
  const [updated] = await db.update(masterDataValues).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(
      eq(masterDataValues.id, before.id),
      eq(masterDataValues.organizationId, user.organizationId),
    )).returning();
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "update",
    entityType: "master_data_value", entityId: before.id, before, after: updated!, ipAddress: req.ip,
  });
  res.json(UpdateMasterDataValueResponse.parse(valueResponse(updated!)));
}));

router.delete("/platform/master-data/values/:id", requireAdmin, asyncHandler(async (req, res) => {
  const user = req.currentUser!;
  const [before] = await db.select().from(masterDataValues).where(and(
    eq(masterDataValues.id, String(req.params.id)),
    eq(masterDataValues.organizationId, user.organizationId),
    isNull(masterDataValues.deletedAt),
  )).limit(1);
  if (!before) throw new HttpError(404, "Master data value not found");
  const now = new Date();
  await db.update(masterDataValues).set({ deletedAt: now, status: "deleted", updatedAt: now })
    .where(and(
      eq(masterDataValues.id, before.id),
      eq(masterDataValues.organizationId, user.organizationId),
    ));
  await auditAll({
    organizationId: user.organizationId, actorId: user.id, action: "delete",
    entityType: "master_data_value", entityId: before.id, before, ipAddress: req.ip,
  });
  res.status(204).send();
}));

export default router;