import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueToken: vi.fn(), getUserContext: vi.fn(), verifyToken: vi.fn(), select: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { select: mocks.select }, users: {}, platformRoles: {} }));
vi.mock("../lib/auth", () => ({
  ...mocks, ensureOrganization: vi.fn(), hashPassword: vi.fn(), verifyPassword: vi.fn(),
}));
import authRouter from "./auth";
import { requireAuth } from "../middlewares/auth";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.get("/protected", requireAuth, (_req, res) => { res.json({ ok: true }); });
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server failed");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function post(path: string, body: unknown) {
  return fetch(`${base}/api${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("Drona activation cannot be bypassed", () => {
  it("preserves local configuration without exposing secrets", async () => {
    vi.stubEnv("AUTH_STRATEGY", "local");
    const response = await fetch(`${base}/api/auth/config`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ mode: "local", localLoginAllowed: true, dronaReady: false, blockers: [] });
  });
  it("returns an explicit blocked Drona configuration", async () => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    const data = await (await fetch(`${base}/api/auth/config`)).json();
    expect(data).toMatchObject({ mode: "drona", localLoginAllowed: false, dronaReady: false });
    expect(data).toMatchObject({ blockers: [expect.any(String), expect.any(String), expect.any(String)] });
  });
  it("rejects a well-shaped but unverified profile without creating an identity or JWT", async () => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    const response = await post("/auth/drona", { uid: "9007199254740993", nonce: "synthetic-proof-never-echo" });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("synthetic-proof");
    expect(body).not.toContain("9007199254740993");
    expect(mocks.issueToken).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it.each([
    { uid: 1, nonce: "proof" }, { uid: "01", nonce: "proof" },
    { uid: "9223372036854775808", nonce: "proof" }, { uid: "1", nonce: " " },
    { uid: "1", nonce: "" }, { uid: "1", nonce: "x".repeat(4097) },
    { uid: "1; select 1", nonce: "proof" },
  ])("rejects malformed input without echoing it", async body => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    const response = await post("/auth/drona", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid Drona user ID and session proof are required" });
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });
  it("blocks local login, registration, old tokens and the unrelated bridge in Drona mode", async () => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    expect((await post("/auth/login", {})).status).toBe(503);
    expect((await post("/auth/register", {})).status).toBe(503);
    expect((await post("/auth/sso", {})).status).toBe(501);
    expect((await fetch(`${base}/protected`, { headers: { authorization: "Bearer old-local-admin-token" } })).status).toBe(503);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.getUserContext).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });
  it("does not enable Drona from local configuration or unknown strategy values", async () => {
    vi.stubEnv("AUTH_STRATEGY", "local");
    expect((await post("/auth/drona", { uid: "1", nonce: "proof" })).status).toBe(409);
    vi.stubEnv("AUTH_STRATEGY", "typo");
    expect(await (await fetch(`${base}/api/auth/config`)).json()).toMatchObject({ mode: "disabled", localLoginAllowed: false });
    expect((await post("/auth/login", {})).status).toBe(503);
  });
});