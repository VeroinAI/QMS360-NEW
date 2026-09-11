import { Router, type IRouter } from "express";
import { auditNotifications, db, lessonNotifications, notifications } from "@workspace/db";
import { listNotifications, markNotificationRead, paginated, pagination, type AppKey } from "../lib/workspace";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const tables = { qaqc: notifications, lessons: lessonNotifications, audit: auditNotifications };

router.get("/notifications", requireAuth, async (req, res) => {
  const user = req.currentUser!;
  const { page, limit } = pagination(req);
  const lists = await Promise.all((Object.keys(tables) as AppKey[]).map(async (app) => {
    const rows = await listNotifications(db, app, user.organizationId, user.id);
    return rows.map((row) => ({ ...row, app }));
  }));
  const all = lists.flat().sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf());
  res.json(paginated(all.slice((page - 1) * limit, page * limit), all.length, page, limit));
});

router.post("/notifications/:app/:id/read", requireAuth, async (req, res): Promise<void> => {
  const app = String(req.params.app) as AppKey;
  const table = tables[app];
  if (!table) { res.status(422).json({ error: "Unknown application" }); return; }
  const id = await markNotificationRead(db, app, req.currentUser!.organizationId, req.currentUser!.id, String(req.params.id));
  if (!id) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json({ id });
});

export default router;