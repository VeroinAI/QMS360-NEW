import { Router } from "express";
import { ListDronaProjectMasterQueryParams, ListDronaProjectMasterResponse, UpdateDronaProjectCostCentreBody, UpdateDronaProjectCostCentreParams, UpdateDronaProjectCostCentreResponse } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { restrictDronaProjects } from "../lib/drona/session";
import { readDronaProjectMaster, saveDronaProjectCostCentre } from "../lib/drona/project-master";
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
router.patch("/integrations/project-master/:projectId/cost-centre", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateDronaProjectCostCentreParams.safeParse(req.params);
  const body = UpdateDronaProjectCostCentreBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(req.body ?? {}).some(key => key !== "costCentre")) {
    res.status(400).json({ error: "Provide a valid project and only a cost center of up to 100 characters." });
    return;
  }
  const costCentre = body.data.costCentre?.trim() || null;
  if (body.data.costCentre && /[\u0000-\u001f\u007f]/.test(body.data.costCentre)) {
    res.status(400).json({ error: "Cost center cannot contain control characters." });
    return;
  }
  const record = await saveDronaProjectCostCentre({
    organizationId: req.currentUser!.organizationId, page: 1, limit: 1,
    scope: restrictDronaProjects(req.dronaProjectIds, { unrestricted: true, projectIds: [] }),
    environment: process.env.AUTH_STRATEGY === "drona" ? process.env.DRONA_ENVIRONMENT : undefined,
  }, params.data.projectId, costCentre);
  if (!record) {
    res.status(404).json({ error: "Project is not available within your current project access." });
    return;
  }
  res.json(UpdateDronaProjectCostCentreResponse.parse(record));
});
export default router;
