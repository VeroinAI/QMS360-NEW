import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auditNotifications, db, lessonNotifications, notifications } from "@workspace/db";
import { paginated, pagination, type AppKey } from "../lib/workspace";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const tables = { qaqc: notifications, lessons: lessonNotifications, audit: auditNotifications };

router.get("/notifications", requireAuth, async (req, res) => {
  const user = req.currentUser!;
  const { page, limit } = pagination(req);
  const lists = await Promise.all((Object.entries(tables) as [AppKey, typeof notifications][]).map(async ([app, table]) => {
    const rows = await db.select().from(table).where(and(
      eq(table.organizationId, user.organizationId), eq(table.recipientId, user.id), isNull(table.deletedAt),
    )).orderBy(desc(table.createdAt)).limit(page * limit);
    return rows.map((row) => ({ ...row, app }));
  }));
  const all = lists.flat().sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
  res.json(paginated(all.slice((page - 1) * limit, page * limit), all.length, page, limit));
});

router.post("/notifications/:app/:id/read", requireAuth, async (req, res): Promise<void> => {
  const app = String(req.params.app) as AppKey;
  const table = tables[app];
  if (!table) { res.status(422).json({ error: "Unknown application" }); return; }
  const typedTable: any = table;
  const [row] = await db.update(typedTable).set({ readAt: new Date(), updatedAt: new Date() }).where(and(
    eq(typedTable.id, String(req.params.id)), eq(typedTable.organizationId, req.currentUser!.organizationId),
    eq(typedTable.recipientId, req.currentUser!.id), isNull(typedTable.deletedAt),
  )).returning();
  if (!row) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json(row);
});

export default router;