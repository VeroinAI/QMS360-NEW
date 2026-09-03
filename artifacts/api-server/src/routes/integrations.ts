import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  GetIntegrationsHealthResponse, ListIntegrationConnectorsResponse, ListSyncJobsResponse,
  RetrySyncJobResponse, UpdateIntegrationConnectorBody, UpdateIntegrationConnectorResponse,
} from "@workspace/api-zod";
import { db, integrationConnectors, syncJobs } from "@workspace/db";
import { encryptConfigSecrets } from "../lib/secrets";
import { paginated, pagination } from "../lib/workspace";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const families = new Set(["platform", "email", "ai", "oracle_adw", "bi"]);
const statuses = new Set(["Connected", "Degraded", "Failed", "Disabled"]);

function maskConfig(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /(secret|password|token|api.?key|credential)/i.test(key) ? "********"
      : item && typeof item === "object" && !Array.isArray(item) ? maskConfig(item as Record<string, unknown>) : item,
  ]));
}
function connectorDto(row: typeof integrationConnectors.$inferSelect, lastSuccessfulSyncAt: Date | null = null) {
  const config = maskConfig(row.configuration);
  const family = families.has(row.connectorType) ? row.connectorType : "platform";
  const configuredStatus = typeof row.configuration.status === "string" ? row.configuration.status : undefined;
  const status = !row.isEnabled ? "Disabled" : statuses.has(configuredStatus ?? "") ? configuredStatus! : "Degraded";
  return { id: row.id, name: row.name, family, status, enabled: row.isEnabled, config, lastSuccessfulSyncAt };
}
function syncDto(row: typeof syncJobs.$inferSelect) {
  const status = row.outcome === "success" || row.outcome === "succeeded" ? "succeeded"
    : row.outcome === "running" ? "running" : row.outcome === "failed" ? "failed" : "queued";
  const error = row.errorQueue[0];
  return {
    id: row.id, connectorId: row.connectorId ?? "", status, schedule: row.schedule,
    startedAt: row.lastRunAt ?? row.createdAt,
    completedAt: status === "running" || status === "queued" ? null : row.updatedAt,
    durationMs: row.durationMs,
    error: error ? String(error.message ?? error.error ?? "Synchronization failed") : null,
  };
}

router.get("/integrations/connectors", requireAuth, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(integrationConnectors.organizationId, req.currentUser!.organizationId), isNull(integrationConnectors.deletedAt));
  const [rows, counts] = await Promise.all([
    db.select().from(integrationConnectors).where(where).orderBy(integrationConnectors.name).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(integrationConnectors).where(where),
  ]);
  res.json(ListIntegrationConnectorsResponse.parse(paginated(rows.map((row) => connectorDto(row)), Number(counts[0]?.count ?? 0), page, limit)));
});

router.put("/integrations/connectors/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateIntegrationConnectorBody.safeParse(req.body);
  if (!parsed.success || parsed.data.id !== String(req.params.id)) { res.status(422).json({ error: "Invalid connector update" }); return; }
  const oldRows = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.id, String(req.params.id)), eq(integrationConnectors.organizationId, req.currentUser!.organizationId),
    isNull(integrationConnectors.deletedAt),
  )).limit(1);
  const old = oldRows[0];
  if (!old) { res.status(404).json({ error: "Connector not found" }); return; }
  const incoming = parsed.data.config ?? {};
  // Secret values (passwords, tokens, ...) are encrypted at rest; masked
  // placeholders keep the previously stored value. Legacy plaintext secrets
  // already stored are re-encrypted by encryptConfigSecrets on this save.
  const merged = encryptConfigSecrets({
    ...old.configuration,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== "********")),
    status: parsed.data.status,
  });
  const [row] = await db.update(integrationConnectors).set({
    name: parsed.data.name, connectorType: parsed.data.family, isEnabled: parsed.data.enabled,
    configuration: merged, updatedAt: new Date(),
  }).where(eq(integrationConnectors.id, old.id)).returning();
  res.json(UpdateIntegrationConnectorResponse.parse(connectorDto(row!)));
});

router.get("/integrations/sync-jobs", requireAuth, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(syncJobs.organizationId, req.currentUser!.organizationId), isNull(syncJobs.deletedAt));
  const [rows, counts] = await Promise.all([
    db.select().from(syncJobs).where(where).orderBy(desc(syncJobs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(syncJobs).where(where),
  ]);
  res.json(ListSyncJobsResponse.parse(paginated(rows.map(syncDto), Number(counts[0]?.count ?? 0), page, limit)));
});

router.post("/integrations/sync-jobs/:id/retry", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const [row] = await db.update(syncJobs).set({
    outcome: "queued", errorQueue: [], durationMs: null, lastRunAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(syncJobs.id, String(req.params.id)), eq(syncJobs.organizationId, req.currentUser!.organizationId), isNull(syncJobs.deletedAt))).returning();
  if (!row) { res.status(404).json({ error: "Sync job not found" }); return; }
  res.json(RetrySyncJobResponse.parse(syncDto(row)));
});

router.get("/integrations/health", requireAuth, async (req, res) => {
  const rows = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.organizationId, req.currentUser!.organizationId), isNull(integrationConnectors.deletedAt),
  ));
  const connectors = rows.map((row) => connectorDto(row));
  const status = connectors.some((item) => item.status === "Failed") ? "failed"
    : connectors.some((item) => item.status === "Degraded") ? "degraded" : "healthy";
  res.json(GetIntegrationsHealthResponse.parse({ status, connectors, checkedAt: new Date() }));
});

export default router;