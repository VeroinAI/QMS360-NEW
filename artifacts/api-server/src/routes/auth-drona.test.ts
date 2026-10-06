import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueToken: vi.fn(), issueDronaToken: vi.fn(), getUserContext: vi.fn(), verifyToken: vi.fn(), select: vi.fn(),
  resolveDronaEmail: vi.fn(), dronaSessionProjects: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { select: mocks.select }, users: {}, platformRoles: {} }));
vi.mock("../lib/auth", () => ({
  ...mocks, ensureOrganization: vi.fn(), hashPassword: vi.fn(), verifyPassword: vi.fn(),
}));
vi.mock("../lib/drona/session", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/drona/session")>(),
  resolveDronaEmail: mocks.resolveDronaEmail,
  dronaSessionProjects: mocks.dronaSessionProjects,
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
    const response = await post("/auth/drona", { email: "synthetic@example.test", uid: "9007199254740993", nonce: "synthetic-proof-never-echo" });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("synthetic-proof");
    expect(body).not.toContain("9007199254740993");
    expect(mocks.issueToken).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it.each([
    {}, { email: "" }, { email: "not-an-email" }, { email: 1 },
    { email: "a@example.test", uid: "01" },
    { email: "a@example.test", nonce: "x".repeat(4097) },
    { email: "a@example.test", uid: "1; select 1" },
  ])("rejects malformed input without echoing it", async body => {
    vi.stubEnv("AUTH_STRATEGY", "drona");
    const response = await post("/auth/drona", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid Drona profile email is required" });
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

const org = "10000000-0000-0000-0000-000000000001";
const identity = { id: "20000000-0000-0000-0000-000000000001", organizationId: org, externalUserId: "9007199254740993" };
function enableException() {
  vi.stubEnv("AUTH_STRATEGY", "drona");
  vi.stubEnv("DRONA_EMAIL_EXCEPTION_ENABLED", "true");
  vi.stubEnv("DRONA_MAPPING_REVIEWED", "true");
  vi.stubEnv("DRONA_ENVIRONMENT", "aws");
  vi.stubEnv("DRONA_ORGANIZATION_ID", org);
  mocks.resolveDronaEmail.mockResolvedValue(identity);
  mocks.dronaSessionProjects.mockResolvedValue(["project-1"]);
  mocks.getUserContext.mockResolvedValue({
    id: identity.id, organizationId: org, email: "synthetic@example.test",
    username: "synthetic", fullName: "Synthetic Tester", platformRole: "Employee",
    organizationName: "Synthetic Organization", workspaceRoles: [],
  });
  mocks.issueDronaToken.mockReturnValue("synthetic-qms-token");
  mocks.verifyToken.mockReturnValue({
    sub: identity.id, organizationId: org, source: "drona-email-exception",
    externalUserId: identity.externalUserId, environment: "aws",
  });
}

describe("explicitly approved Drona email-only exception", () => {
  it("requires every activation setting and exposes the exception honestly", async () => {
    enableException();
    expect(await (await fetch(`${base}/api/auth/config`)).json()).toMatchObject({
      mode: "drona", dronaReady: true, dronaEmailException: true, localLoginAllowed: false, blockers: [],
    });
    vi.stubEnv("DRONA_MAPPING_REVIEWED", "false");
    const response = await post("/auth/drona", { email: "synthetic@example.test" });
    expect(response.status).toBe(503);
    const message = (await response.json() as { error: string }).error;
    expect(message).toContain("reviewed identity/project mappings");
    expect(message).not.toContain("backend session verification");
    expect(mocks.resolveDronaEmail).not.toHaveBeenCalled();
  });
  it("issues only an environment-bound QMS exception token with no nonce or UID required", async () => {
    enableException();
    const response = await post("/auth/drona", { email: "synthetic@example.test" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: "synthetic-qms-token", user: { id: identity.id } });
    expect(mocks.issueDronaToken).toHaveBeenCalledWith(identity, identity.externalUserId, "aws");
    expect(mocks.issueToken).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.dronaSessionProjects).toHaveBeenCalledWith(identity);
  });
  it("keeps password login, self-registration and the legacy bridge disabled after activation", async () => {
    enableException();
    expect((await post("/auth/login", {})).status).toBe(503);
    expect((await post("/auth/register", {})).status).toBe(503);
    expect((await post("/auth/sso", {})).status).toBe(501);
  });
  it("rejects source/schema failures without issuing a token", async () => {
    enableException();
    mocks.resolveDronaEmail.mockRejectedValueOnce(new Error("synthetic schema failure"));
    const response = await post("/auth/drona", { email: "synthetic@example.test" });
    expect(response.status).toBe(503);
    expect(mocks.issueDronaToken).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("synthetic schema failure");
  });
  it("rechecks active membership for a valid session", async () => {
    enableException();
    expect((await fetch(`${base}/protected`, { headers: { authorization: "Bearer synthetic-token" } })).status).toBe(200);
    expect(mocks.dronaSessionProjects).toHaveBeenCalledWith(identity);
  });
  it.each([
    { source: undefined }, { environment: "qa" }, { organizationId: "wrong-org" }, { externalUserId: undefined },
  ])("rejects old/local/cross-environment sessions before database access: %j", async changes => {
    enableException();
    mocks.verifyToken.mockReturnValueOnce({
      sub: identity.id, organizationId: org, source: "drona-email-exception",
      externalUserId: identity.externalUserId, environment: "aws", ...changes,
    });
    expect((await fetch(`${base}/protected`, { headers: { authorization: "Bearer synthetic-token" } })).status).toBe(401);
    expect(mocks.dronaSessionProjects).not.toHaveBeenCalled();
  });
  it("fails closed when source membership cannot be read", async () => {
    enableException();
    mocks.dronaSessionProjects.mockRejectedValueOnce(new Error("source unavailable"));
    expect((await fetch(`${base}/protected`, { headers: { authorization: "Bearer synthetic-token" } })).status).toBe(503);
  });
});