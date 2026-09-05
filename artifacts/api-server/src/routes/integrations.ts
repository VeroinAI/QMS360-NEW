import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  GetConnectorFieldMappingsResponse, GetIntegrationsHealthResponse, ListIntegrationConnectorsResponse,
  ListSyncJobsResponse, RetrySyncJobResponse, SaveConnectorFieldMappingsBody, SendConnectorTestEmailResponse,
  UpdateIntegrationConnectorBody, UpdateIntegrationConnectorResponse,
} from "@workspace/api-zod";
import { connectorFieldMappings, db, integrationConnectors, syncJobs } from "@workspace/db";
import { deliverEmail, sendConnectorTestEmail } from "../lib/email";
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
  const orgId = req.currentUser!.organizationId;
  const [job] = await db.select().from(syncJobs).where(and(
    eq(syncJobs.id, String(req.params.id)), eq(syncJobs.organizationId, orgId), isNull(syncJobs.deletedAt),
  ));
  if (!job) { res.status(404).json({ error: "Sync job not found" }); return; }
  if (job.outcome !== "failed") { res.status(409).json({ error: "Only failed jobs can be retried" }); return; }
  // Email deliveries embed their payload in every recorded failure entry so a
  // retry resends the exact original email instead of flipping a status flag.
  const entries = Array.isArray(job.errorQueue) ? job.errorQueue as Array<Record<string, unknown>> : [];
  const payload = entries.find((entry) => Array.isArray(entry?.recipientIds) && typeof entry?.subject === "string");
  if (job.jobType !== "email_delivery" || !payload) {
    res.status(422).json({ error: "This job has no recorded email payload to retry" }); return;
  }
  const startedAt = Date.now();
  const result = await deliverEmail(db, {
    organizationId: orgId,
    recipientIds: payload.recipientIds as string[],
    subject: payload.subject as string,
    text: typeof payload.text === "string" ? payload.text : "",
    context: { kind: "sync_job_retry", retryOfJobId: job.id },
  });
  const outcome = result.attempted && result.failed === 0 ? "success" : "failed";
  const message = result.attempted ? result.error : `Retry not attempted: ${result.reason}`;
  const [row] = await db.update(syncJobs).set({
    outcome,
    errorQueue: outcome === "success" ? [] : [{ message: message ?? "Retry delivery failed", kind: "sync_job_retry" }],
    durationMs: Date.now() - startedAt, lastRunAt: new Date(), updatedAt: new Date(),
  }).where(eq(syncJobs.id, job.id)).returning();
  res.json(RetrySyncJobResponse.parse(syncDto(row!)));
});

router.post("/integrations/connectors/:id/test-email", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const [connector] = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.id, String(req.params.id)),
    eq(integrationConnectors.organizationId, req.currentUser!.organizationId),
    isNull(integrationConnectors.deletedAt),
  ));
  if (!connector) { res.status(404).json({ error: "Connector not found" }); return; }
  if (connector.connectorType !== "email") { res.status(422).json({ error: "Only email connectors support test emails" }); return; }
  if (!connector.isEnabled) { res.status(422).json({ error: "Enable the connector before sending a test email" }); return; }
  const recipient = req.currentUser!.email;
  if (!recipient) { res.status(422).json({ error: "Your account has no email address to send the test to" }); return; }
  const result = await sendConnectorTestEmail(db, connector, recipient);
  if (!result.ok) { res.status(422).json({ error: result.error ?? "Test email failed" }); return; }
  res.json(SendConnectorTestEmailResponse.parse({ sent: true, message: `Test email sent to ${recipient}` }));
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

const MAPPABLE_FAMILIES = new Set(["platform", "oracle_adw", "bi"]);
const ENTITY_CATALOG = [
  {
    entity: "projects", label: "Projects",
    sourceSuggestions: ["project_code", "project_name", "business_unit", "region", "status", "start_date", "end_date"],
    targetFields: [
      { key: "code", label: "Project code", required: true },
      { key: "name", label: "Project name", required: true },
      { key: "businessUnit", label: "Business unit", required: false },
      { key: "status", label: "Status", required: false },
      { key: "startDate", label: "Start date", required: false },
    ],
  },
  {
    entity: "employees", label: "Employees",
    sourceSuggestions: ["employee_no", "full_name", "email", "department", "job_title", "manager_email"],
    targetFields: [
      { key: "fullName", label: "Full name", required: true },
      { key: "email", label: "Email", required: true },
      { key: "department", label: "Department", required: false },
      { key: "jobTitle", label: "Job title", required: false },
    ],
  },
];

async function loadConnector(organizationId: string, id: string) {
  const [row] = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.id, id), eq(integrationConnectors.organizationId, organizationId),
    isNull(integrationConnectors.deletedAt),
  )).limit(1);
  return row;
}

async function mappingWorkspace(organizationId: string, connectorId: string) {
  const rows = await db.select().from(connectorFieldMappings).where(and(
    eq(connectorFieldMappings.connectorId, connectorId), eq(connectorFieldMappings.organizationId, organizationId),
    isNull(connectorFieldMappings.deletedAt),
  )).orderBy(connectorFieldMappings.entity, connectorFieldMappings.createdAt);
  return GetConnectorFieldMappingsResponse.parse({
    connectorId,
    entities: ENTITY_CATALOG,
    mappings: rows.map((row) => ({ id: row.id, entity: row.entity, sourceField: row.sourceField, targetField: row.targetField, active: row.isActive })),
  });
}

router.get("/integrations/connectors/:id/field-mappings", requireAuth, async (req, res): Promise<void> => {
  const connector = await loadConnector(req.currentUser!.organizationId, String(req.params.id));
  if (!connector) { res.status(404).json({ error: "Connector not found" }); return; }
  if (!MAPPABLE_FAMILIES.has(connector.connectorType)) { res.status(422).json({ error: "This connector does not support field mapping" }); return; }
  res.json(await mappingWorkspace(req.currentUser!.organizationId, connector.id));
});

router.put("/integrations/connectors/:id/field-mappings", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = SaveConnectorFieldMappingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid field mappings", details: parsed.error.issues }); return; }
  const connector = await loadConnector(req.currentUser!.organizationId, String(req.params.id));
  if (!connector) { res.status(404).json({ error: "Connector not found" }); return; }
  if (!MAPPABLE_FAMILIES.has(connector.connectorType)) { res.status(422).json({ error: "This connector does not support field mapping" }); return; }
  const catalog = ENTITY_CATALOG.find((entry) => entry.entity === parsed.data.entity);
  if (!catalog) { res.status(422).json({ error: `Unknown entity "${parsed.data.entity}"` }); return; }
  const validTargets = new Set(catalog.targetFields.map((field) => field.key));
  const mapped = new Set<string>();
  for (const mapping of parsed.data.mappings) {
    if (!mapping.sourceField.trim()) { res.status(422).json({ error: "Source fields cannot be blank" }); return; }
    if (!validTargets.has(mapping.targetField)) { res.status(422).json({ error: `Unknown target field "${mapping.targetField}" for ${catalog.label}` }); return; }
    if (mapped.has(mapping.targetField)) { res.status(422).json({ error: `Target field "${mapping.targetField}" is mapped more than once` }); return; }
    mapped.add(mapping.targetField);
  }
  const missing = catalog.targetFields.filter((field) => field.required && !mapped.has(field.key));
  if (parsed.data.active && missing.length) {
    res.status(422).json({ error: `Required fields not mapped: ${missing.map((field) => field.label).join(", ")}` }); return;
  }
  const orgId = req.currentUser!.organizationId;
  await db.transaction(async (tx) => {
    // Serialize concurrent saves for the same connector on its row lock so a
    // replace can never interleave with another replace.
    await tx.select({ id: integrationConnectors.id }).from(integrationConnectors)
      .where(eq(integrationConnectors.id, connector.id)).for("update");
    await tx.update(connectorFieldMappings).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(connectorFieldMappings.connectorId, connector.id), eq(connectorFieldMappings.organizationId, orgId),
      eq(connectorFieldMappings.entity, catalog.entity), isNull(connectorFieldMappings.deletedAt),
    ));
    if (parsed.data.mappings.length) {
      await tx.insert(connectorFieldMappings).values(parsed.data.mappings.map((mapping) => ({
        organizationId: orgId, connectorId: connector.id, entity: catalog.entity,
        sourceField: mapping.sourceField.trim(), targetField: mapping.targetField, isActive: parsed.data.active,
      })));
    }
    await tx.update(integrationConnectors)
      .set({ fieldMappingVersion: sql`${integrationConnectors.fieldMappingVersion} + 1`, updatedAt: new Date() })
      .where(eq(integrationConnectors.id, connector.id));
  });
  res.json(await mappingWorkspace(orgId, connector.id));
});

export default router;