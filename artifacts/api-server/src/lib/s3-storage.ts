import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { safeObjectPath, s3Configuration } from "./storage-config";

let client: S3Client | undefined;
let clientRegion: string | undefined;

function s3Client() {
  const { region } = s3Configuration();
  if (!client || clientRegion !== region) {
    client?.destroy();
    // Standard AWS credential chain: IAM role preferred; no hardcoded credentials.
    client = new S3Client({ region, maxAttempts: 3, requestChecksumCalculation: "WHEN_REQUIRED" });
    clientRegion = region;
  }
  return client;
}

function objectLocation(objectPath: string) {
  const { bucket, prefix } = s3Configuration();
  const start = `s3://${bucket}/`;
  if (!objectPath.startsWith(start)) throw new Error("S3 object is outside the configured bucket");
  const key = safeObjectPath(objectPath.slice(start.length));
  if (!key.startsWith(`${prefix}/`)) throw new Error("S3 object is outside the configured application prefix");
  return { Bucket: bucket, Key: key };
}

export async function s3UploadUrl(objectPath: string) {
  return getSignedUrl(s3Client(), new PutObjectCommand(objectLocation(objectPath)), { expiresIn: 900 });
}

export async function storeS3Object(objectPath: string, bytes: Buffer, mimeType: string) {
  await s3Client().send(new PutObjectCommand({
    ...objectLocation(objectPath), Body: bytes, ContentType: mimeType,
    // No public ACL: the bucket's encryption and ownership policies apply.
  }), { abortSignal: AbortSignal.timeout(120_000) });
}

export async function getS3Object(objectPath: string) {
  const object = await s3Client().send(new GetObjectCommand(objectLocation(objectPath)),
    { abortSignal: AbortSignal.timeout(120_000) });
  if (!object.Body) throw new Error("S3 object has no content");
  const headers = new Headers();
  if (object.ContentType) headers.set("content-type", object.ContentType);
  if (object.ContentLength != null) headers.set("content-length", String(object.ContentLength));
  return new Response(object.Body.transformToWebStream() as ReadableStream<Uint8Array>, { headers });
}

export async function removeS3Object(objectPath: string) {
  await s3Client().send(new DeleteObjectCommand(objectLocation(objectPath)),
    { abortSignal: AbortSignal.timeout(30_000) });
}
