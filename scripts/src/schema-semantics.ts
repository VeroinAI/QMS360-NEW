/** Pure catalog comparison: no connections, DDL, or automatic reconciliation. */
import { canonicalJsonb } from "./jsonb-canonical";

export type ColumnDefinition = { name: string; type: string; notNull: boolean; default: string | null };
export type IndexDefinition = {
  name: string; terms: string[]; unique: boolean; primary: boolean; method: string;
  predicate: string | null; include: string[]; nullsNotDistinct: boolean; valid: boolean;
};
export type ForeignKeyDefinition = {
  name: string; columns: string[]; target: string; targetColumns: string[];
  onUpdate: string; onDelete: string; match: string; deferrable: boolean;
  initiallyDeferred: boolean; validated: boolean;
};
export type TableDefinition = {
  schema: string; name: string; columns: ColumnDefinition[];
  indexes: IndexDefinition[]; foreignKeys: ForeignKeyDefinition[];
};
export type DriftReport = { errors: string[]; warnings: string[] };

// Tokenize rather than lowercasing/replacing inside strings: literal contents and
// quoted, case-sensitive identifiers must remain significant.
function tokens(expression: string): string[] {
  return (expression.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|::|[a-zA-Z_][\w$]*|\d+(?:\.\d+)?|<>|!=|<=|>=|[^\s]/g) ?? [])
    .map((token) => token.startsWith("'") ? token
      : /^"[a-z_][a-z0-9_$]*"$/.test(token) ? token.slice(1, -1)
      : token.startsWith('"') ? token : token.toLowerCase());
}

function unwrap(parts: string[]): string[] {
  while (parts[0] === "(" && parts.at(-1) === ")") {
    let depth = 0;
    const closesEarly = parts.slice(0, -1).some((p) => {
      if (p === "(") depth++;
      if (p === ")") depth--;
      return depth === 0;
    });
    if (closesEarly) break;
    parts = parts.slice(1, -1);
  }
  return parts;
}

export function normalizeType(type: string): string {
  return tokens(type).join(" ")
    .replace(/\bpg_catalog \. /g, "")
    .replace(/\bcharacter varying\b/g, "varchar")
    .replace(/\btimestamp(?: \(\s*(\d+)\s*\))? without time zone\b/g, (_, precision) => precision ? `timestamp ( ${precision} )` : "timestamp")
    .replace(/\btimestamp(?: \(\s*(\d+)\s*\))? with time zone\b/g, (_, precision) => precision ? `timestamptz ( ${precision} )` : "timestamptz")
    .replace(/\btime without time zone\b/g, "time")
    .replace(/\btime with time zone\b/g, "timetz")
    .replace(/\b(?:int4|serial)\b/g, "integer")
    .replace(/\b(?:int8|bigserial)\b/g, "bigint")
    .replace(/\b(?:int2|smallserial)\b/g, "smallint")
    .replace(/\bbool\b/g, "boolean")
    .replace(/\bdecimal\b/g, "numeric")
    .replace(/\bfloat8\b/g, "double precision")
    .replace(/\bfloat4\b/g, "real");
}

/** Conservative default equivalence; arbitrary casts/functions are NOT erased. */
export function normalizeDefault(expression: string | null, type: string): string | null {
  if (expression == null) return null;
  let parts = unwrap(tokens(expression));
  const columnType = normalizeType(type);
  // Remove only a final cast to the column's own type (including its unconstrained
  // base type). In particular now()::date on a timestamp must not equal now().
  const cast = parts.lastIndexOf("::");
  if (cast >= 0) {
    const castType = normalizeType(parts.slice(cast + 1).join(" "));
    const baseType = columnType.replace(/ \([^)]*\)/g, "");
    if (castType === columnType || castType === baseType) parts = unwrap(parts.slice(0, cast));
  }
  let value = parts.join(" ");
  if (value === "null") return null;
  if (columnType === "timestamptz" && /^(?:now \( \)|current_timestamp|transaction_timestamp \( \))$/.test(value)) return "transaction-time";
  if (columnType === "uuid" && /^(?:pg_catalog \. |public \. )?gen_random_uuid \( \)$/.test(value)) return "gen_random_uuid()";
  if (columnType.endsWith("[ ]") && (value === "array [ ]" || value === "'{}'")) return "empty-array";
  const literal = value.match(/^'((?:''|[^'])*)'$/);
  if (literal) {
    const decoded = literal[1]!.replaceAll("''", "'");
    if (columnType === "jsonb") {
      try {
        return canonicalJsonb(decoded);
      } catch { /* Keep invalid/unknown literals distinct. */ }
    }
    if (/^(integer|bigint|smallint|numeric(?: \(|$)|real|double precision)/.test(columnType) && /^[+-]?\d+(?:\.\d+)?$/.test(decoded)) value = decoded;
    if (columnType === "boolean" && /^(true|false|t|f)$/.test(decoded)) value = decoded === "true" || decoded === "t" ? "true" : "false";
  }
  // Numeric spelling only; avoid Number() which loses precision for bigint.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    value = value.replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    if (/^-?0$/.test(value)) value = "0";
  }
  return value;
}

/** Parse only a nonempty list of string literals, with optional builtin text
 * casts. Never erase arbitrary casts, functions, NULLs, array expressions, or
 * SQL-looking content inside literals. */
function textLiteralList(parts: string[], start: number, close: string): { values: string[]; end: number } | null {
  const values: string[] = [];
  let i = start;
  while (i < parts.length) {
    const literal = parts[i];
    if (!literal || !/^'(?:''|[^'])*'$/.test(literal)) return null;
    values.push(literal);
    i++;
    if (parts[i] === "::") {
      i++;
      if (parts[i] === "pg_catalog" && parts[i + 1] === ".") i += 2;
      if (parts[i] !== "text") return null;
      i++;
    }
    if (parts[i] === close) return { values, end: i };
    if (parts[i] !== ",") return null;
    i++;
  }
  return null;
}

/** PG deparses text IN lists as = ANY(ARRAY[...]). Match this narrow,
 * type-confirmed case, not arbitrary SQL/array/operator equivalence. */
function normalizeTextMembership(parts: string[], textColumns: Set<string>): string[] {
  for (let i = 0; i < parts.length; i++) {
    if (!textColumns.has(parts[i]!) || [".", "::"].includes(parts[i - 1] ?? "")) continue;
    let list: ReturnType<typeof textLiteralList> = null;
    let end: number | undefined;
    if (parts[i + 1] === "in" && parts[i + 2] === "(") {
      list = textLiteralList(parts, i + 3, ")");
      end = list?.end;
    } else if (parts[i + 1] === "=" && parts[i + 2] === "any"
      && parts[i + 3] === "(" && parts[i + 4] === "array" && parts[i + 5] === "[") {
      list = textLiteralList(parts, i + 6, "]");
      if (list && parts[list.end + 1] === ")") end = list.end + 1;
    }
    if (!list || end === undefined) continue;
    const replacement = [parts[i]!, "in", "(",
      ...list.values.flatMap((value, index) => index ? [",", value] : [value]), ")"];
    parts.splice(i, end - i + 1, ...replacement);
    i += replacement.length - 1;
  }
  return parts;
}

/** Remove table qualification and harmless parentheses without changing precedence. */
export function normalizeExpression(expression: string | null, table: TableDefinition): string | null {
  if (!expression) return null;
  let parts = tokens(expression);
  const qualified = tokens(`${JSON.stringify(table.schema)}.${JSON.stringify(table.name)}.`);
  const unqualified = tokens(`${JSON.stringify(table.name)}.`);
  for (const prefix of [qualified, unqualified]) {
    parts = parts.filter((_, i, all) => !prefix.some((__, j) => {
      const start = i - j;
      return start >= 0 && prefix.every((p, k) => all[start + k] === p);
    }));
  }
  parts = unwrap(parts);
  // PG wraps each simple IS NULL predicate when printing a boolean conjunction.
  // Only remove atom/simple IS [NOT] NULL parentheses, never arbitrary arithmetic.
  // Introspection annotates comparison literals with their inferred column type.
  // Strip only those casts; a cast of the column itself remains significant.
  for (const column of table.columns) {
    const name = tokens(JSON.stringify(column.name))[0]!;
    const type = normalizeType(column.type).replace(/ \([^)]*\)/g, "");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== name || !["=", "<>", "!=", "<=", ">=", "<", ">"].includes(parts[i + 1] ?? "")
        || !parts[i + 2]?.startsWith("'") || parts[i + 3] !== "::") continue;
      let end = i + 4;
      while (end < parts.length && !["(", ")", ",", "and", "or", "::"].includes(parts[end]!)) end++;
      if (normalizeType(parts.slice(i + 4, end).join(" ")) === type) parts.splice(i + 3, end - (i + 3));
    }
  }
  const textColumns = new Set(table.columns.filter(column => normalizeType(column.type) === "text")
    .map(column => tokens(JSON.stringify(column.name))[0]!));
  parts = normalizeTextMembership(parts, textColumns);
  const identifier = (token: string | undefined) => token !== undefined
    && (/^[a-z_][\w$]*$/.test(token) || token.startsWith('"'));
  // Rewrite token groups only; quoted literal tokens are always opaque.
  // Do not remove function-call parentheses or arbitrary arithmetic/grouping.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== "(") continue;
    const previous = parts[i - 1];
    if (identifier(previous) && !["and", "or", "not"].includes(previous!)) continue;
    let end = i + 1;
    let depth = 1;
    for (; end < parts.length; end++) {
      if (parts[end] === "(") depth++;
      if (parts[end] === ")" && --depth === 0) break;
    }
    const inner = parts.slice(i + 1, end);
    if (!identifier(inner[0])) continue;
    const atom = inner.length === 1;
    const nullTest = (inner.length === 3 && inner[1] === "is" && inner[2] === "null")
      || (inner.length === 4 && inner[1] === "is" && inner[2] === "not" && inner[3] === "null");
    const comparison = inner.length === 3 && ["=", "<>", "!=", "<=", ">=", "<", ">"].includes(inner[1]!)
      && inner[2]!.startsWith("'");
    const membership = textColumns.has(inner[0]!) && inner[1] === "in" && inner[2] === "("
      && textLiteralList(inner, 3, ")")?.end === inner.length - 1;
    if (end < parts.length && (atom || nullTest || comparison || membership)) {
      parts.splice(end, 1);
      parts.splice(i, 1);
    }
  }
  return unwrap(parts).join(" ");
}

function indexSignature(index: IndexDefinition, table: TableDefinition): string {
  const terms = index.terms.map((term) => {
    // ASC / NULLS LAST are btree defaults; DESC defaults to NULLS FIRST.
    const normalized = normalizeExpression(term, table)!;
    const desc = / desc(?: nulls (?:first|last))?$/.test(normalized);
    return normalized.replace(desc ? / nulls first$/ : / nulls last$/, "").replace(/ asc$/, "").trim();
  });
  return JSON.stringify({ terms, unique: index.unique, primary: index.primary,
    method: index.method, predicate: normalizeExpression(index.predicate, table),
    include: index.include, nullsNotDistinct: index.nullsNotDistinct, valid: index.valid });
}

function foreignKeySignature(fk: ForeignKeyDefinition): string {
  return JSON.stringify({ columns: fk.columns, target: fk.target, targetColumns: fk.targetColumns,
    onUpdate: fk.onUpdate, onDelete: fk.onDelete, match: fk.match,
    deferrable: fk.deferrable, initiallyDeferred: fk.initiallyDeferred, validated: fk.validated });
}

/** PostgreSQL clips identifiers to 63 UTF-8 bytes, not 63 JS characters. */
export function postgresIdentifier(name: string): string {
  let clipped = "";
  for (const char of name) {
    if (Buffer.byteLength(clipped + char) > 63) break;
    clipped += char;
  }
  return clipped;
}

export function compareTables(expected: TableDefinition[], actual: TableDefinition[]): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maintenance = "Review a targeted migration; additive development setup does not rewrite existing definitions. Do not use a broad force push.";
  for (const table of expected) {
    const key = `${table.schema}.${table.name}`;
    const live = actual.find((t) => t.schema === table.schema && t.name === table.name);
    if (!live) { errors.push(`Table missing in database: ${key}`); continue; }
    for (const column of table.columns) {
      const found = live.columns.find((c) => c.name === column.name);
      const path = `${key}.${column.name}`;
      if (!found) { errors.push(`Column missing in database: ${path}`); continue; }
      if (normalizeType(column.type) !== normalizeType(found.type)) errors.push(`Column type differs: ${path}; expected ${column.type}, live ${found.type}. ${maintenance}`);
      if (column.notNull !== found.notNull) errors.push(`Column nullability differs: ${path}; expected ${column.notNull ? "NOT NULL" : "nullable"}, live ${found.notNull ? "NOT NULL" : "nullable"}. ${maintenance}`);
      if (normalizeDefault(column.default, column.type) !== normalizeDefault(found.default, found.type)) errors.push(`Column default differs: ${path}; expected ${column.default ?? "<none>"}, live ${found.default ?? "<none>"}. ${maintenance}`);
    }
    for (const column of live.columns) {
      if (!table.columns.some((c) => c.name === column.name)) warnings.push(`Column in database but not in drizzle schema: ${key}.${column.name}. Preserve it until its removal is explicitly reviewed.`);
    }
    const compareObjects = <T extends { name: string }>(kind: string, wanted: T[], existing: T[], signature: (v: T) => string) => {
      const remaining = [...existing];
      for (const definition of wanted) {
        let position = remaining.findIndex((v) => signature(v) === signature(definition));
        if (position >= 0) { remaining.splice(position, 1); continue; }
        position = remaining.findIndex((v) => postgresIdentifier(v.name) === postgresIdentifier(definition.name));
        if (position >= 0) {
          const found = remaining.splice(position, 1)[0]!;
          errors.push(`${kind} definition differs: ${key}.${definition.name}; expected ${signature(definition)}, live ${signature(found)}. ${maintenance}`);
        } else {
          errors.push(`${kind} definition missing in database: ${key}.${definition.name}; expected ${signature(definition)}. Existing definitions: ${remaining.map((v) => `${v.name}: ${signature(v)}`).join("; ") || "<none>"}. Review additions or a targeted replacement; preserve existing constraints/indexes pending approval.`);
        }
      }
      for (const extra of remaining) warnings.push(`${kind} in database but not in drizzle schema: ${key}.${extra.name}; live ${signature(extra)}. Preserve it; review whether to declare it in source/migrations or approve a targeted removal.`);
    };
    compareObjects("Index", table.indexes, live.indexes, (v) => indexSignature(v, table));
    compareObjects("Foreign key", table.foreignKeys, live.foreignKeys, foreignKeySignature);
  }
  for (const table of actual) {
    if (!expected.some((t) => t.schema === table.schema && t.name === table.name)) warnings.push(`Table in database but not in drizzle schema: ${table.schema}.${table.name}`);
  }
  return { errors, warnings };
}