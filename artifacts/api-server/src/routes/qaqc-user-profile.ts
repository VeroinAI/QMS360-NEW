import { Readable } from "node:stream";
import { Router, type Request, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, users, userWorkspaceRoles } from "@workspace/db";
import { UpdateQaqcUserProfileBody, UpdateQaqcUserProfileResponse } from "@workspace/api-zod";
import { visibleAdminUsers } from "../lib/admin-user-discovery";
import { getObject, storeObject } from "../lib/objectStorage";
import { toStorageKey } from "../lib/storage-config";
import { decodeProfileSignature } from "../lib/profile-signature";
import { asyncHandler, HttpError, writeAuditLog } from "../lib/workspace";

/** Mounted after QA/QC's application and manage_roles guards. */
const router: IRouter = Router();
async function managedUser(req: Request) {
  const organizationId = req.currentUser!.organizationId;
  const [target] = await db.select().from(users).where(and(
    eq(users.id, String(req.params.userId)), eq(users.organizationId, organizationId), isNull(users.deletedAt),
  )).limit(1);
  if (!target) throw new HttpError(404, "User not found");
  const assignments = await db.select().from(userWorkspaceRoles).where(and(
    eq(userWorkspaceRoles.organizationId, organizationId), eq(userWorkspaceRoles.userId, target.id),
    eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt),
  ));
  if (!(await visibleAdminUsers(req, [target], assignments)).length)
    throw new HttpError(403, "You do not have access to manage this user's QA/QC profile");
  return target;
}

router.put("/:userId/profile", asyncHandler(async (req, res) => {
  const parsed = UpdateQaqcUserProfileBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.message);
  const target = await managedUser(req), data = parsed.data;
  let signaturePath = target.signaturePath;
  if (data.signatureDataUrl) {
    const { bytes, mimeType } = await decodeProfileSignature(data.signatureDataUrl);
    signaturePath = toStorageKey(await storeObject(`qms360/signatures/${target.id}`, bytes, mimeType));
  } else if (data.signatureDataUrl === null) signaturePath = null;
  const [row] = await db.update(users).set({
    designation: data.designation === undefined ? target.designation : data.designation?.trim() || null,
    signaturePath, updatedAt: new Date(),
  }).where(and(eq(users.id, target.id), eq(users.organizationId, req.currentUser!.organizationId), isNull(users.deletedAt))).returning();
  if (!row) throw new HttpError(404, "User not found");
  await writeAuditLog(db, "qaqc", {
    organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id,
    action: "update", entityType: "user_profile", entityId: row.id,
    before: { designation: target.designation, hasSignature: Boolean(target.signaturePath) },
    after: { designation: row.designation, hasSignature: Boolean(row.signaturePath) },
  });
  res.json(UpdateQaqcUserProfileResponse.parse({
    id: row.id, designation: row.designation,
    signatureUrl: row.signaturePath ? `/api/qaqc/admin/users/${row.id}/signature` : null,
  }));
}));
router.get("/:userId/signature", asyncHandler(async (req, res) => {
  const target = await managedUser(req);
  if (!target.signaturePath) throw new HttpError(404, "Signature not found");
  const object = await getObject(target.signaturePath.replace(/^gcs:/, ""));
  res.setHeader("content-type", object.headers.get("content-type") ?? "image/png");
  res.setHeader("cache-control", "private, no-store");
  Readable.fromWeb(object.body as any).pipe(res);
}));
export default router;
