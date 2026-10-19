import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
const mock = vi.hoisted(() => ({
  select: vi.fn(), update: vi.fn(), visible: vi.fn(), store: vi.fn(), object: vi.fn(), audit: vi.fn(),
}));
vi.mock("@workspace/db", async original => ({
  ...await original<Record<string, unknown>>(), db: { select: mock.select, update: mock.update },
}));
vi.mock("../lib/admin-user-discovery", () => ({ visibleAdminUsers: mock.visible }));
vi.mock("../lib/objectStorage", () => ({ storeObject: mock.store, getObject: mock.object }));
vi.mock("../lib/workspace", async original => ({
  ...await original<Record<string, unknown>>(), writeAuditLog: mock.audit,
}));
import router from "./qaqc-user-profile";
import { UpdateQaqcUserProfileBody } from "@workspace/api-zod";

const target = { id: "profile-user", organizationId: "org", designation: "Engineer", signaturePath: "gcs:old-signature" };
let base: string, server: ReturnType<express.Express["listen"]>, saved: any;
function selectResult(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows, then: (resolve: (v: unknown[]) => void) => resolve(rows) }) }) };
}
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }), (req, _res, next) => {
    req.currentUser = { id: "admin", organizationId: "org" } as any; next();
  });
  app.use("/users", router);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? error.statusCode ?? 500).json({ error: error.message }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  mock.select.mockReturnValueOnce(selectResult([target])).mockReturnValueOnce(selectResult([]));
  mock.visible.mockImplementation(async (_req, rows) => rows);
  mock.update.mockReturnValue({ set: (value: any) => {
    saved = value;
    return { where: () => ({ returning: async () => [{ ...target, ...value }] }) };
  } });
  mock.store.mockResolvedValue("gcs:new-signature");
});
const put = (data: unknown) => fetch(`${base}/profile-user/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
describe("QA/QC designation and signature profile", () => {
  it("saves a trimmed designation, preserving the existing signature and logging metadata only", async () => {
    const response = await put({ designation: " Quality Manager " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: target.id, designation: "Quality Manager", signatureUrl: "/api/qaqc/admin/users/profile-user/signature" });
    expect(saved.signaturePath).toBe(target.signaturePath);
    expect(mock.store).not.toHaveBeenCalled();
    expect(mock.audit.mock.calls[0]?.[2]).toMatchObject({ actorId: "admin", entityType: "user_profile", after: { designation: "Quality Manager", hasSignature: true } });
  });
  it("supports clearing profile values without changing roles or access", async () => {
    const response = await put({ designation: "", signatureDataUrl: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: target.id, designation: null, signatureUrl: null });
    expect(Object.keys(saved).sort()).toEqual(["designation", "signaturePath", "updatedAt"]);
  });
  it("validates and stores a PNG signature in private storage", async () => {
    const signatureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    const response = await put({ signatureDataUrl });
    expect(response.status).toBe(200);
    expect(saved.designation).toBe("Engineer");
    expect(mock.store).toHaveBeenCalledWith("qms360/signatures/profile-user", expect.any(Buffer), "image/png");
  });
  it.each(["data:image/png;base64,broken", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,SGVsbG8="])("rejects invalid image payload %s", async signatureDataUrl => {
    expect((await put({ signatureDataUrl })).status).toBe(422);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("rejects signatures over 512KB", async () => {
    expect((await put({ signatureDataUrl: `data:image/png;base64,${Buffer.alloc(512 * 1024 + 1).toString("base64")}` })).status).toBe(422);
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("rejects a user outside administrator scope before storing or updating", async () => {
    mock.visible.mockResolvedValue([]);
    expect((await put({ designation: "Changed" })).status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.store).not.toHaveBeenCalled();
  });
  it("returns 404 for a user not found in this organization", async () => {
    mock.select.mockReset().mockReturnValue(selectResult([]));
    expect((await put({ designation: "Changed" })).status).toBe(404);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it("protects signature retrieval with the same management scope", async () => {
    mock.visible.mockResolvedValue([]);
    expect((await fetch(`${base}/profile-user/signature`)).status).toBe(403);
    expect(mock.object).not.toHaveBeenCalled();
  });
  it("serves a private signature through the QA/QC endpoint", async () => {
    mock.object.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    const response = await fetch(`${base}/profile-user/signature`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mock.object).toHaveBeenCalledWith("old-signature");
  });
  it("uses the generated request validator", () => {
    expect(UpdateQaqcUserProfileBody.safeParse({ designation: 123 }).success).toBe(false);
  });
});
