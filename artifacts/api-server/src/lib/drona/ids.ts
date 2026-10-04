/** PostgreSQL bigint identifiers must never pass through a JavaScript number. */
export function dronaId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)
    || value.length > 19 || BigInt(value) > 9223372036854775807n) {
    throw new Error("Drona identifiers must be canonical positive PostgreSQL bigint strings");
  }
  return value;
}

export function environmentKey(value: string): string {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(value)) {
    throw new Error("An explicit environment key is required");
  }
  return value;
}