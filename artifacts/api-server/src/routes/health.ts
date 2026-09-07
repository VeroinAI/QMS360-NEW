import { Router, type IRouter, type RequestHandler } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const healthCheckHandler: RequestHandler = (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
};

// The deployment sidecar probes the artifact's preview path (`/api`) even when
// a more specific startup health path is configured in artifact.toml.
router.get("/", healthCheckHandler);
router.get("/healthz", healthCheckHandler);

export default router;
