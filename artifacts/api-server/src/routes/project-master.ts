import { Router } from "express";
import { ListDronaProjectMasterQueryParams, ListDronaProjectMasterResponse } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { restrictDronaProjects } from "../lib/drona/session";
import { readDronaProjectMaster } from "../lib/drona/project-master";
import { pagination } from "../lib/workspace";

const router = Router();
router.get("/integrations/project-master", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { page, limit } = pagination(req);
  const parsed = ListDronaProjectMasterQueryParams.safeParse({ page, limit, search: req.query.search });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Project Master search parameters" });
    return;
  }
  const scope = restrictDronaProjects(req.dronaProjectIds, { unrestricted: true, projectIds: [] });
  const result = await readDronaProjectMaster({
    organizationId: req.currentUser!.organizationId,
    page, limit, search: parsed.data.search, scope,
    environment: process.env.AUTH_STRATEGY === "drona" ? process.env.DRONA_ENVIRONMENT : undefined,
  });
  res.json(ListDronaProjectMasterResponse.parse(result));
});
export default router;
