type Row = Record<string, any>;
const numberKeys = ["findingNumber", "findingNumberScope", "findingNumberYear", "findingNumberSequence", "findingNumberType"] as const;

/** Issued numbering metadata is server-owned and cannot be replaced by form saves. */
export function preserveFindingNumber(input: Row, previous?: Row): Row {
  const clean = { ...input };
  for (const key of numberKeys) {
    delete clean[key];
    if (previous && previous[key] !== undefined) clean[key] = previous[key];
  }
  return clean;
}

