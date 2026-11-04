import { HttpError } from "./workspace";

/** Keep legacy yearly counters as evidence, using their high-water mark for continuity. */
export function continuousLastUsed(range: Record<string, number> | undefined, document = "Audit"): number {
  const values = Object.values(range ?? {});
  if (values.some(value => !Number.isSafeInteger(value) || value < 0 || value > 999_999_999_999)) {
    throw new HttpError(409, `The saved ${document} number range is invalid; correct it before issuing a number.`);
  }
  return Math.max(0, ...values);
}

export function continuousRanges(ranges: Record<string, Record<string, number>> = {}, document = "Audit") {
  return Object.fromEntries(Object.entries(ranges).map(([scope, range]) =>
    [scope, { ...range, continuous: continuousLastUsed(range, document) }]));
}

export type AuditLastNumberRange = { scope: string; lastNumber: number };

export function validateLastNumber(lastNumber: number, current: number) {
  if (!Number.isSafeInteger(lastNumber) || lastNumber < 0 || lastNumber >= 999_999_999_999) {
    throw new HttpError(422, "Enter a whole last-used number from 0 to 999999999998.");
  }
  if (lastNumber < current) {
    throw new HttpError(409, `The last-used number cannot be below ${current}; allocated numbers must not be reused.`);
  }
}
