import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, feedbackEntries, organizations, platformRoles, users } from "@workspace/db";
import feedbackRouter from "../src/routes/feedback";
import { issueToken } from "../src/lib/auth";

// Route tests for the in-app feedback feature (submit, AI triage, admin review).
// They run against the real development database using a throwaway organization
// so auth, tenancy, and validation regressions surface before testers hit them.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgAId: string;
let orgBId: string;
let adminA: { id: string; organizationId: string; token: string };
let memberA: { id: string; organizationId: string; token: string };
let adminB: { id: string; organizationId: string; token: string };

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

// The server under test calls the AI proxy over fetch, but so does the test
// client itself — so stubs must pass non-AI requests through to the real fetch.
const realFetch = globalThis.fetch;

function stubFetch(handler: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("https://ai-proxy.test")) return handler();
    return realFetch(input, init);
  }));
}

function stubAiResponse(payload: unknown) {
  stubFetch(() => new Response(
    JSON.stringify({ content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", feedbackRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [orgA] = await db.insert(organizations).values({ name: `Feedback Test Org A ${suffix}`, code: `FTA${suffix}` }).returning();
  const [orgB] = await db.insert(organizations).values({ name: `Feedback Test Org B ${suffix}`, code: `FTB${suffix}` }).returning();
  orgAId = orgA!.id;
  orgBId = orgB!.id;

  const [roleA] = await db.insert(platformRoles).values({ organizationId: orgAId, name: "Org Admin", isSystem: true }).returning();
  const [roleB] = await db.insert(platformRoles).values({ organizationId: orgBId, name: "Org Admin", isSystem: true }).returning();

  const insertUser = (orgId: string, name: string, platformRoleId?: string) =>
    db.insert(users).values({
      organizationId: orgId,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}@example.test`,
      username: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}`,
      fullName: name,
      platformRoleId: platformRoleId ?? null,
    }).returning();

  const [adminRowA] = await insertUser(orgAId, "Admin A", roleA!.id);
  const [memberRowA] = await insertUser(orgAId, "Member A");
  const [adminRowB] = await insertUser(orgBId, "Admin B", roleB!.id);

  adminA = { id: adminRowA!.id, organizationId: orgAId, token: issueToken(adminRowA!) };
  memberA = { id: memberRowA!.id, organizationId: orgAId, token: issueToken(memberRowA!) };
  adminB = { id: adminRowB!.id, organizationId: orgBId, token: issueToken(adminRowB!) };

  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://ai-proxy.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  await new Promise((resolve) => server.close(resolve));
  const orgIds = [orgAId, orgBId];
  await db.delete(feedbackEntries).where(inArray(feedbackEntries.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("authentication", () => {
  it("rejects unauthenticated feedback submission with 401", async () => {
    const res = await api("POST", "/feedback", { body: { category: "issue", message: "Something is broken" } });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated feedback listing with 401", async () => {
    const res = await api("GET", "/feedback");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated AI triage with 401", async () => {
    const res = await api("POST", "/feedback/triage", { body: { category: "issue", message: "Something is broken" } });
    expect(res.status).toBe(401);
  });
});

describe("authorization", () => {
  it("forbids non-admin users from listing feedback with 403", async () => {
    const res = await api("GET", "/feedback", { token: memberA.token });
    expect(res.status).toBe(403);
  });

  it("forbids non-admin users from updating a resolution with 403", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "Broken export button" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: memberA.token, body: { resolution: "resolved" } });
    expect(res.status).toBe(403);
  });

  it("lets a same-organization admin update the resolution and persists it", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "Filter dropdown is empty" } });
    expect(created.status).toBe(201);
    const updated = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "resolved" } });
    expect(updated.status).toBe(200);
    expect(updated.json.resolution).toBe("resolved");
    expect(updated.json.user).toMatchObject({ id: memberA.id, fullName: "Member A" });
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("resolved");
  });

  it("rejects an invalid resolution value with 422", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "Sort order is wrong" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "banana" } });
    expect(res.status).toBe(422);
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("open");
  });

  it("denies admins updating feedback from another organization", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { category: "suggestion", message: "Add dark mode please" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminB.token, body: { resolution: "resolved" } });
    expect([403, 404]).toContain(res.status);
    const after = await api("GET", "/feedback", { token: adminA.token });
    const entry = after.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("open");
  });
});

describe("validation", () => {
  it("rejects messages shorter than 5 characters with 422", async () => {
    const res = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "hi" } });
    expect(res.status).toBe(422);
  });

  it("rejects messages over 4000 characters with 422", async () => {
    const res = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "x".repeat(4001) } });
    expect(res.status).toBe(422);
  });
});

describe("AI triage", () => {
  it("surfaces malformed (non-JSON) model output as 503 AI unavailable", async () => {
    stubAiResponse("not json at all");
    const res = await api("POST", "/feedback/triage", { token: memberA.token, body: { category: "issue", message: "The page crashes" } });
    expect(res.status).toBe(503);
    expect(res.json.error).toBeTruthy();
  });

  it("surfaces well-formed JSON with an invalid shape as 503 AI unavailable", async () => {
    stubAiResponse({ verdict: "banana", summary: "not a valid verdict" });
    const res = await api("POST", "/feedback/triage", { token: memberA.token, body: { category: "issue", message: "The page crashes" } });
    expect(res.status).toBe(503);
  });

  it("surfaces AI proxy failures as 503 AI unavailable", async () => {
    stubFetch(() => new Response("upstream error", { status: 500 }));
    const res = await api("POST", "/feedback/triage", { token: memberA.token, body: { category: "issue", message: "The page crashes" } });
    expect(res.status).toBe(503);
  });

  it("returns a validated triage result when the model output is well-formed", async () => {
    stubAiResponse({ verdict: "valid_issue", summary: "Genuine defect on the page.", guidance: null });
    const res = await api("POST", "/feedback/triage", { token: memberA.token, body: { category: "issue", message: "The page crashes on save" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ verdict: "valid_issue", summary: expect.any(String) });
  });
});

describe("happy path", () => {
  it("submit then admin list shows the entry with user details and timestamp", async () => {
    const triage = { verdict: "suggestion", summary: "Enhancement idea", guidance: null };
    const created = await api("POST", "/feedback", {
      token: memberA.token,
      body: { category: "suggestion", message: "It would be great to export reports", appKey: "qaqc", pagePath: "/qaqc/overview", triage },
    });
    expect(created.status).toBe(201);
    expect(created.json.user).toMatchObject({ id: memberA.id, fullName: "Member A" });

    const list = await api("GET", "/feedback", { token: adminA.token });
    expect(list.status).toBe(200);
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry).toBeDefined();
    expect(entry.message).toBe("It would be great to export reports");
    expect(entry.user).toMatchObject({ id: memberA.id, fullName: "Member A" });
    expect(entry.user.email).toBe(`member.a.${suffix}@example.test`);
    expect(Number.isNaN(Date.parse(entry.createdAt))).toBe(false);
    expect(entry.resolution).toBe("open");
  });

  it("keeps other organizations' feedback out of the admin list", async () => {
    const listB = await api("GET", "/feedback", { token: adminB.token });
    expect(listB.status).toBe(200);
    const emails: string[] = listB.json.items.map((item: any) => item.user.email);
    expect(emails.some((email) => email.endsWith(`.${suffix}@example.test`))).toBe(false);
  });
});
