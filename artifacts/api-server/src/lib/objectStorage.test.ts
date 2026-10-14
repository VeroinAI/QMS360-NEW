import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send, sign, clients } = vi.hoisted(() => ({
  send: vi.fn(), sign: vi.fn(), clients: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(options: unknown) { clients(options); }
    send = send;
    destroy() {}
  },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));

import { getObject, removeObject, signedUploadUrl, storeObject } from "./objectStorage";
import {
  allowLocalStorageFallback, isRemoteStorageKey, privateObjectPath,
  toStorageKey, validateStorageConfiguration,
} from "./storage-config";

describe("private object storage providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QMS_STORAGE_PROVIDER", "s3");
    vi.stubEnv("AWS_REGION", "ap-south-1");
    vi.stubEnv("QMS_S3_BUCKET", "example-private-bucket");
    vi.stubEnv("QMS_S3_PREFIX", "qms360-prod");
    sign.mockResolvedValue("https://example-private-bucket.s3.ap-south-1.amazonaws.com/private-signed-put");
    send.mockResolvedValue({});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("stores bytes under the configured prefix without any public ACL", async () => {
    const bytes = Buffer.from("evidence");
    expect(await storeObject("qms360/audit/id", bytes, "text/plain"))
      .toBe("s3://example-private-bucket/qms360-prod/qms360/audit/id");
    expect(send.mock.calls[0]![0].input).toEqual({
      Bucket: "example-private-bucket", Key: "qms360-prod/qms360/audit/id",
      Body: bytes, ContentType: "text/plain",
    });
    expect(clients).toHaveBeenCalledWith({
      region: "ap-south-1", maxAttempts: 3, requestChecksumCalculation: "WHEN_REQUIRED",
    });
  });

  it("issues a 15-minute upload URL with a durable S3 reference", async () => {
    const upload = await signedUploadUrl("qaqc-pdf-templates/org/drafts/id.pdf");
    expect(upload.storageKey).toBe("s3://example-private-bucket/qms360-prod/qaqc-pdf-templates/org/drafts/id.pdf");
    expect(sign.mock.calls[0]![1].input).toEqual({
      Bucket: "example-private-bucket", Key: "qms360-prod/qaqc-pdf-templates/org/drafts/id.pdf",
    });
    expect(sign.mock.calls[0]![2]).toEqual({ expiresIn: 900 });
    expect(upload.uploadUrl).toMatch(/^https:/);
  });

  it("streams private downloads with original length and content type", async () => {
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
      }) },
      ContentType: "application/pdf", ContentLength: 3,
    });
    const response = await getObject("s3://example-private-bucket/qms360-prod/file.pdf");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("3");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("deletes only the referenced object in the application prefix", async () => {
    await removeObject("s3://example-private-bucket/qms360-prod/email-attachments/org/id.pdf");
    expect(send.mock.calls[0]![0].input).toEqual({
      Bucket: "example-private-bucket", Key: "qms360-prod/email-attachments/org/id.pdf",
    });
  });

  it.each([
    "s3://other-bucket/qms360-prod/file",
    "s3://example-private-bucket/qms360-prod-other/file",
    "s3://example-private-bucket/qms360-prod/../file",
    "s3://example-private-bucket/qms360-prod//file",
    "s3://example-private-bucket/qms360-prod/file?query",
    "s3://example-private-bucket/qms360-prod/folder\\file",
  ])("rejects foreign or unsafe references before AWS access: %s", async path => {
    await expect(getObject(path)).rejects.toThrow();
    await expect(removeObject(path)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("propagates AWS failures and never permits S3 disk fallback", async () => {
    send.mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(storeObject("file", Buffer.from("data"), "text/plain")).rejects.toThrow("AccessDenied");
    expect(allowLocalStorageFallback()).toBe(false);
  });

  it.each(["../file", "/file", "a/../file", "a//file", "a\\file"])(
    "rejects unsafe new object paths: %s", async relative => {
      await expect(signedUploadUrl(relative)).rejects.toThrow();
      expect(sign).not.toHaveBeenCalled();
    },
  );

  it("fails explicitly on invalid provider or incomplete AWS configuration", () => {
    vi.stubEnv("QMS_STORAGE_PROVIDER", "unknown");
    expect(validateStorageConfiguration).toThrow("QMS_STORAGE_PROVIDER");
    vi.stubEnv("QMS_STORAGE_PROVIDER", "s3");
    vi.stubEnv("QMS_S3_PREFIX", "");
    expect(validateStorageConfiguration).toThrow("QMS_S3_PREFIX");
    vi.stubEnv("QMS_S3_PREFIX", "qms360");
    vi.stubEnv("QMS_S3_BUCKET", "");
    expect(validateStorageConfiguration).toThrow("QMS_S3_BUCKET");
    vi.stubEnv("QMS_S3_BUCKET", "example-private-bucket");
    vi.stubEnv("AWS_REGION", "");
    expect(validateStorageConfiguration).toThrow("AWS_REGION");
  });

  it("keeps Replit as default and preserves existing GCS references", async () => {
    vi.stubEnv("QMS_STORAGE_PROVIDER", "");
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/replit-bucket/private");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ signed_url: "https://existing-replit-upload" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await signedUploadUrl("qms360/audit/id")).toEqual({
      storageKey: "gcs:/replit-bucket/private/qms360/audit/id", uploadUrl: "https://existing-replit-upload",
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      bucket_name: "replit-bucket", object_name: "private/qms360/audit/id", method: "PUT",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("preserves legacy Replit download and delete routing", async () => {
    vi.stubEnv("QMS_STORAGE_PROVIDER", "replit");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ signed_url: "https://replit-get" })))
      .mockResolvedValueOnce(new Response("bytes"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ signed_url: "https://replit-delete" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await getObject("gcs:/replit-bucket/private/file")).text()).toBe("bytes");
    await removeObject("/replit-bucket/private/file");
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "http://127.0.0.1:1106/object-storage/signed-object-url", "https://replit-get",
      "http://127.0.0.1:1106/object-storage/signed-object-url", "https://replit-delete",
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the configured root in tenant path guards and preserves key formats", () => {
    expect(privateObjectPath("email-attachments/org")).toBe("s3://example-private-bucket/qms360-prod/email-attachments/org");
    expect(toStorageKey("s3://example-private-bucket/qms360-prod/file")).toBe("s3://example-private-bucket/qms360-prod/file");
    expect(toStorageKey("/bucket/private/file")).toBe("gcs:/bucket/private/file");
    expect(isRemoteStorageKey("s3://example-private-bucket/qms360-prod/file")).toBe(true);
    expect(isRemoteStorageKey("gcs:/bucket/file")).toBe(true);
    expect(isRemoteStorageKey("local:audit/id")).toBe(false);
    vi.stubEnv("QMS_STORAGE_PROVIDER", "replit");
    vi.stubEnv("NODE_ENV", "production");
    expect(allowLocalStorageFallback()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(allowLocalStorageFallback()).toBe(true);
  });
});
