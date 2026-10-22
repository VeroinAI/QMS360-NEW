import { PDFDocument } from "pdf-lib";
import { HttpError } from "./workspace";

function assertDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || width * height > 16_000_000)
    throw new HttpError(422, "Signature image dimensions are invalid or too large");
}

/** Validate actual image bytes, not just the client-supplied content type. */
export async function decodeProfileSignature(value: string) {
  if (value.length > 720 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(value);
  if (!match) throw new HttpError(422, "Signature must be a PNG, JPEG or WebP image");
  const bytes = Buffer.from(match[2]!, "base64"), mimeType = match[1]!;
  if (bytes.length > 512 * 1024) throw new HttpError(422, "Signature image exceeds the 512KB limit");
  if (!bytes.length || bytes.toString("base64") !== match[2])
    throw new HttpError(422, "Signature image must contain valid base64 data");
  try {
    if (mimeType === "image/webp") {
      if (bytes.length < 26 || bytes.toString("ascii", 0, 4) !== "RIFF"
        || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length)
        throw new Error("Invalid WebP container");
      let offset = 12, dimensions: { width: number; height: number } | undefined;
      while (offset + 8 <= bytes.length) {
        const type = bytes.toString("ascii", offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
        if (end > bytes.length) throw new Error("Invalid WebP chunk");
        if (type === "VP8 " && size >= 10 && bytes[start + 3] === 0x9d
          && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a)
          dimensions = { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
        else if (type === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
          const b1 = bytes[start + 1]!, b2 = bytes[start + 2]!, b3 = bytes[start + 3]!, b4 = bytes[start + 4]!;
          dimensions = { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
        }
        offset = end + (size & 1);
      }
      if (offset !== bytes.length || !dimensions) throw new Error("Invalid WebP frame");
      assertDimensions(dimensions.width, dimensions.height);
    } else {
      const document = await PDFDocument.create();
      const image = mimeType === "image/png" ? await document.embedPng(bytes) : await document.embedJpg(bytes);
      assertDimensions(image.width, image.height);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "Signature must be a valid PNG, JPEG or WebP image");
  }
  return { bytes, mimeType };
}
