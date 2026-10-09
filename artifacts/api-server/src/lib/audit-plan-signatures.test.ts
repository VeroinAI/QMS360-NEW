import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const { getObject } = vi.hoisted(() => ({ getObject: vi.fn() }));
vi.mock("./objectStorage", () => ({ getObject }));
import { readAuditPlanSignature } from "./audit-plan-signatures";

beforeEach(() => { getObject.mockReset(); });
describe("Audit Plan user-master signatures", () => {
  it("does not fetch storage when the user has no signature", async () => {
    expect(await readAuditPlanSignature(null)).toBeUndefined();
    expect(getObject).not.toHaveBeenCalled();
  });
  it.each(["png", "jpeg", "webp"] as const)("loads and normalizes %s for PDF embedding", async format => {
    const bytes = await sharp({ create: { width: 400, height: 80, channels: 4, background: "#123456" } })
      .toFormat(format).toBuffer();
    getObject.mockResolvedValue(new Response(new Uint8Array(bytes), {
      headers: { "content-type": `image/${format}` },
    }));
    const signature = await readAuditPlanSignature("gcs:bucket/signature");
    expect(getObject).toHaveBeenCalledWith("bucket/signature");
    const info = await sharp(signature).metadata();
    expect(info.format).toBe("png");
    expect(info.width).toBe(400);
    expect(info.height).toBe(80);
  });
  it("rejects invalid image content instead of silently omitting an attached signature", async () => {
    getObject.mockResolvedValue(new Response("not an image", { headers: { "content-type": "text/html" } }));
    await expect(readAuditPlanSignature("bucket/signature")).rejects.toThrow("invalid content type");
  });
  it("propagates storage failures instead of claiming the signature is missing", async () => {
    getObject.mockRejectedValue(new Error("storage unavailable"));
    await expect(readAuditPlanSignature("bucket/signature")).rejects.toThrow("storage unavailable");
  });
});
