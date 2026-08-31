import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import platformRouter from "./platform";
import appsRouter from "./apps";
import executiveRouter from "./executive";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(platformRouter);
router.use(appsRouter);
router.use(executiveRouter);

export default router;
