const MB = 1024 * 1024;
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

type EvidenceLimits = {
  photoMaxMb: number;
  videoMaxMb: number;
  docMaxMb: number;
};

export function validateEvidenceFile(mimeType: string, sizeBytes: number, limits?: EvidenceLimits) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error("File size must be a positive integer");
  const max = mimeType.startsWith("image/") ? (limits?.photoMaxMb ?? 8) * MB
    : mimeType.startsWith("video/") ? (limits?.videoMaxMb ?? 200) * MB
      : DOCUMENT_MIMES.has(mimeType) ? (limits?.docMaxMb ?? 25) * MB : 0;
  if (!max) throw new Error("Unsupported evidence file type");
  if (sizeBytes > max) throw new Error(`File exceeds the ${Math.round(max / MB)}MB limit`);
}