import "./lib/database-pool-errors";
import app from "./app";
import { logger } from "./lib/logger";
import { startEscalationScheduler } from "./lib/escalation";
import { startEmailQueueScheduler } from "./lib/email-queue";
import { runLessonsEscalationDigest } from "./lib/lessons-escalation-digest";
import { runQaqcReportingAutomation } from "./lib/qaqc-reporting-automation";
import { moveAuditActivitiesMaster } from "./lib/audit-activities-master-scope";
import { storageProvider, validateStorageConfiguration } from "./lib/storage-config";

validateStorageConfiguration();
logger.info({ storageProvider: storageProvider() }, "Private attachment storage configured");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Apply the scoped, idempotent correction in both preview and published environments.
const movedActivityGroups = await moveAuditActivitiesMaster();
if (movedActivityGroups.length) {
  logger.info({ groupsUpdated: movedActivityGroups.length }, "Activities master moved from QA/QC to Audit");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  startEscalationScheduler(app);
  logger.info("Escalation reconciliation scheduler started");
  startEmailQueueScheduler();
  logger.info("Email delivery queue scheduler started");
  const digestTimer = setInterval(() => { void runLessonsEscalationDigest().catch((error) => logger.error({ error }, "Lessons digest scheduler failed")); }, 60_000);
  digestTimer.unref();
  void runLessonsEscalationDigest().catch((error) => logger.error({ error }, "Lessons digest scheduler failed"));
  const qaqcTimer = setInterval(() => { void runQaqcReportingAutomation().catch((error) => logger.error({ error }, "QA/QC reporting scheduler failed")); }, 60_000);
  qaqcTimer.unref();
  void runQaqcReportingAutomation().catch((error) => logger.error({ error }, "QA/QC reporting scheduler failed"));
});
