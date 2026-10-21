export type HistField = { key: string; label: string; unit?: string };
export type HistOps = { view: boolean; edit: boolean; importOp: boolean; exportOp: boolean };

/** Audit envelopes contain metadata plus a flat balances record; render balances, not the envelope. */
export function historicalAuditChanges(fields: HistField[], before: unknown, after: unknown) {
  const balances = (entry: unknown): Record<string, unknown> => {
    const obj = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const nested = obj.balances;
    return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : obj;
  };
  const previous = balances(before), next = balances(after);
  const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return fields.map(field => ({ key: field.key, label: field.label, before: numeric(previous[field.key]), after: numeric(next[field.key]) }))
    .filter(change => change.before !== change.after);
}

export const isHoursField = (f: HistField) => /hour|hrs/i.test(`${f.unit ?? ''} ${f.key}`);

/** Converts a YYYY-MM month input value into the YYYY-MM-01 period the API expects. */
export function monthToPeriod(month: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null;
}

/** Finds the issued/raised counterpart for a "closed" field key, if one exists. */
export function issuedPartner(key: string, keys: string[]): string | null {
  const m = /^(.*?)(Closed|_closed)$/.exec(key);
  if (!m) return null;
  const base = m[1];
  const sep = m[2].startsWith('_') ? '_' : '';
  const cands = sep ? ['issued', 'raised', 'total'].map(s => `${base}_${s}`) : ['Issued', 'Raised', 'Total'].map(s => `${base}${s}`);
  return cands.find(c => keys.includes(c)) ?? null;
}

/** Validates raw string inputs. Blank never becomes zero. Returns per-field errors and parsed values. */
export function validateBalances(fields: HistField[], raw: Record<string, string>) {
  const errors: Record<string, string> = {};
  const values: Record<string, number> = {};
  for (const f of fields) {
    const s = (raw[f.key] ?? '').trim();
    if (s === '') { errors[f.key] = 'Required. Enter 0 if there is no balance.'; continue; }
    if (!/^-?\d+(\.\d+)?$/.test(s)) { errors[f.key] = 'Enter a number.'; continue; }
    const n = Number(s);
    if (!Number.isFinite(n)) { errors[f.key] = 'Enter a finite number.'; continue; }
    if (n < 0) { errors[f.key] = 'Cannot be negative.'; continue; }
    if (!isHoursField(f) && !Number.isInteger(n)) { errors[f.key] = 'Counts must be whole numbers.'; continue; }
    values[f.key] = n;
  }
  const keys = fields.map(f => f.key);
  for (const f of fields) {
    const p = issuedPartner(f.key, keys);
    if (p && values[f.key] != null && values[p] != null && values[f.key] > values[p]) {
      errors[f.key] = `Cannot exceed ${fields.find(x => x.key === p)?.label ?? p}.`;
    }
  }
  return { errors, values, valid: Object.keys(errors).length === 0 && Object.keys(values).length === fields.length };
}

export const reasonError = (r: string) => (r.trim().length >= 10 ? null : 'Give a reason of at least 10 characters.');

export function historicalOps(can: (m: string, op: never) => boolean): HistOps {
  const c = (op: string) => can('historical_balances', op as never);
  const view = c('view_all');
  return { view, edit: view && c('create_edit'), importOp: view && c('import'), exportOp: view && c('export') };
}
