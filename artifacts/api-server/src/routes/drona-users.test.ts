import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { lookup, add, verifyToken, getUserContext } = vi.hoisted(() => ({
  lookup: vi.fn(), add: vi.fn(), verifyToken: vi.fn(), getUserContext: vi.fn(),
}));
vi.mock("../lib/drona/admin-users", () => ({ lookupDronaAdminUser: lookup, addDronaAdminUser: add }));
vi.mock("../lib/auth", async original => ({
  ...await original<typeof import("../lib/auth")>(), verifyToken, getUserContext,
}));
vi.mock("../lib/date-format", () => ({
  withOrganizationDateFormat: async (_organizationId: string, run: () => unknown) => run(),
}));
import router from "./drona-users";
import { DronaAccessError } from "../lib/drona/errors";

let server: Server;
let base: string;
const org = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/platform/drona-users`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_STRATEGY", "local");
  verifyToken.mockReturnValue({ sub: id, organizationId: org });
  getUserContext.mockResolvedValue({ id, organizationId: org, platformRole: "Super Admin", accessStatus: "active" });
  lookup.mockResolvedValue({ externalUserId: "41", email: "person@example.test", fullName: "Example User", alreadyPresent: false });
  add.mockResolvedValue({ userId: id, email: "person@example.test", fullName: "Example User", alreadyPresent: false });
});
async function post(path = "/lookup", body: unknown = { email: "person@example.test" }, auth = true) {
  return fetch(base + path, { method: "POST", headers: {
    "content-type": "application/json", ...(auth ? { authorization: "Bearer test-session" } : {}),
  }, body: JSON.stringify(body) });
}
describe("Drona Add User HTTP authorization", () => {
  it("requires sign-in for lookup and add", async () => {
    expect((await post("/lookup", {}, false)).status).toBe(401);
    expect((await post("", {}, false)).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
  it.each(["Org Admin", "Employee", "Quality Manager"])("rejects %s even for direct API calls", async role => {
    getUserContext.mockResolvedValue({ id, organizationId: org, platformRole: role });
    expect((await post()).status).toBe(403);
    expect((await post("", { email: "person@example.test", externalUserId: "41" })).status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
  it("uses the authenticated organization for search", async () => {
    expect((await post("/lookup", { email: "person@example.test", organizationId: "foreign-org" })).status).toBe(200);
    expect(lookup).toHaveBeenCalledWith("person@example.test", org);
    expect(add).not.toHaveBeenCalled();
  });
  it("uses the authenticated actor and ignores supplied authority fields", async () => {
    const response = await post("", { email: "person@example.test", externalUserId: "41", actorId: "foreign", organizationId: "foreign" });
    expect(response.status).toBe(200);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ actorId: id, organizationId: org }));
    expect(await response.json()).toMatchObject({ userId: id });
  });
  it("requires the searched source ID for adding", async () => {
    expect((await post("", { email: "person@example.test" })).status).toBe(422);
    expect(add).not.toHaveBeenCalled();
  });
  it("returns source eligibility/configuration errors without a success response", async () => {
    lookup.mockRejectedValueOnce(new DronaAccessError(403, "No QMS360 assignment"));
    const denied = await post();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "No QMS360 assignment" });
    lookup.mockRejectedValueOnce(new Error("sensitive SQL detail"));
    const unavailable = await post();
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("sensitive SQL detail");
  });
});
