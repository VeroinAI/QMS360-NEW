import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  auditAuditLogEntries,
  auditLogEntries,
  auditNotifications,
  db,
  lessonNotifications,
  lessonsAuditLogEntries,
  notifications,
} from "@workspace/db";
import { deliverEmail } from "./email";

export type AppKey = "qaqc" | "lessons" | "audit";

// Names of an app's workspace roles that have at least one active member.
// Mirrors resolveRecipients() in lib/escalation.ts exactly (active role +
// active assignment); used to warn admins when an escalation rule targets an
// unstaffed role, since the engine falls back to initial admins in that case.
export async function staffedRoleNames(organizationId: string, rolesTable: any, assignmentsTable: any): Promise<Set<string>> {
  const rows = await db.select({ name: rolesTable.name }).from(assignmentsTable)
    .innerJoin(rolesTable, and(eq(assignmentsTable.workspaceRoleId, rolesTable.id), eq(rolesTable.status, "active"), isNull(rolesTable.deletedAt)))
    .where(and(eq(assignmentsTable.organizationId, organizationId), eq(assignmentsTable.status, "active"), isNull(assignmentsTable.deletedAt)));
  return new Set(rows.map((r) => r.name));
}

export function pagination(req: Request) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (message = "Resource not found"): never => { throw new HttpError(404, message); };
export const forbidden = (message = "This action is not permitted"): never => { throw new HttpError(403, message); };

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch((error: unknown) => {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    });
  };
}

type AuditInput = {
  organizationId: string; actorId?: string | null; action: string;
  entityType: string; entityId?: string | null;
  before?: Record<string, unknown>; after?: Record<string, unknown>; ipAddress?: string;
};

export async function writeAuditLog(database: any, app: AppKey, input: AuditInput) {
  const table = app === "qaqc" ? auditLogEntries : app === "lessons" ? lessonsAuditLogEntries : auditAuditLogEntries;
  const { ipAddress, ...values } = input;
  const after = input.ipAddress
    ? { ...(input.after ?? {}), _requestIp: input.ipAddress }
    : input.after;
  await database.insert(table).values({ ...values, after });
}

type NotifyInput = {
  organizationId: string; userId: string; type: string; title: string; body: string;
  entityType?: string; entityId?: string;
};

const notificationTables: Record<AppKey, string> = {
  qaqc: "app1_qaqc.notifications",
  lessons: "app2_lessons.notifications",
  audit: "app3_audit.notifications",
};
// Keep the fallback suffix valid for PostgreSQL text (NUL is rejected by
// PostgreSQL even though JavaScript strings permit it).
const notificationMetaPrefix = "\n[QMS360_NOTIFICATION_META:";

function notificationBody(body: string, entityType?: string, entityId?: string) {
  return entityType && entityId
    ? `${body}${notificationMetaPrefix}${Buffer.from(JSON.stringify({ recordType: entityType, recordId: entityId }), "utf8").toString("base64")}]`
    : body;
}

export function readNotificationBody(body: string): { body: string; recordType: string | null; recordId: string | null } {
  const marker = body.lastIndexOf(notificationMetaPrefix);
  if (marker < 0) return { body, recordType: null, recordId: null };
  try {
    const encoded = body.slice(marker + notificationMetaPrefix.length).replace(/\]$/, "");
    const metadata = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as { recordType?: unknown; recordId?: unknown };
    return {
      body: body.slice(0, marker),
      recordType: typeof metadata.recordType === "string" ? metadata.recordType : null,
      recordId: typeof metadata.recordId === "string" ? metadata.recordId : null,
    };
  } catch {
    return { body, recordType: null, recordId: null };
  }
}

export async function notify(database: any, app: AppKey, input: NotifyInput) {
  const table = app === "qaqc" ? notifications : app === "lessons" ? lessonNotifications : auditNotifications;
  try {
    await database.insert(table).values({
      organizationId: input.organizationId, recipientId: input.userId, title: input.title,
      body: input.body, channel: "in_app", recordType: input.entityType, recordId: input.entityId,
    });
  } catch (error) {
    // Older deployed notification tables predate navigation columns. Retry
    // without them and carry metadata in an opaque suffix of the body.
    if (!(error instanceof Error && /record_type|record_id|column .* does not exist/i.test(error.message))) throw error;
    await database.execute(sql`
      INSERT INTO ${sql.raw(notificationTables[app])}
        (organization_id, recipient_id, title, body, channel)
      VALUES (${input.organizationId}, ${input.userId}, ${input.title}, ${notificationBody(input.body, input.entityType, input.entityId)}, 'in_app')
    `);
  }
}

export async function listNotifications(database: any, app: AppKey, organizationId: string, recipientId: string) {
  const result = await database.execute(sql`
    SELECT id, title, body, channel, read_at, created_at
    FROM ${sql.raw(notificationTables[app])}
    WHERE organization_id = ${organizationId} AND recipient_id = ${recipientId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `);
  return (result.rows as Array<{ id: string; title: string; body: string; channel: string; read_at: Date | null; created_at: Date }>).map((row) => {
    const decoded = readNotificationBody(row.body);
    return { ...row, body: decoded.body, recordType: decoded.recordType, recordId: decoded.recordId, readAt: row.read_at, createdAt: row.created_at };
  });
}

export async function markNotificationRead(database: any, app: AppKey, organizationId: string, recipientId: string, id: string) {
  const result = await database.execute(sql`
    UPDATE ${sql.raw(notificationTables[app])}
    SET read_at = ${new Date()}, updated_at = ${new Date()}
    WHERE id = ${id} AND organization_id = ${organizationId}
      AND recipient_id = ${recipientId} AND deleted_at IS NULL
    RETURNING id
  `);
  return (result.rows[0] as { id?: string } | undefined)?.id ?? null;
}

/**
 * In-app notification plus a best-effort email through the Cockpit SMTP
 * connector. The email is fire-and-forget (same pattern as SLA escalations):
 * SMTP latency or outages must never stall an approval workflow, and the
 * in-app notification is the durable record.
 */
export async function notifyWithEmail(database: any, app: AppKey, input: NotifyInput) {
  await notify(database, app, input);
  void deliverEmail(database, {
    organizationId: input.organizationId,
    recipientIds: [input.userId],
    subject: input.title,
    text: input.body,
    context: { kind: "workflow_notification", app, type: input.type, entityType: input.entityType, entityId: input.entityId },
  });
}