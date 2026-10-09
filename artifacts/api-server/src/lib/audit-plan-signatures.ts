import sharp from "sharp";
import { getObject } from "./objectStorage";

/** Read the user-master image through the existing private storage boundary. */
export async function readAuditPlanSignature(path: string | null | undefined): Promise<Uint8Array | undefined> {
  if (!path) return undefined;
  const object = await getObject(path.startsWith("gcs:") ? path.slice(4) : path);
  const mime = object.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime ?? "")) {
    throw new Error("Stored Audit Plan signature has an invalid content type");
  }
  return sharp(Buffer.from(await object.arrayBuffer()), { limitInputPixels: 16_000_000 })
    .rotate().resize({ width: 900, height: 240, fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
}
