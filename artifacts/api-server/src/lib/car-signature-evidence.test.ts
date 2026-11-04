import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ select: vi.fn(), read: vi.fn(), get: vi.fn(), store: vi.fn() }));
vi.mock("@workspace/db", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/db")>(), db: { select: mocks.select },
}));
vi.mock("./audit-plan-signatures", () => ({ readAuditPlanSignature: mocks.read }));
vi.mock("./objectStorage", () => ({ getObject: mocks.get, storeObject: mocks.store }));
import { db } from "@workspace/db";
import { captureCarSignature, checklistSignatureStatus, readCarSignature } from "./car-signature-evidence";

const bytes = new Uint8Array([1, 2, 3]);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: async () => [{ signaturePath: "gcs:/profile" }] }) });
  mocks.read.mockResolvedValue(bytes);
  mocks.store.mockImplementation(async path => `/private/${path}`);
  mocks.get.mockImplementation(async () => new Response(bytes));
});
describe("CAR immutable signature evidence", () => {
  it("copies normalized bytes to a unique private tenant/record path at the event", async () => {
    const first = await captureCarSignature(db, "org", "finding", "creator");
    const second = await captureCarSignature(db, "org", "finding", "creator");
    expect(first.path).toContain("gcs:/private/qms360/car-signature-evidence/org/finding/");
    expect(first.path).not.toBe(second.path);
    expect(first).toMatchObject({ organizationId: "org", recordId: "finding", userId: "creator",
      sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(new Date(first.capturedAt).toISOString()).toBe(first.capturedAt);
    expect(mocks.store).toHaveBeenCalledWith(expect.any(String), Buffer.from(bytes), "image/png");
    expect(await readCarSignature(first, "org", "finding")).toEqual(bytes);
  });
  it("keeps absent profiles and missing source objects as explicit gaps", async () => {
    mocks.select.mockReturnValueOnce({ from: () => ({ where: async () => [] }) });
    expect(await captureCarSignature(db, "org", "finding", "creator")).toMatchObject({ path: null, sha256: null });
    mocks.read.mockRejectedValueOnce(new Error("Object storage download returned 404"));
    expect(await captureCarSignature(db, "org", "finding", "creator")).toMatchObject({ path: null, sha256: null });
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("fails explicitly for transient reads and failed durable writes", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Object storage download returned 503"));
    await expect(captureCarSignature(db, "org", "finding", "creator")).rejects.toThrow("503");
    mocks.store.mockRejectedValueOnce(new Error("Upload failed"));
    await expect(captureCarSignature(db, "org", "finding", "creator")).rejects.toThrow("Upload failed");
  });
  it("refuses foreign records and detects missing or replaced snapshot objects without profile fallback", async () => {
    const evidence = await captureCarSignature(db, "org", "finding", "creator");
    expect(await readCarSignature(evidence, "other-org", "finding")).toBeUndefined();
    expect(await readCarSignature(evidence, "org", "other-finding")).toBeUndefined();
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockRejectedValueOnce(new Error("Missing object"));
    await expect(readCarSignature(evidence, "org", "finding")).rejects.toThrow("Missing object");
    mocks.get.mockResolvedValueOnce(new Response(new Uint8Array([9])));
    await expect(readCarSignature(evidence, "org", "finding")).rejects.toThrow("integrity");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("captures only new finding transitions and preserves existing evidence and unrelated metadata", async () => {
    const old = { id: "historical", auditFinding: "Major NC" };
    const before = { status: JSON.stringify({ title: "Audit" }), checklistState: [old, { id: "new", auditFinding: null }] };
    const next = [old, { id: "new", auditFinding: "Minor NC" }];
    const status = await checklistSignatureStatus(db, "org", before, next, "creator");
    const meta = JSON.parse(status);
    expect(meta.title).toBe("Audit");
    expect(Object.keys(meta.carOriginatorSignatures)).toEqual(["new"]);
    mocks.read.mockClear();
    expect(await checklistSignatureStatus(db, "org", { status, checklistState: next }, next, "another-editor")).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["Minor NC", "Custom legacy finding"])("captures a newly created legacy-result finding: %s", async result => {
    const status = await checklistSignatureStatus(db, "org", { status: "{}", checklistState: [] },
      [{ id: "legacy-new", result }], "creator");
    expect(JSON.parse(status).carOriginatorSignatures["legacy-new"]).toMatchObject({
      organizationId: "org", recordId: "legacy-new", userId: "creator",
      path: expect.stringContaining("/car-signature-evidence/org/legacy-new/"),
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: "historical", auditFinding: "Minor NC" },
    { id: "historical", result: "Minor NC", description: "Edited description" },
    { id: "historical", auditFinding: "OFI", result: "Minor NC" },
  ])("never backfills an existing legacy-result finding on edit: %j", async next => {
    const before = { status: JSON.stringify({ title: "Legacy audit" }),
      checklistState: [{ id: "historical", result: "Minor NC" }] };
    expect(JSON.parse(await checklistSignatureStatus(db, "org", before, [next], "current-editor")))
      .toEqual({ title: "Legacy audit" });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it.each(["", "  ", "Not applicable", "not applicable"])("does not capture non-actionable legacy results: %j", async result => {
    const status = await checklistSignatureStatus(db, "org", { status: "{}", checklistState: [] },
      [{ id: "not-finding", result }], "creator");
    expect(JSON.parse(status)).toEqual({});
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
