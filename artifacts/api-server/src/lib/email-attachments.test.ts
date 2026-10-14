import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storeObject, getObject, removeObject } = vi.hoisted(() => ({
  storeObject: vi.fn(),
  getObject: vi.fn(),
  removeObject: vi.fn(),
}));

vi.mock("./objectStorage", () => ({ storeObject, getObject, removeObject }));

import { loadEmailPdfAttachments, removeEmailPdfAttachment, storeEmailPdfAttachment } from "./email-attachments";

describe("email PDF attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/private");
    vi.stubEnv("QMS_STORAGE_PROVIDER", "replit");
    storeObject.mockImplementation(async (path: string) => `/private/${path}`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores a validated PDF under a sanitized, unique private path", async () => {
    const bytes = Buffer.from("%PDF-1.7\nsample");
    const first = await storeEmailPdfAttachment("org / one", "../record 1", bytes);
    const second = await storeEmailPdfAttachment("org / one", "../record 1", bytes);

    expect(first).toMatchObject({
      filename: "record-1.pdf",
      contentType: "application/pdf",
      objectPath: expect.stringMatching(/^\/private\/email-attachments\/org-one\/record-1\/[0-9a-f-]+\.pdf$/),
    });
    expect(second.objectPath).not.toBe(first.objectPath);
    expect(storeObject).toHaveBeenCalledWith(expect.stringMatching(/^email-attachments\/org-one\/record-1\/.+\.pdf$/), bytes, "application/pdf");
  });

  it("rejects non-PDF and oversized bytes before storage", async () => {
    await expect(storeEmailPdfAttachment("org", "record", Buffer.from("not a PDF"))).rejects.toThrow("must contain a PDF");
    await expect(storeEmailPdfAttachment("org", "record", Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow("10 MB or smaller");
    expect(storeObject).not.toHaveBeenCalled();
  });

  it("loads only private organization PDFs with the expected MIME type and size", async () => {
    const metadata = await storeEmailPdfAttachment("org", "record", Buffer.from("%PDF-1.7\nsample"));
    getObject.mockResolvedValueOnce(new Response(Buffer.from("%PDF-1.7\nsample"), {
      headers: { "content-type": "application/pdf", "content-length": "15" },
    }));

    const [attachment] = await loadEmailPdfAttachments("org", [metadata]);
    expect(getObject).toHaveBeenCalledWith(metadata.objectPath);
    expect(attachment?.content).toEqual(Buffer.from("%PDF-1.7\nsample"));

    await expect(loadEmailPdfAttachments("another-org", [metadata])).rejects.toThrow("invalid private object path");
    getObject.mockResolvedValueOnce(new Response(Buffer.from("%PDF-1.7\nsample"), {
      headers: { "content-type": "text/plain" },
    }));
    await expect(loadEmailPdfAttachments("org", [metadata])).rejects.toThrow("not a PDF");
  });

  it("loads and removes S3 email PDFs through the same tenant boundary", async () => {
    vi.stubEnv("QMS_STORAGE_PROVIDER", "s3");
    vi.stubEnv("AWS_REGION", "ap-south-1");
    vi.stubEnv("QMS_S3_BUCKET", "private-test-bucket");
    vi.stubEnv("QMS_S3_PREFIX", "qms360-prod");
    storeObject.mockImplementation(async (path: string) => `s3://private-test-bucket/qms360-prod/${path}`);
    const bytes = Buffer.from("%PDF-1.7\nsample");
    const metadata = await storeEmailPdfAttachment("org", "record", bytes);
    getObject.mockResolvedValueOnce(new Response(bytes, {
      headers: { "content-type": "application/pdf", "content-length": String(bytes.length) },
    }));
    expect((await loadEmailPdfAttachments("org", [metadata]))[0]?.content).toEqual(bytes);
    await removeEmailPdfAttachment("org", metadata.objectPath);
    expect(removeObject).toHaveBeenCalledWith(metadata.objectPath);
    await expect(removeEmailPdfAttachment("other-org", metadata.objectPath)).rejects.toThrow("invalid private object path");
    await expect(loadEmailPdfAttachments("org", [{
      ...metadata, objectPath: metadata.objectPath.replace("qms360-prod", "other-app"),
    }])).rejects.toThrow("invalid private object path");
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(removeObject).toHaveBeenCalledTimes(1);
  });
});