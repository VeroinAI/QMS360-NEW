/** Configuration only: never supply credentials in application source or client responses. */
export function storageProvider() {
  const provider = process.env.QMS_STORAGE_PROVIDER?.trim() || "replit";
  if (provider !== "replit" && provider !== "s3") {
    throw new Error("QMS_STORAGE_PROVIDER must be replit or s3");
  }
  return provider;
}

export function safeObjectPath(value: string) {
  if (!value || value.startsWith("/") || /[\\?#\x00-\x1f\x7f]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid private object path");
  }
  return value;
}

export function s3Configuration() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.QMS_S3_BUCKET?.trim();
  const prefix = process.env.QMS_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "");
  if (!region || !/^[a-z0-9-]+$/.test(region)) throw new Error("AWS_REGION is required for S3 storage");
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || bucket.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error("QMS_S3_BUCKET must be a valid S3 bucket name");
  }
  if (!prefix || !/^[a-zA-Z0-9/_-]+$/.test(prefix)) {
    throw new Error("QMS_S3_PREFIX is required and must be an application-specific folder");
  }
  safeObjectPath(prefix);
  return { region, bucket, prefix };
}

export function privateObjectPath(relativePath: string) {
  const relative = safeObjectPath(relativePath);
  if (storageProvider() === "s3") {
    const { bucket, prefix } = s3Configuration();
    return `s3://${bucket}/${prefix}/${relative}`;
  }
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!root) throw new Error("Object storage is not configured");
  return `${root}/${relative}`;
}

export function validateStorageConfiguration() {
  if (storageProvider() === "s3") s3Configuration();
}

/** Disk fallback remains development-only; never hide failed durable AWS writes. */
export function allowLocalStorageFallback() {
  return storageProvider() === "replit" && process.env.NODE_ENV !== "production";
}

export function isRemoteStorageKey(value: string) {
  return value.startsWith("gcs:") || value.startsWith("s3://");
}

export function toStorageKey(objectPath: string) {
  return objectPath.startsWith("s3://") ? objectPath : `gcs:${objectPath}`;
}
