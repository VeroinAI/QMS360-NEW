import { privateObjectPath, safeObjectPath, toStorageKey } from "./storage-config";
import { getS3Object, removeS3Object, s3UploadUrl, storeS3Object } from "./s3-storage";

const SIDECAR = "http://127.0.0.1:1106";

function parsePath(fullPath: string) {
  const parts = fullPath.replace(/^\//, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || !parts.length) throw new Error("Invalid private object storage path");
  return { bucketName, objectName: safeObjectPath(parts.join("/")) };
}

async function signedUrl(fullPath: string, method: "GET" | "PUT" | "DELETE") {
  const { bucketName, objectName } = parsePath(fullPath);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName, object_name: objectName, method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage signer returned ${response.status}`);
  const result = await response.json() as { signed_url?: string };
  if (!result.signed_url) throw new Error("Object storage signer returned no URL");
  return result.signed_url;
}

export async function signedUploadUrl(relativePath: string) {
  const fullPath = privateObjectPath(relativePath);
  return { storageKey: toStorageKey(fullPath), uploadUrl: fullPath.startsWith("s3://")
    ? await s3UploadUrl(fullPath) : await signedUrl(fullPath, "PUT") };
}

export async function storeObject(relativePath: string, bytes: Buffer, mimeType: string) {
  const fullPath = privateObjectPath(relativePath);
  if (fullPath.startsWith("s3://")) {
    await storeS3Object(fullPath, bytes, mimeType);
    return fullPath;
  }
  const response = await fetch(await signedUrl(fullPath, "PUT"), {
    method: "PUT", headers: { "content-type": mimeType }, body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Object storage upload returned ${response.status}`);
  return fullPath;
}

export async function getObject(fullPath: string) {
  fullPath = fullPath.replace(/^gcs:/, "");
  if (fullPath.startsWith("s3://")) return getS3Object(fullPath);
  const response = await fetch(await signedUrl(fullPath, "GET"), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`Object storage download returned ${response.status}`);
  return response;
}

export async function removeObject(fullPath: string) {
  fullPath = fullPath.replace(/^gcs:/, "");
  if (fullPath.startsWith("s3://")) return removeS3Object(fullPath);
  const response = await fetch(await signedUrl(fullPath, "DELETE"), { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Object storage delete returned ${response.status}`);
}