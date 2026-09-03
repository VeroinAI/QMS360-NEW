import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * At-rest encryption for connector credentials. Secret values (SMTP passwords
 * and similar) are stored in `integration_connectors.configuration` only as
 * `enc:v1:<salt>:<iv>:<tag>:<ciphertext>` envelopes; the plaintext never
 * touches the database. The encryption key is derived from the platform
 * SESSION_SECRET (Replit Secrets), so database exports and backups do not
 * expose usable credentials.
 *
 * Legacy plaintext values are still readable (decryptSecret returns them
 * unchanged) and are re-encrypted the next time the connector is saved.
 */

const PREFIX = "enc:v1";

export const isSecretKey = (key: string): boolean =>
  /(secret|password|token|api.?key|credential)/i.test(key);

export const isEncryptedSecret = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(`${PREFIX}:`);

function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set to store or read connector credentials");
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(value: string): string {
  if (isEncryptedSecret(value)) return value;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [PREFIX, salt.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value; // legacy plaintext
  const parts = value.split(":");
  const [, , salt, iv, tag, ciphertext] = parts; // skip "enc" and "v1"
  if (parts.length !== 6 || !salt || !iv || !tag || !ciphertext) throw new Error("Malformed encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(Buffer.from(salt, "base64")), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Returns a copy of a connector configuration with every secret-looking
 * string value encrypted (already-encrypted and masked values pass through).
 */
export function encryptConfigSecrets(configuration: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(configuration).map(([key, value]) => [
    key,
    isSecretKey(key) && typeof value === "string" && value !== "********" ? encryptSecret(value) : value,
  ]));
}
