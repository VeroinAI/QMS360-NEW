import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import platformRouter from "./platform";
import appsRouter from "./apps";
import executiveRouter from "./executive";
import integrationsRouter from "./integrations";
import notificationsRouter from "./notifications";
import qaqcRouter from "./qaqc";
import lessonsRouter from "./lessons";
import auditRouter from "./audit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(platformRouter);
router.use(appsRouter);
router.use(executiveRouter);
router.use(integrationsRouter);
router.use(notificationsRouter);
router.use("/qaqc", qaqcRouter);
router.use("/lessons", lessonsRouter);
router.use("/audit", auditRouter);

export default router;
