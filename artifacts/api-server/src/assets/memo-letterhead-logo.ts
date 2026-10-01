import { readFile } from "node:fs/promises";

export function readMemoLetterheadLogo(): Promise<Buffer> {
  // In source this sits beside the PNG; the server build copies that PNG beside
  // the emitted bundle, where esbuild resolves import.meta.url at runtime.
  return readFile(new URL("./memo-letterhead-logo.png", import.meta.url));
}