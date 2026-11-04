import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, organizations, platformRoles, users, emailEventRules, auditAuditLogEntries,
  auditSchedules, auditPlans, outboundEmails,
} from "@workspace/db";
import emailRulesRouter from "../src/routes/email-rules";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";
import * as emailRules from "../src/lib/email-rules";

const eventType = "audit.audit_schedule.reschedule_audit";
let server: Server, url: string, token: string, orgId: string, otherOrgId: string, adminId: string, adminEmail: string;
const dispatch = vi.spyOn(emailRules, "dispatchEmailRule");
const input = {
  name: "Rescheduled audit", eventType, enabled: true, priority: 0,
  recipientMode: "external_email",
  receiverName: "Audit coordinator", receiverEmail: "coordinator@example.invalid",
  recipientConfig: {
    ccRecipient: { mode: "internal_user", userId: "" },
    subjectTemplate: "{audit_name} – Rescheduled",
    bodyTemplate: "Dear {recipient_name},\nAudit {record_reference} needs a new plan.",
  },
};

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${url}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

// Audit dispatch is intentionally asynchronous. Wait for the actual dispatch
// promises, rather than sleeping or invoking a second dispatch in the test.
async function settleDispatch() {
  await Promise.all(dispatch.mock.results.map(result => result.value));
}

async function schedule(metadata: Record<string, unknown> = {}) {
  const [row] = await db.insert(auditSchedules).values({
    organizationId: orgId, title: "Reschedule integration audit", year: 2026,
    ownerId: adminId, workflowState: "approved",
    status: JSON.stringify({ plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-02", ...metadata }),
  }).returning();
  return row!;
}

async function reschedule(id: string, overrides: Record<string, unknown> = {}) {
  const result = await request(`/audit/schedules/${id}/feasibility`, "POST", {
    decision: "reschedule", feedback: "Auditee unavailable",
    fromDate: "2026-02-01", toDate: "2026-02-02", ...overrides,
  });
  await settleDispatch();
  return result;
}

async function queued() {
  return db.select().from(outboundEmails).where(and(
    eq(outboundEmails.organizationId, orgId), eq(outboundEmails.eventType, eventType),
  ));
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db.insert(organizations).values({ name: `Reschedule email ${suffix}`, code: `RE${suffix}` }).returning();
  orgId = org!.id;
  const [otherOrg] = await db.insert(organizations).values({ name: `Other email tenant ${suffix}`, code: `OT${suffix}` }).returning();
  otherOrgId = otherOrg!.id;
  await db.insert(emailEventRules).values({
    organizationId: otherOrgId, name: "Other tenant reschedule", eventType, enabled: true, priority: 0,
    recipientMode: "external_email", receiverName: "Other tenant", receiverEmail: "other-tenant@example.invalid",
  });
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin" }).returning();
  const [admin] = await db.insert(users).values({
    organizationId: orgId, platformRoleId: role!.id, username: `reschedule-${suffix}`,
    email: `reschedule-${suffix}@example.invalid`, fullName: "Reschedule admin", accessStatus: "active",
  }).returning();
  adminId = admin!.id;
  adminEmail = admin!.email;
  token = issueToken(admin!);
  input.recipientConfig.ccRecipient.userId = adminId;
  const app = express();
  app.use(express.json());
  app.use("/api", emailRulesRouter);
  app.use("/api/audit", auditRouter);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  url = `http://127.0.0.1:${address.port}/api`;
});

afterAll(async () => {
  await settleDispatch();
  dispatch.mockRestore();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (!orgId) return;
  for (const table of [outboundEmails, auditAuditLogEntries, emailEventRules, auditPlans, auditSchedules, users, platformRoles]) {
    await db.delete(table).where(eq(table.organizationId, orgId));
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
  if (otherOrgId) {
    await db.delete(outboundEmails).where(eq(outboundEmails.organizationId, otherOrgId));
    await db.delete(emailEventRules).where(eq(emailEventRules.organizationId, otherOrgId));
    await db.delete(organizations).where(eq(organizations.id, otherOrgId));
  }
});

describe("Audit Rescheduled configured email delivery", () => {
  it("offers one clearly named catalog option before and after reschedule history exists", async () => {
    const option = { value: eventType, label: "Audit · Individual Audit · Audit Rescheduled" };
    expect((await request("/email-rules/catalog")).data.filter((row: any) => row.value === eventType)).toEqual([option]);
    await db.insert(auditAuditLogEntries).values({
      organizationId: orgId, actorId: adminId, entityType: "audit_schedule", action: "reschedule_audit",
    });
    expect((await request("/email-rules/catalog")).data.filter((row: any) => row.value === eventType)).toEqual([option]);
  });

  it("saves, reloads, edits and selects an enabled rule with To, CC and content intact", async () => {
    const created = await request("/email-rules", "POST", input);
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject(input);
    const edited = await request(`/email-rules/${created.data.id}`, "PATCH", { ...input, name: "Audit Rescheduled notification" });
    expect(edited.status).toBe(200);
    const loaded = (await request("/email-rules")).data.find((row: any) => row.id === created.data.id);
    expect(loaded.eventType).toBe(eventType);
    expect(loaded.recipientConfig).toEqual(input.recipientConfig);
    const selected = await request("/email-rules/simulate", "POST", { eventType, createdByUserId: adminId });
    expect(selected.data.matched).toBe(true);
    expect(selected.data.rule.id).toBe(created.data.id);
    expect(selected.data.recipients).toEqual([{ userId: null, name: input.receiverName, email: input.receiverEmail }]);
  });

  it("reschedules through the endpoint, logs once and queues exactly one configured To/CC message", async () => {
    const row = await schedule();
    dispatch.mockClear();
    const result = await reschedule(row.id);
    expect(result.status).toBe(200);
    const [saved] = await db.select().from(auditSchedules).where(eq(auditSchedules.id, row.id));
    expect(JSON.parse(saved!.status!)).toMatchObject({
      feasibilityDecision: "reschedule", feasibilityFeedback: "Auditee unavailable",
      plannedStartDate: "2026-02-01", plannedEndDate: "2026-02-02",
    });
    const logs = await db.select().from(auditAuditLogEntries).where(and(
      eq(auditAuditLogEntries.entityId, row.id), eq(auditAuditLogEntries.action, "reschedule_audit"),
    ));
    expect(logs).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const messages = await queued();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      entityId: row.id, eventType, app: "audit", deliveryStatus: "queued", attemptCount: 0,
      recipientEmail: input.receiverEmail, subject: `${row.title} – Rescheduled`,
      bodyText: `Dear Audit coordinator,\nAudit ${row.id} needs a new plan.`,
      senderEmail: null,
    });
    expect(messages[0]!.context.emailToRecipients).toEqual([{ email: input.receiverEmail, name: input.receiverName }]);
    expect(messages[0]!.ccRecipients).toEqual([{ email: adminEmail, name: "Reschedule admin" }]);
    expect(messages[0]!.context.ruleId).toBe((await request("/email-rules")).data[0].id);
    expect(await db.select().from(outboundEmails).where(eq(outboundEmails.organizationId, otherOrgId))).toEqual([]);
  });

  it("does not dispatch on missing feedback, dates, reversed dates, parent bounds, or an existing plan", async () => {
    const row = await schedule();
    dispatch.mockClear();
    for (const overrides of [{ feedback: "" }, { fromDate: undefined }, { toDate: undefined },
      { fromDate: "2026-02-03", toDate: "2026-02-01" }]) {
      expect((await reschedule(row.id, overrides)).status).toBe(422);
    }
    const parent = await schedule({ programme: true, fromDate: "2026-01-01", toDate: "2026-01-31" });
    const child = await schedule({ parentId: parent.id });
    expect((await reschedule(child.id)).status).toBe(422);
    await db.insert(auditPlans).values({
      organizationId: orgId, title: "Existing Plan", auditScheduleId: row.id, ownerId: adminId,
    });
    expect((await reschedule(row.id)).status).toBe(409);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await queued()).toHaveLength(1);
  });

  it("does not select the reschedule rule for cancellation or unrelated schedule updates", async () => {
    const row = await schedule();
    expect((await reschedule(row.id, { decision: "cancelled", fromDate: null, toDate: null })).status).toBe(200);
    const { writeAuditLog } = await import("../src/lib/workspace");
    await writeAuditLog(db, "audit", {
      organizationId: orgId, actorId: adminId, entityType: "audit_schedule", entityId: row.id, action: "update", after: row,
    });
    await settleDispatch();
    expect(await queued()).toHaveLength(1);
  });

  it("uses the first enabled matching rule, skipping disabled and actor-mismatched rules", async () => {
    const [rule] = await db.select().from(emailEventRules).where(eq(emailEventRules.organizationId, orgId));
    const [otherActor] = await db.insert(users).values({
      organizationId: orgId, username: `other-${randomUUID()}`,
      email: "other@example.invalid", fullName: "Other actor", accessStatus: "active",
    }).returning();
    await db.insert(emailEventRules).values([
      { ...input, organizationId: orgId, priority: -2, enabled: false, receiverEmail: "disabled@example.invalid" },
      { ...input, organizationId: orgId, priority: -1, createdByUserId: otherActor!.id, receiverEmail: "other@example.invalid" },
      { ...input, organizationId: orgId, priority: 1, receiverEmail: "later@example.invalid" },
    ] as any);
    const row = await schedule();
    expect((await reschedule(row.id)).status).toBe(200);
    const messages = (await queued()).filter(message => message.entityId === row.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.ruleId).toBe(rule!.id);
  });

  it("never queues without an enabled matching rule in this organization", async () => {
    await db.update(emailEventRules).set({ enabled: false }).where(eq(emailEventRules.organizationId, orgId));
    const disabled = await schedule();
    expect((await reschedule(disabled.id)).status).toBe(200);
    expect((await queued()).filter(message => message.entityId === disabled.id)).toEqual([]);
    await db.update(emailEventRules).set({ deletedAt: new Date() }).where(eq(emailEventRules.organizationId, orgId));
    const absent = await schedule();
    expect((await reschedule(absent.id)).status).toBe(200);
    expect((await queued()).filter(message => message.entityId === absent.id)).toEqual([]);
  });
});
