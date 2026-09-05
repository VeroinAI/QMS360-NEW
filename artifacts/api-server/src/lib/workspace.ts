import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  auditAuditLogEntries,
  auditLogEntries,
  auditNotifications,
  lessonNotifications,
  lessonsAuditLogEntries,
  notifications,
} from "@workspace/db";
import { deliverEmail } from "./email";

export type AppKey = "qaqc" | "lessons" | "audit";

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

export async function notify(database: any, app: AppKey, input: NotifyInput) {
  const table = app === "qaqc" ? notifications : app === "lessons" ? lessonNotifications : auditNotifications;
  await database.insert(table).values({
    organizationId: input.organizationId,
    recipientId: input.userId,
    title: input.title,
    body: input.body,
    channel: "in_app",
  });
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