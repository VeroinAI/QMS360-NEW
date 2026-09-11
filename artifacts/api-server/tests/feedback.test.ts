import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, feedbackAttachments, feedbackEntries, organizations, platformRoles, users } from "@workspace/db";
import feedbackRouter from "../src/routes/feedback";
import feedbackFilesRouter from "../src/routes/feedback-files";
import authRouter from "../src/routes/auth";
import platformRouter from "../src/routes/platform";
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

async function apiBytes(method: string, path: string, token: string, body: Uint8Array) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
    body,
  });
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
  app.use("/api/feedback/attachments", feedbackFilesRouter);
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", platformRouter);
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
  await db.delete(feedbackAttachments).where(inArray(feedbackAttachments.organizationId, orgIds));
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
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Broken export button" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: memberA.token, body: { resolution: "resolved" } });
    expect(res.status).toBe(403);
  });

  it("lets a same-organization admin update the resolution and response, which the author can read", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Filter dropdown is empty" } });
    expect(created.status).toBe(201);
    const updated = await api("PUT", `/feedback/${created.json.id}/resolution`, {
      token: adminA.token,
      body: { resolution: "resolved", response: "The dropdown options were restored." },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.resolution).toBe("resolved");
    expect(updated.json.resolutionResponse).toBe("The dropdown options were restored.");
    expect(updated.json.user).toMatchObject({ id: memberA.id, fullName: "Member A" });
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("resolved");
    expect(entry.resolutionResponse).toBe("The dropdown options were restored.");
    const mine = await api("GET", "/feedback/mine", { token: memberA.token });
    expect(mine.status).toBe(200);
    expect(mine.json.items.find((item: any) => item.id === created.json.id)?.resolutionResponse)
      .toBe("The dropdown options were restored.");
  });

  it("rejects an invalid resolution value with 422", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Sort order is wrong" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "banana" } });
    expect(res.status).toBe(422);
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("open");
  });

  it("allows administrators to place feedback on hold", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "system", category: "issue", message: "Waiting for an external dependency" } });
    const held = await api("PUT", `/feedback/${created.json.id}/resolution`, {
      token: adminA.token,
      body: { resolution: "hold", response: "Paused until the dependency is available." },
    });
    expect(held.status).toBe(200);
    expect(held.json.resolution).toBe("hold");
    expect(held.json.resolutionResponse).toBe("Paused until the dependency is available.");
  });

  it("records who changed feedback to Additional info required and when", async () => {
    const created = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "audit", category: "question", message: "Which evidence file is required?" },
    });
    const changed = await api("PUT", `/feedback/${created.json.id}/resolution`, {
      token: adminA.token,
      body: { resolution: "additional_info_required", response: "Please attach the signed inspection record." },
    });
    expect(changed.status).toBe(200);
    expect(changed.json.resolution).toBe("additional_info_required");
    expect(changed.json.statusHistory).toHaveLength(1);
    expect(changed.json.statusHistory[0]).toMatchObject({
      fromStatus: "open",
      toStatus: "additional_info_required",
      changedById: adminA.id,
      changedByName: "Admin A",
    });
    expect(new Date(changed.json.statusHistory[0].changedAt).toString()).not.toBe("Invalid Date");

    const responseOnly = await api("PUT", `/feedback/${created.json.id}/resolution`, {
      token: adminA.token,
      body: { resolution: "additional_info_required", response: "Please attach both signed pages." },
    });
    expect(responseOnly.status).toBe(200);
    expect(responseOnly.json.statusHistory).toHaveLength(1);
  });

  it("downloads feedback and status history as an Excel workbook", async () => {
    const created = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "qaqc", category: "issue", message: "Export this feedback row" },
    });
    await api("PUT", `/feedback/${created.json.id}/resolution`, {
      token: adminA.token,
      body: { resolution: "hold", response: "Waiting for verification." },
    });
    const response = await realFetch(`${baseUrl}/feedback/export?module=qaqc`, {
      headers: { authorization: `Bearer ${adminA.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Feedback!);
    const row = rows.find((item) => item["Feedback ID"] === created.json.id);
    expect(row).toMatchObject({
      Feedback: "Export this feedback row",
      Status: "hold",
      "Submitted by user ID": memberA.id,
    });
    expect(row?.["Status history"]).toContain(`by ${adminA.id}`);
  });

  it("allows Closed only after Resolved", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "system", category: "issue", message: "The feedback workflow is incomplete" } });
    const tooEarly = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "closed" } });
    expect(tooEarly.status).toBe(409);
    const resolved = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "resolved" } });
    expect(resolved.status).toBe(200);
    const closed = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminA.token, body: { resolution: "closed" } });
    expect(closed.status).toBe(200);
    expect(closed.json.resolution).toBe("closed");
  });

  it("denies admins updating feedback from another organization", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "system", category: "suggestion", message: "Add dark mode please" } });
    expect(created.status).toBe(201);
    const res = await api("PUT", `/feedback/${created.json.id}/resolution`, { token: adminB.token, body: { resolution: "resolved" } });
    expect([403, 404]).toContain(res.status);
    const after = await api("GET", "/feedback", { token: adminA.token });
    const entry = after.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.resolution).toBe("open");
  });
});

describe("validation", () => {
  it("rejects submissions without a module with 422", async () => {
    const res = await api("POST", "/feedback", { token: memberA.token, body: { category: "issue", message: "Something is broken" } });
    expect(res.status).toBe(422);
  });

  it("rejects messages shorter than 5 characters with 422", async () => {
    const res = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "hi" } });
    expect(res.status).toBe(422);
  });

  it("rejects messages over 4000 characters with 422", async () => {
    const res = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "x".repeat(4001) } });
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

describe("admin re-triage", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await api("POST", `/feedback/${crypto.randomUUID()}/triage`);
    expect(res.status).toBe(401);
  });

  it("forbids non-admin users with 403", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Button does nothing" } });
    expect(created.status).toBe(201);
    const res = await api("POST", `/feedback/${created.json.id}/triage`, { token: memberA.token });
    expect(res.status).toBe(403);
  });

  it("returns 404 for feedback from another organization", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Button does nothing" } });
    expect(created.status).toBe(201);
    const res = await api("POST", `/feedback/${created.json.id}/triage`, { token: adminB.token });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent entry", async () => {
    const res = await api("POST", `/feedback/${crypto.randomUUID()}/triage`, { token: adminA.token });
    expect(res.status).toBe(404);
  });

  it("persists the triage result with the resolution suggestion", async () => {
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "audit", category: "question", message: "Where is the export button?" } });
    expect(created.status).toBe(201);
    stubAiResponse({ verdict: "awareness_gap", summary: "The feature already exists.", guidance: null, resolutionSuggestion: "Point the user to the export button." });
    const res = await api("POST", `/feedback/${created.json.id}/triage`, { token: adminA.token });
    expect(res.status).toBe(200);
    expect(res.json.triage).toMatchObject({ verdict: "awareness_gap", resolutionSuggestion: "Point the user to the export button." });
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.triage.resolutionSuggestion).toBe("Point the user to the export button.");
  });

  it("returns 503 and leaves prior triage unchanged when the AI fails", async () => {
    const triage = { verdict: "valid_issue", summary: "Real bug", guidance: null, resolutionSuggestion: null };
    const created = await api("POST", "/feedback", { token: memberA.token, body: { module: "qaqc", category: "issue", message: "Save button throws an error", triage } });
    expect(created.status).toBe(201);
    stubFetch(() => new Response("upstream error", { status: 500 }));
    const res = await api("POST", `/feedback/${created.json.id}/triage`, { token: adminA.token });
    expect(res.status).toBe(503);
    const list = await api("GET", "/feedback", { token: adminA.token });
    const entry = list.json.items.find((item: any) => item.id === created.json.id);
    expect(entry.triage.verdict).toBe("valid_issue");
  });
});

describe("happy path", () => {
  it("uploads and lists a reference file when the attachment table is unavailable", async () => {
    process.env.FEEDBACK_ATTACHMENTS_FORCE_FALLBACK = "true";
    try {
      const created = await api("POST", "/feedback", {
        token: memberA.token,
        body: { module: "system", category: "issue", message: "Fallback attachment metadata" },
      });
      const bytes = new TextEncoder().encode("fallback reference");
      const intent = await api("POST", `/feedback/${created.json.id}/attachments`, {
        token: memberA.token,
        body: { fileName: "fallback.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength },
      });
      expect(intent.status).toBe(201);
      const uploaded = await apiBytes("PUT", `/feedback/attachments/${intent.json.attachment.id}/upload`, memberA.token, bytes);
      expect(uploaded.status).toBe(200);

      const adminList = await api("GET", "/feedback", { token: adminA.token });
      const entry = adminList.json.items.find((item: any) => item.id === created.json.id);
      expect(entry.attachments).toEqual([expect.objectContaining({ fileName: "fallback.txt", status: "stored" })]);
      expect(entry.triage?._attachments).toBeUndefined();

      const download = await fetch(`${baseUrl}/feedback/attachments/${intent.json.attachment.id}/file`, {
        headers: { authorization: `Bearer ${adminA.token}` },
      });
      expect(download.status).toBe(200);
      expect(await download.text()).toBe("fallback reference");
    } finally {
      delete process.env.FEEDBACK_ATTACHMENTS_FORCE_FALLBACK;
    }
  });

  it("uploads a reference file that the author and admin can see", async () => {
    const created = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "system", category: "issue", message: "See the attached reference document" },
    });
    const bytes = new TextEncoder().encode("reference details");
    const intent = await api("POST", `/feedback/${created.json.id}/attachments`, {
      token: memberA.token,
      body: { fileName: "reference.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength },
    });
    expect(intent.status).toBe(201);
    const uploaded = await apiBytes("PUT", `/feedback/attachments/${intent.json.attachment.id}/upload`, memberA.token, bytes);
    expect(uploaded.status).toBe(200);

    const mine = await api("GET", "/feedback/mine", { token: memberA.token });
    const mineEntry = mine.json.items.find((item: any) => item.id === created.json.id);
    expect(mineEntry.attachments).toEqual([expect.objectContaining({ fileName: "reference.txt", status: "stored" })]);
    const adminList = await api("GET", "/feedback", { token: adminA.token });
    const adminEntry = adminList.json.items.find((item: any) => item.id === created.json.id);
    expect(adminEntry.attachments).toHaveLength(1);
    const authorDownload = await fetch(`${baseUrl}/feedback/attachments/${intent.json.attachment.id}/file`, {
      headers: { authorization: `Bearer ${memberA.token}` },
    });
    expect(authorDownload.status).toBe(200);
    expect(await authorDownload.text()).toBe("reference details");
    const adminDownload = await fetch(`${baseUrl}/feedback/attachments/${intent.json.attachment.id}/file`, {
      headers: { authorization: `Bearer ${adminA.token}` },
    });
    expect(adminDownload.status).toBe(200);
    const crossTenantDownload = await fetch(`${baseUrl}/feedback/attachments/${intent.json.attachment.id}/file`, {
      headers: { authorization: `Bearer ${adminB.token}` },
    });
    expect(crossTenantDownload.status).toBe(404);
  });

  it("submit then admin list shows the entry with user details and timestamp", async () => {
    const triage = { verdict: "suggestion", summary: "Enhancement idea", guidance: null, resolutionSuggestion: null };
    const created = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "qaqc", category: "suggestion", message: "It would be great to export reports", appKey: "qaqc", pagePath: "/qaqc/overview", triage },
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

  it("filters the admin list by module", async () => {
    const lessons = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "lessons", category: "issue", message: "Lesson photo is unavailable" },
    });
    const audit = await api("POST", "/feedback", {
      token: memberA.token,
      body: { module: "audit", category: "issue", message: "Audit report is unavailable" },
    });
    expect(lessons.status).toBe(201);
    expect(audit.status).toBe(201);

    const filtered = await api("GET", "/feedback?module=lessons", { token: adminA.token });
    expect(filtered.status).toBe(200);
    expect(filtered.json.items.some((item: any) => item.id === lessons.json.id)).toBe(true);
    expect(filtered.json.items.some((item: any) => item.id === audit.json.id)).toBe(false);
    expect(filtered.json.items.every((item: any) => item.module === "lessons")).toBe(true);
  });
});
