import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  auditLogEntries, db, escalationInstances, escalationRules, organizations, platformRoles, users,
  userWorkspaceRoles, workspaceRoles,
} from "@workspace/db";
import qaqcRouter from "../src/routes/qaqc";
import { issueToken } from "../src/lib/auth";

// Roundtrip tests for escalation rule configuration: the settings UI saves the
// full rule set via PUT (replace-all) and reads DTOs via GET.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let admin: { id: string; token: string };

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: response.status, json };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api/qaqc", qaqcRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api/qaqc`;

  const [org] = await db.insert(organizations).values({ name: `Escalation Org ${suffix}`, code: `ES${suffix}` }).returning();
  orgId = org!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const [adminRow] = await db.insert(users).values({
    organizationId: orgId,
    email: `esc.admin.${suffix}@example.test`,
    username: `esc.admin.${suffix}`,
    fullName: "Esc Admin",
    platformRoleId: role!.id,
  }).returning();
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(auditLogEntries).where(inArray(auditLogEntries.organizationId, [orgId]));
  await db.delete(escalationInstances).where(inArray(escalationInstances.organizationId, [orgId]));
  await db.delete(escalationRules).where(inArray(escalationRules.organizationId, [orgId]));
  await db.delete(userWorkspaceRoles).where(inArray(userWorkspaceRoles.organizationId, [orgId]));
  await db.delete(workspaceRoles).where(inArray(workspaceRoles.organizationId, [orgId]));
  await db.delete(users).where(inArray(users.organizationId, [orgId]));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, [orgId]));
  await db.delete(organizations).where(inArray(organizations.id, [orgId]));
});

describe("escalation rule configuration", () => {
  it("starts empty for a new organization", async () => {
    const res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
  });

  it("saves rules and returns them as DTOs with array recipient roles", async () => {
    const saved = await api("PUT", "/admin/escalation-rules", {
      token: admin.token,
      body: [{
        id: randomUUID(), triggerType: "approval_delay", priority: "P2", level: "P2",
        slaWorkingDays: 3, recipientRoles: ["Quality Manager", "Project Manager"],
        repeatCadenceDays: 2, enabled: true,
      }],
    });
    expect(saved.status).toBe(200);

    const res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(1);
    const rule = res.json.items[0];
    expect(rule.triggerType).toBe("approval_delay");
    expect(Array.isArray(rule.recipientRoles)).toBe(true);
    expect(rule.slaWorkingDays).toBe(3);
    expect(rule.enabled).toBe(true);
  });

  it("clears all rules when saved with an empty set", async () => {
    const saved = await api("PUT", "/admin/escalation-rules", { token: admin.token, body: [] });
    expect(saved.status).toBe(200);
    const res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.json.items).toEqual([]);
  });

  it("lists escalation instances with rule-derived level and due date", async () => {
    const [rule] = await db.insert(escalationRules).values({
      organizationId: orgId, triggerKey: "approval_delay", priority: "P2",
      slaWorkingDays: 3, recipientRole: "Quality Manager", repeatCadenceDays: 2,
      configuration: { level: "P2" }, status: "active",
    }).returning();
    const breachedAt = new Date("2026-08-20T09:00:00.000Z");
    await db.insert(escalationInstances).values({
      organizationId: orgId, recordType: "quality_brief", recordId: randomUUID(),
      ruleId: rule!.id, status: "open", breachedAt, currentLevel: "P1",
    });

    const res = await api("GET", "/escalations", { token: admin.token });
    expect(res.status).toBe(200);
    const open = res.json.items.filter((i: any) => i.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].recordType).toBe("quality_brief");
    // Engine-advanced state wins over the rule's configured starting level.
    expect(open[0].level).toBe("P1");
    expect(open[0].dueAt).toBe(breachedAt.toISOString());

    await db.delete(escalationInstances).where(inArray(escalationInstances.organizationId, [orgId]));
    await db.delete(escalationRules).where(inArray(escalationRules.organizationId, [orgId]));
  });

  it("flags rule recipient roles that have no active members", async () => {
    await api("PUT", "/admin/escalation-rules", {
      token: admin.token,
      body: [{
        id: randomUUID(), triggerType: "approval_delay", priority: "P2", level: "P2",
        slaWorkingDays: 3, recipientRoles: ["Quality Manager", "Ghost Role"],
        repeatCadenceDays: 2, enabled: true,
      }],
    });
    let res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.json.items[0].unstaffedRoles).toEqual(["Quality Manager", "Ghost Role"]);

    const [role] = await db.insert(workspaceRoles).values({ organizationId: orgId, name: "Quality Manager" }).returning();
    await db.insert(userWorkspaceRoles).values({ organizationId: orgId, userId: admin.id, workspaceRoleId: role!.id });
    res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.json.items[0].unstaffedRoles).toEqual(["Ghost Role"]);

    // An inactive assignment or inactive role makes the role unstaffed again,
    // matching the escalation engine's recipient resolution.
    await db.update(userWorkspaceRoles).set({ status: "inactive" }).where(inArray(userWorkspaceRoles.organizationId, [orgId]));
    res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.json.items[0].unstaffedRoles).toEqual(["Quality Manager", "Ghost Role"]);

    await db.update(userWorkspaceRoles).set({ status: "active" }).where(inArray(userWorkspaceRoles.organizationId, [orgId]));
    await db.update(workspaceRoles).set({ status: "inactive" }).where(inArray(workspaceRoles.organizationId, [orgId]));
    res = await api("GET", "/admin/escalation-rules", { token: admin.token });
    expect(res.json.items[0].unstaffedRoles).toEqual(["Quality Manager", "Ghost Role"]);
  });
});
