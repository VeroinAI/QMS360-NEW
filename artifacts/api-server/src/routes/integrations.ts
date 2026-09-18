import { Router, raw, type IRouter } from "express";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  CreateImportTemplateBody, CreateIntegrationConnectorBody, GetConnectorFieldMappingsResponse,
  GetEmailDeliverySettingsResponse, GetIntegrationsHealthResponse, ListIntegrationConnectorsResponse,
  ListOutboundEmailsQueryParams, ListOutboundEmailsResponse, ListSyncJobsResponse,
  PullConnectorDataBody, RetrySyncJobResponse, SaveConnectorFieldMappingsBody, SendConnectorTestEmailResponse,
  RetryOutboundEmailResponse, UpdateEmailDeliverySettingsBody, UpdateEmailDeliverySettingsResponse,
  UpdateImportTemplateBody, UpdateIntegrationConnectorBody, UpdateIntegrationConnectorResponse,
} from "@workspace/api-zod";
import { connectorFieldMappings, db, importTemplates, integrationConnectors, organizationSettings, outboundEmails, syncJobs } from "@workspace/db";
import { deliverEmail, sendConnectorTestEmail } from "../lib/email";
import { getEmailDeliveryPolicy } from "../lib/email-queue";
import { encryptConfigSecrets, encryptSecret } from "../lib/secrets";
import {
  CUSTOM_FIELD_PATTERN, ENTITY_CATALOG, applyEntityRows, buildTemplateFile, ensureDefaultTemplates,
  fetchEntityRows, mapSourceRows, parseImportFile, recordSyncJob, validateTemplateColumns,
  type SyncEntity,
} from "../lib/source-sync";
import { paginated, pagination } from "../lib/workspace";
import { requireAdmin, requireAuth, requirePlatformRole } from "../middlewares/auth";

const router: IRouter = Router();
const families = new Set(["platform", "email", "ai", "oracle_adw", "bi", "source_api"]);
const statuses = new Set(["Connected", "Degraded", "Failed", "Disabled"]);
const superAdmin = requirePlatformRole("Super Admin");

function maskConfig(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /(secret|password|token|api.?key|credential)/i.test(key) ? "********"
      : item && typeof item === "object" && !Array.isArray(item) ? maskConfig(item as Record<string, unknown>) : item,
  ]));
}
function connectorDto(row: typeof integrationConnectors.$inferSelect, lastSuccessfulSyncAt: Date | null = null) {
  const family = families.has(row.connectorType) ? row.connectorType : "platform";
  const config = maskConfig(row.configuration);
  // Basic-auth usernames are credentials too — the generic secret-key pattern
  // does not match "username", so mask them explicitly for source connectors.
  if ((family === "email" || (family === "source_api" && config.authType === "basic"))
    && typeof config.username === "string" && config.username) {
    config.username = "********";
  }
  if (family === "email" && typeof config.user === "string" && config.user) config.user = "********";
  if (family === "email" && typeof config.pass === "string" && config.pass) config.pass = "********";
  const configuredStatus = typeof row.configuration.status === "string" ? row.configuration.status : undefined;
  const status = !row.isEnabled ? "Disabled" : statuses.has(configuredStatus ?? "") ? configuredStatus! : "Degraded";
  return { id: row.id, name: row.name, family, status, enabled: row.isEnabled, config, lastSuccessfulSyncAt };
}
function syncDto(row: typeof syncJobs.$inferSelect) {
  const status = row.outcome === "success" || row.outcome === "succeeded" ? "succeeded"
    : row.outcome === "running" ? "running" : row.outcome === "failed" ? "failed" : "queued";
  const entries = Array.isArray(row.errorQueue) ? row.errorQueue as Array<Record<string, unknown>> : [];
  // Pull/import jobs store record counts in a trailing `summary` entry so the
  // first real error stays visible as `error`.
  const summary = entries.find((entry) => entry?.kind === "summary");
  const firstError = entries.find((entry) => entry?.kind !== "summary");
  return {
    id: row.id, connectorId: row.connectorId ?? "", status, schedule: row.schedule,
    startedAt: row.lastRunAt ?? row.createdAt,
    completedAt: status === "running" || status === "queued" ? null : row.updatedAt,
    durationMs: row.durationMs,
    sourceCount: typeof summary?.sourceCount === "number" ? summary.sourceCount : 0,
    targetCount: typeof summary?.targetCount === "number" ? summary.targetCount : 0,
    error: firstError ? String(firstError.message ?? firstError.error ?? "Synchronization failed") : null,
  };
}

function outboundEmailDto(row: typeof outboundEmails.$inferSelect) {
  const app = ["qaqc", "lessons", "audit"].includes(row.app) ? row.app : "platform";
  const status = ["queued", "sending", "retrying", "sent", "failed"].includes(row.deliveryStatus)
    ? row.deliveryStatus : "failed";
  return {
    id: row.id, app, eventType: row.eventType, entityId: row.entityId,
    recipientEmail: row.recipientEmail, recipientName: row.recipientName,
    ccRecipients: row.ccRecipients,
    senderEmail: row.senderEmail, senderName: row.senderName,
    subject: row.subject, status, attemptCount: row.attemptCount, maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt, lastAttemptAt: row.lastAttemptAt, sentAt: row.sentAt,
    lastError: row.lastError, createdAt: row.createdAt,
  };
}

router.get("/integrations/connectors", requireAuth, requireAdmin, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = and(eq(integrationConnectors.organizationId, req.currentUser!.organizationId), isNull(integrationConnectors.deletedAt));
  const [rows, counts, syncs] = await Promise.all([
    db.select().from(integrationConnectors).where(where).orderBy(integrationConnectors.name).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(integrationConnectors).where(where),
    db.select({ connectorId: syncJobs.connectorId, last: sql<Date | null>`max(${syncJobs.lastRunAt})` })
      .from(syncJobs)
      .where(and(eq(syncJobs.organizationId, req.currentUser!.organizationId), isNull(syncJobs.deletedAt), eq(syncJobs.outcome, "success")))
      .groupBy(syncJobs.connectorId),
  ]);
  const lastSyncByConnector = new Map(syncs.map((entry) => [entry.connectorId ?? "", entry.last]));
  res.json(ListIntegrationConnectorsResponse.parse(paginated(
    rows.map((row) => connectorDto(row, lastSyncByConnector.get(row.id) ?? null)),
    Number(counts[0]?.count ?? 0), page, limit,
  )));
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
  const incoming = { ...(parsed.data.config ?? {}) };
  if (parsed.data.family === "email") {
    if (typeof incoming.user === "string" && !incoming.username) incoming.username = incoming.user;
    if (typeof incoming.pass === "string" && !incoming.password) incoming.password = incoming.pass;
    delete incoming.user;
    delete incoming.pass;
  }
  // Basic-auth usernames are credentials; encrypt them like other secrets
  // (the generic secret-key pattern does not match "username").
  if (typeof incoming.username === "string" && incoming.username && incoming.username !== "********"
    && (parsed.data.family === "email" || (incoming.authType ?? old.configuration.authType) === "basic")) {
    incoming.username = encryptSecret(incoming.username);
  }
  // Secret values (passwords, tokens, ...) are encrypted at rest; masked
  // placeholders keep the previously stored value. Legacy plaintext secrets
  // already stored are re-encrypted by encryptConfigSecrets on this save.
  const stored = { ...old.configuration };
  if (parsed.data.family === "email") {
    if (typeof stored.user === "string" && !stored.username) stored.username = encryptSecret(stored.user);
    if (typeof stored.pass === "string" && !stored.password) stored.password = encryptSecret(stored.pass);
    if (typeof stored.username === "string" && stored.username) stored.username = encryptSecret(stored.username);
    delete stored.user;
    delete stored.pass;
  }
  const merged = encryptConfigSecrets({
    ...stored,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== "********")),
    status: parsed.data.status,
  });
  const [row] = await db.update(integrationConnectors).set({
    name: parsed.data.name, connectorType: parsed.data.family, isEnabled: parsed.data.enabled,
    configuration: merged, updatedAt: new Date(),
  }).where(eq(integrationConnectors.id, old.id)).returning();
  res.json(UpdateIntegrationConnectorResponse.parse(connectorDto(row!)));
});

router.get("/integrations/sync-jobs", requireAuth, requireAdmin, async (req, res) => {
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
  const payloads = entries.filter((entry) =>
    Array.isArray(entry?.recipientIds) && Array.isArray(entry?.recipients) && typeof entry?.subject === "string");
  const payload = payloads[0];
  if (job.jobType !== "email_delivery" || !payload) {
    res.status(422).json({ error: "This job has no recorded email payload to retry" }); return;
  }
  const rawSender = payload.sender;
  const sender = rawSender && typeof rawSender === "object"
    && typeof (rawSender as Record<string, unknown>).email === "string"
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((rawSender as Record<string, unknown>).email as string)
    ? {
      email: (rawSender as Record<string, unknown>).email as string,
      name: typeof (rawSender as Record<string, unknown>).name === "string"
        ? (rawSender as Record<string, unknown>).name as string : null,
    } : undefined;
  const ccRecipients = Array.isArray(payload.ccRecipients)
    ? payload.ccRecipients.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      if (typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return [];
      return [{ email: value.email, name: typeof value.name === "string" ? value.name : null }];
    }) : [];
  const startedAt = Date.now();
  const result = await deliverEmail(db, {
    organizationId: orgId,
    recipientIds: [...new Set(payloads.flatMap((entry) => entry.recipientIds as string[]))],
    recipients: [...new Map(payloads.flatMap((entry) =>
      entry.recipients as Array<{ email: string; name?: string | null }>)
      .map((recipient) => [recipient.email.toLowerCase(), recipient])).values()],
    ccRecipients,
    sender,
    subject: payload.subject as string,
    text: typeof payload.text === "string" ? payload.text : "",
    html: typeof payload.html === "string" ? payload.html : undefined,
    context: { kind: "sync_job_retry", retryOfJobId: job.id },
  });
  const outcome = result.attempted && result.failed === 0 ? "success" : "failed";
  const message = result.attempted ? result.error : `Retry not attempted: ${result.reason}`;
  const [row] = await db.update(syncJobs).set({
    outcome,
    errorQueue: outcome === "success" ? [] : [{
      message: message ?? "Retry delivery failed", kind: "sync_job_retry",
      recipientIds: result.attempted ? [] : [...new Set(payloads.flatMap((entry) => entry.recipientIds as string[]))],
      recipients: result.attempted ? result.failedRecipients : [...new Map(payloads.flatMap((entry) =>
        entry.recipients as Array<{ email: string; name?: string | null }>)
        .map((recipient) => [recipient.email.toLowerCase(), recipient])).values()],
      sender,
      ccRecipients,
      subject: payload.subject, text: typeof payload.text === "string" ? payload.text : "", html: typeof payload.html === "string" ? payload.html : undefined,
    }],
    durationMs: Date.now() - startedAt, lastRunAt: new Date(), updatedAt: new Date(),
  }).where(eq(syncJobs.id, job.id)).returning();
  res.json(RetrySyncJobResponse.parse(syncDto(row!)));
});

router.get("/integrations/email-settings", requireAuth, superAdmin, async (req, res) => {
  const policy = await getEmailDeliveryPolicy(db, req.currentUser!.organizationId);
  res.json(GetEmailDeliverySettingsResponse.parse(policy));
});

router.put("/integrations/email-settings", requireAuth, superAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateEmailDeliverySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues[0]?.message ?? "Invalid email delivery settings" });
    return;
  }
  const organizationId = req.currentUser!.organizationId;
  const [existing] = await db.select({ id: organizationSettings.id }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  if (existing) {
    await db.update(organizationSettings).set({ emailDeliveryPolicy: parsed.data, updatedAt: new Date() })
      .where(eq(organizationSettings.id, existing.id));
  } else {
    await db.insert(organizationSettings).values({ organizationId, emailDeliveryPolicy: parsed.data });
  }
  res.json(UpdateEmailDeliverySettingsResponse.parse(parsed.data));
});

router.get("/integrations/email-queue", requireAuth, superAdmin, async (req, res): Promise<void> => {
  const parsed = ListOutboundEmailsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(422).json({ error: "Invalid email queue filters" }); return; }
  const { page, limit, offset } = pagination(req);
  const params = parsed.data;
  const where = and(
    eq(outboundEmails.organizationId, req.currentUser!.organizationId),
    isNull(outboundEmails.deletedAt),
    params.status && params.status !== "all" ? eq(outboundEmails.deliveryStatus, params.status) : undefined,
    params.app && params.app !== "all" ? eq(outboundEmails.app, params.app) : undefined,
    params.search?.trim() ? or(
      ilike(outboundEmails.recipientEmail, `%${params.search.trim()}%`),
      ilike(outboundEmails.subject, `%${params.search.trim()}%`),
      ilike(outboundEmails.eventType, `%${params.search.trim()}%`),
    ) : undefined,
  );
  const [rows, counts] = await Promise.all([
    db.select().from(outboundEmails).where(where).orderBy(desc(outboundEmails.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(outboundEmails).where(where),
  ]);
  res.json(ListOutboundEmailsResponse.parse(paginated(rows.map(outboundEmailDto), Number(counts[0]?.count ?? 0), page, limit)));
});

router.post("/integrations/email-queue/:id/retry", requireAuth, superAdmin, async (req, res): Promise<void> => {
  const organizationId = req.currentUser!.organizationId;
  const [existing] = await db.select().from(outboundEmails).where(and(
    eq(outboundEmails.id, String(req.params.id)),
    eq(outboundEmails.organizationId, organizationId),
    isNull(outboundEmails.deletedAt),
  )).limit(1);
  if (!existing) { res.status(404).json({ error: "Email not found" }); return; }
  if (existing.deliveryStatus !== "failed") {
    res.status(409).json({ error: "Only failed emails can be retried" }); return;
  }
  const [updated] = await db.update(outboundEmails).set({
    deliveryStatus: "queued",
    maxAttempts: existing.attemptCount + 1,
    nextAttemptAt: new Date(),
    lastError: null,
    lockedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(outboundEmails.id, existing.id), eq(outboundEmails.organizationId, organizationId))).returning();
  res.status(202).json(RetryOutboundEmailResponse.parse(outboundEmailDto(updated!)));
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

router.get("/integrations/health", requireAuth, requireAdmin, async (req, res) => {
  const rows = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.organizationId, req.currentUser!.organizationId), isNull(integrationConnectors.deletedAt),
  ));
  const connectors = rows.map((row) => connectorDto(row));
  const status = connectors.some((item) => item.status === "Failed") ? "failed"
    : connectors.some((item) => item.status === "Degraded") ? "degraded" : "healthy";
  res.json(GetIntegrationsHealthResponse.parse({ status, connectors, checkedAt: new Date() }));
});

const MAPPABLE_FAMILIES = new Set(["platform", "oracle_adw", "bi", "source_api"]);

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
    // Beyond the catalog, custom.<key> targets land in the entity's custom_fields.
    if (!validTargets.has(mapping.targetField) && !CUSTOM_FIELD_PATTERN.test(mapping.targetField)) {
      res.status(422).json({ error: `Unknown target field "${mapping.targetField}" for ${catalog.label}` }); return;
    }
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

// ---------------------------------------------------------------------------
// Connector lifecycle + source-system pulls

router.post("/integrations/connectors", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateIntegrationConnectorBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid connector", details: parsed.error.issues }); return; }
  const config = { ...(parsed.data.config ?? {}) };
  if (parsed.data.family === "email") {
    if (typeof config.user === "string" && !config.username) config.username = config.user;
    if (typeof config.pass === "string" && !config.password) config.password = config.pass;
    delete config.user;
    delete config.pass;
  }
  // Basic-auth usernames are credentials; encrypt them like other secrets.
  if (typeof config.username === "string" && config.username
    && (parsed.data.family === "email" || config.authType === "basic")) {
    config.username = encryptSecret(config.username);
  }
  const [row] = await db.insert(integrationConnectors).values({
    organizationId: req.currentUser!.organizationId,
    name: parsed.data.name.trim(),
    connectorType: parsed.data.family,
    isEnabled: parsed.data.enabled,
    configuration: encryptConfigSecrets(config),
  }).returning();
  res.status(201).json(connectorDto(row!));
});

router.delete("/integrations/connectors/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const orgId = req.currentUser!.organizationId;
  const [row] = await db.update(integrationConnectors).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(integrationConnectors.id, String(req.params.id)), eq(integrationConnectors.organizationId, orgId),
    isNull(integrationConnectors.deletedAt),
  )).returning();
  if (!row) { res.status(404).json({ error: "Connector not found" }); return; }
  await db.update(connectorFieldMappings).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(connectorFieldMappings.connectorId, row.id), eq(connectorFieldMappings.organizationId, orgId),
    isNull(connectorFieldMappings.deletedAt),
  ));
  res.status(204).end();
});

router.post("/integrations/connectors/:id/test", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const connector = await loadConnector(req.currentUser!.organizationId, String(req.params.id));
  if (!connector) { res.status(404).json({ error: "Connector not found" }); return; }
  if (connector.connectorType !== "source_api") { res.status(422).json({ error: "Only source API connectors support connection tests" }); return; }
  try {
    const config = connector.configuration as Record<string, unknown>;
    const endpoints = (config.endpoints ?? {}) as Record<string, { path?: unknown } | undefined>;
    const entity = typeof endpoints.projects?.path === "string" && endpoints.projects.path ? "projects" : "users";
    const rows = await fetchEntityRows(connector, entity);
    res.json({ ok: true, message: `Connected — ${rows.length} ${entity} record(s) reachable`, sampleCount: rows.length });
  } catch (error) {
    res.json({ ok: false, message: error instanceof Error ? error.message : "Connection failed", sampleCount: 0 });
  }
});

router.post("/integrations/connectors/:id/pull", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = PullConnectorDataBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid pull request", details: parsed.error.issues }); return; }
  const orgId = req.currentUser!.organizationId;
  const connector = await loadConnector(orgId, String(req.params.id));
  if (!connector) { res.status(404).json({ error: "Connector not found" }); return; }
  if (connector.connectorType !== "source_api") { res.status(422).json({ error: "Only source API connectors can pull data" }); return; }
  if (!connector.isEnabled) { res.status(422).json({ error: "Enable the connector before pulling data" }); return; }
  const entity = parsed.data.entity as SyncEntity;
  const mappings = await db.select().from(connectorFieldMappings).where(and(
    eq(connectorFieldMappings.connectorId, connector.id), eq(connectorFieldMappings.organizationId, orgId),
    eq(connectorFieldMappings.entity, entity), eq(connectorFieldMappings.isActive, true),
    isNull(connectorFieldMappings.deletedAt),
  ));
  if (!mappings.length) {
    res.status(422).json({ error: `No active field mappings for ${entity} — save and activate mappings first` }); return;
  }
  const startedAt = Date.now();
  try {
    const rows = await fetchEntityRows(connector, entity);
    const result = await applyEntityRows(orgId, entity, "api", mapSourceRows(mappings, rows));
    await recordSyncJob(orgId, connector.id, `pull_${entity}`, startedAt, result);
    await db.update(integrationConnectors).set({
      configuration: { ...connector.configuration, status: "Connected" }, updatedAt: new Date(),
    }).where(eq(integrationConnectors.id, connector.id));
    res.json({
      status: result.errors.length && result.targetCount === 0 ? "failed" : "succeeded",
      sourceCount: result.sourceCount, targetCount: result.targetCount,
      errorCount: result.errors.length, errors: result.errors,
    });
  } catch (error) {
    await recordSyncJob(orgId, connector.id, `pull_${entity}`, startedAt, {
      sourceCount: 0, targetCount: 0,
      errors: [{ row: 0, message: error instanceof Error ? error.message : "Pull failed" }],
    });
    await db.update(integrationConnectors).set({
      configuration: { ...connector.configuration, status: "Failed" }, updatedAt: new Date(),
    }).where(eq(integrationConnectors.id, connector.id));
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Excel import templates + file drop (fallback channel when no live API exists)

function templateDto(row: typeof importTemplates.$inferSelect) {
  return { id: row.id, entity: row.entity, name: row.name, isDefault: row.isDefault, columns: row.columns, updatedAt: row.updatedAt };
}

async function loadTemplate(organizationId: string, id: string) {
  const [row] = await db.select().from(importTemplates).where(and(
    eq(importTemplates.id, id), eq(importTemplates.organizationId, organizationId), isNull(importTemplates.deletedAt),
  )).limit(1);
  return row;
}

router.get("/integrations/import-templates", requireAuth, async (req, res) => {
  const orgId = req.currentUser!.organizationId;
  await ensureDefaultTemplates(orgId);
  const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
  const rows = await db.select().from(importTemplates).where(and(
    eq(importTemplates.organizationId, orgId), isNull(importTemplates.deletedAt),
    entity ? eq(importTemplates.entity, entity) : undefined,
  )).orderBy(desc(importTemplates.isDefault), asc(importTemplates.name));
  res.json(rows.map(templateDto));
});

router.post("/integrations/import-templates", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateImportTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid template", details: parsed.error.issues }); return; }
  const invalid = validateTemplateColumns(parsed.data.entity as SyncEntity, parsed.data.columns);
  if (invalid) { res.status(422).json({ error: invalid }); return; }
  const [row] = await db.insert(importTemplates).values({
    organizationId: req.currentUser!.organizationId,
    entity: parsed.data.entity, name: parsed.data.name.trim(), isDefault: false, columns: parsed.data.columns,
  }).returning();
  res.status(201).json(templateDto(row!));
});

router.put("/integrations/import-templates/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateImportTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid template", details: parsed.error.issues }); return; }
  const template = await loadTemplate(req.currentUser!.organizationId, String(req.params.id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (template.isDefault) { res.status(422).json({ error: "Default templates cannot be edited — copy them first" }); return; }
  if (parsed.data.entity !== template.entity) { res.status(422).json({ error: "A template's entity cannot change" }); return; }
  const invalid = validateTemplateColumns(template.entity as SyncEntity, parsed.data.columns);
  if (invalid) { res.status(422).json({ error: invalid }); return; }
  const [row] = await db.update(importTemplates).set({
    name: parsed.data.name.trim(), columns: parsed.data.columns, updatedAt: new Date(),
  }).where(eq(importTemplates.id, template.id)).returning();
  res.json(templateDto(row!));
});

router.delete("/integrations/import-templates/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const template = await loadTemplate(req.currentUser!.organizationId, String(req.params.id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (template.isDefault) { res.status(422).json({ error: "Default templates cannot be deleted" }); return; }
  await db.update(importTemplates).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(importTemplates.id, template.id));
  res.status(204).end();
});

router.get("/integrations/import-templates/:id/download", requireAuth, async (req, res): Promise<void> => {
  const template = await loadTemplate(req.currentUser!.organizationId, String(req.params.id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(buildTemplateFile(template));
});

// The global JSON parser skips non-JSON bodies, so the raw parser here receives
// the untouched workbook bytes (Content-Type: application/octet-stream).
router.post("/integrations/import-templates/:id/import", requireAuth, requireAdmin, raw({ type: "*/*", limit: "25mb" }), async (req, res): Promise<void> => {
  const orgId = req.currentUser!.organizationId;
  const template = await loadTemplate(orgId, String(req.params.id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(422).json({ error: "Upload the workbook as the request body (application/octet-stream)" }); return;
  }
  const startedAt = Date.now();
  const rows = parseImportFile(req.body, template);
  const result = await applyEntityRows(orgId, template.entity as SyncEntity, "excel", rows);
  await recordSyncJob(orgId, null, `excel_import_${template.entity}`, startedAt, result);
  res.json({
    status: result.errors.length && result.targetCount === 0 ? "failed" : "succeeded",
    sourceCount: result.sourceCount, targetCount: result.targetCount,
    errorCount: result.errors.length, errors: result.errors,
  });
});

export default router;