import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, organizations, users, platformRoles, emailEventRules, auditAuditLogEntries } from "@workspace/db";
import { auditEmailTemplateExamples, renderEmailRuleTemplate, unknownEmailTemplateFields } from "@workspace/field-controls";
import router from "../src/routes/email-rules";
import { issueToken } from "../src/lib/auth";
import { enqueueEmail } from "../src/lib/email-queue";

describe("email template rendering", () => {
  it("queues personalized bodies without changing CC or PDF attachments", async () => {
    let stored: any[] = [];
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: async (rows: any[]) => { stored = rows; } }),
    } as unknown as typeof db;
    const attachment = { filename: "audit.pdf", contentType: "application/pdf" as const, objectPath: "/private/test.pdf" };
    const queued = await enqueueEmail(database, {
      organizationId: "test", recipientIds: [],
      recipients: [{ email: "one@example.invalid", name: "One" }, { email: "two@example.invalid", name: "Two" }],
      ccRecipients: [{ email: "cc@example.invalid", name: "CC" }],
      subject: "Default", text: "Default body", attachments: [attachment],
      ruleTemplate: { subjectTemplate: "{audit_name}", bodyTemplate: "Dear {recipient_name},\n{review_comments}" },
      templateValues: { audit_name: "Audit A", review_comments: "Update required" },
    });
    expect(queued.queued).toBe(2);
    expect(stored.map(row => row.bodyText)).toEqual(["Dear One,\nUpdate required", "Dear Two,\nUpdate required"]);
    expect(stored[0].ccRecipients).toEqual([{ email: "cc@example.invalid", name: "CC" }]);
    expect(stored[1].ccRecipients).toEqual([]);
    expect(stored[0].context.emailAttachments).toEqual([attachment]);
    expect(stored[0].subject).toBe("Audit A");
  });
  it("personalizes Word-style fields while keeping plain text and line breaks", () => {
    expect(renderEmailRuleTemplate({
      subjectTemplate: "{Audit Schedule Name} – Approved",
      bodyTemplate: "Dear {{recipient_name}},\n\n{Audit_Program_Manager_Name}\n{System Name}",
    }, { subject: "Default", text: "Default" }, {
      audit_schedule_name: "Schedule A", recipient_name: "<Reviewer>", creator_name: "Manager", system_name: "QMS360",
    })).toEqual({ subject: "Schedule A – Approved", text: "Dear <Reviewer>,\n\nManager\nQMS360" });
  });
  it("uses default text when cleared and marks unavailable fields explicitly", () => {
    expect(renderEmailRuleTemplate({ subjectTemplate: "", bodyTemplate: "" }, { subject: "Original", text: "Original body" }, {}))
      .toEqual({ subject: "Original", text: "Original body" });
    expect(renderEmailRuleTemplate({ bodyTemplate: "{audit_area}" }, { subject: "Default", text: "Default" }, {}).text)
      .toBe("Not available");
  });
  it("rejects unsupported placeholders and ships only supported examples", () => {
    expect(unknownEmailTemplateFields("{unknown_field}")).toEqual(["unknown_field"]);
    for (const example of Object.values(auditEmailTemplateExamples)) {
      expect(unknownEmailTemplateFields(example.subjectTemplate + example.bodyTemplate)).toEqual([]);
    }
  });
});

describe("email-rule template persistence", () => {
  let server: Server, url: string, token: string, orgId: string;
  const input = {
    name: "Template test", eventType: "audit.audit_programme.submit", enabled: true, priority: 0,
    recipientMode: "all_users",
    recipientConfig: { subjectTemplate: "{audit_schedule_name} – Approval", bodyTemplate: "Dear {recipient_name},\n\nReview {record_reference}." },
  };
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const [org] = await db.insert(organizations).values({ name: `Email template test ${suffix}`, code: `ET${suffix}` }).returning();
    orgId = org!.id;
    const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin" }).returning();
    const [user] = await db.insert(users).values({
      organizationId: orgId, platformRoleId: role!.id, username: `template-${suffix}@example.invalid`,
      email: `template-${suffix}@example.invalid`, fullName: "Template test admin", passwordHash: "not-used", accessStatus: "active",
    }).returning();
    token = issueToken(user!);
    const app = express(); app.use(express.json()); app.use("/api", router);
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    url = `http://127.0.0.1:${address.port}/api/email-rules`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!orgId) return;
    await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.organizationId, orgId));
    await db.delete(emailEventRules).where(eq(emailEventRules.organizationId, orgId));
    await db.delete(users).where(eq(users.organizationId, orgId));
    await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });
  it("saves, reloads, updates and clears a rule's template without changing its routing", async () => {
    const created = await request("", "POST", input);
    expect(created.status).toBe(201);
    expect(created.data.recipientConfig).toEqual(input.recipientConfig);
    const loaded = await request("");
    expect(loaded.data.find((row: any) => row.id === created.data.id).recipientConfig).toEqual(input.recipientConfig);
    const edited = await request(`/${created.data.id}`, "PATCH", { ...input, recipientConfig: { ...input.recipientConfig, bodyTemplate: "Updated\n{recipient_name}" } });
    expect(edited.status).toBe(200);
    expect(edited.data.recipientMode).toBe("all_users");
    expect((await request("")).data[0].recipientConfig.bodyTemplate).toBe("Updated\n{recipient_name}");
    const cleared = await request(`/${created.data.id}`, "PATCH", { ...input, recipientConfig: { subjectTemplate: "", bodyTemplate: "" } });
    expect(cleared.status).toBe(200);
    expect(cleared.data.recipientConfig.bodyTemplate).toBe("");
  });
  it("validates placeholder names and subject headers before storing", async () => {
    expect((await request("", "POST", { ...input, recipientConfig: { bodyTemplate: "{unknown_field}" } })).status).toBe(422);
    expect((await request("", "POST", { ...input, recipientConfig: { subjectTemplate: "Bad\r\nSubject" } })).status).toBe(422);
  });
});