import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import filesRouter from "./routes/files";
import feedbackFilesRouter from "./routes/feedback-files";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Unset CORS_ORIGINS keeps today's fully-open behavior (local dev, and any
// deploy where the frontend is same-origin) -- only a real split deploy
// (S3/CloudFront frontend, separate backend) needs to set this.
const allowedOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
// Evidence uploads are raw bytes and must be parsed before the global JSON middleware.
app.use("/api/files", filesRouter);
app.use("/api/feedback/attachments", feedbackFilesRouter);
// 2MB accommodates base64-encoded signature uploads (512KB decoded) on the user profile route.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
