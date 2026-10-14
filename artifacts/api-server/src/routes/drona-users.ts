import { Router } from "express";
import {
  AddDronaUserBody, AddDronaUserResponse, LookupDronaUserBody, LookupDronaUserResponse,
} from "@workspace/api-zod";
import { requireAuth, requirePlatformRole } from "../middlewares/auth";
import { addDronaAdminUser, lookupDronaAdminUser } from "../lib/drona/admin-users";
import { DronaAccessError } from "../lib/drona/errors";

const router = Router();
const superAdmin = requirePlatformRole("Super Admin");

for (const action of ["lookup", "add"] as const) {
  router.post(`/platform/drona-users${action === "lookup" ? "/lookup" : ""}`,
    requireAuth, superAdmin, async (req, res): Promise<void> => {
      const parsed = (action === "lookup" ? LookupDronaUserBody : AddDronaUserBody).safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: "Enter a valid email and search for the Drona user before adding." });
        return;
      }
      try {
        if (action === "lookup") {
          res.json(LookupDronaUserResponse.parse(await lookupDronaAdminUser(
            parsed.data.email, req.currentUser!.organizationId,
          )));
        } else {
          const data = AddDronaUserBody.parse(req.body);
          res.json(AddDronaUserResponse.parse(await addDronaAdminUser({
            email: data.email, externalUserId: data.externalUserId,
            organizationId: req.currentUser!.organizationId, actorId: req.currentUser!.id, ipAddress: req.ip,
          })));
        }
      } catch (error) {
        if (error instanceof DronaAccessError) {
          res.status(error.status).json({ error: error.message });
        } else {
          // Avoid logging submitted email, credentials or a full SQL error with parameters.
          req.log?.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Drona administrator user lookup/add failed");
          res.status(503).json({ error: "Drona user data is unavailable. Check backend source-table permissions and Drona configuration." });
        }
      }
    });
}
export default router;
