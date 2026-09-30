import { beforeEach, describe, expect, it, vi } from "vitest";

const { storeObject, getObject } = vi.hoisted(() => ({
  storeObject: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("./objectStorage", () => ({ storeObject, getObject }));

import { loadEmailPdfAttachments, storeEmailPdfAttachment } from "./email-attachments";

describe("email PDF attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRIVATE_OBJECT_DIR = "/private";
    storeObject.mockImplementation(async (path: string) => `/private/${path}`);
  });

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
});