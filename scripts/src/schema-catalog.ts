import { is, SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import type { ColumnDefinition, ForeignKeyDefinition, IndexDefinition, TableDefinition } from "./schema-semantics";

const dialect = new PgDialect();
const render = (value: SQL) => dialect.sqlToQuery(value.inlineParams()).sql;

export function drizzleTables(exports: Record<string, unknown>): TableDefinition[] {
  return [...new Set(Object.values(exports).filter((v): v is PgTable => is(v, PgTable)))].map((table) => {
    const config = getTableConfig(table);
    const indexes: IndexDefinition[] = config.indexes.map(({ config: index }) => ({
      name: index.name ?? `${config.name}_${index.columns.map((c) => "name" in c ? c.name : "expression").join("_")}_index`,
      terms: index.columns.map((c) => {
        if (is(c, SQL)) return render(c);
        if (!("name" in c) || !c.name) throw new Error(`Unsupported index term on ${config.name}`);
        const opts = c.indexConfig;
        return `"${c.name}"${opts?.opClass ? ` ${opts.opClass}` : ""} ${opts?.order ?? "asc"} nulls ${opts?.nulls ?? (opts?.order === "desc" ? "first" : "last")}`;
      }),
      unique: index.unique, primary: false, method: index.method ?? "btree",
      predicate: index.where ? render(index.where) : null, include: [],
      nullsNotDistinct: false, valid: true,
    }));
    const constraintIndex = (name: string, columns: string[], primary: boolean, nullsNotDistinct = false) => {
      indexes.push({ name, terms: columns.map((c) => `"${c}"`), unique: true,
        primary, method: "btree", predicate: null, include: [], nullsNotDistinct, valid: true });
    };
    const primary = config.columns.filter((c) => c.primary);
    if (primary.length) constraintIndex(`${config.name}_pkey`, primary.map((c) => c.name), true);
    for (const p of config.primaryKeys) constraintIndex(p.getName(), p.columns.map((c) => c.name), true);
    for (const u of config.uniqueConstraints) constraintIndex(u.getName() ?? `${config.name}_${u.columns.map((c) => c.name).join("_")}_unique`, u.columns.map((c) => c.name), false, u.nullsNotDistinct);
    for (const c of config.columns.filter((c) => c.isUnique)) constraintIndex(c.uniqueName ?? `${config.name}_${c.name}_unique`, [c.name], false, c.uniqueType === "not distinct");
    return {
      schema: config.schema ?? "public", name: config.name,
      columns: config.columns.map((c): ColumnDefinition => {
        // getSQLType() returns an unqualified enum name; retain its namespace.
        const enumColumn = c as typeof c & { enum?: { schema?: string; enumName: string } };
        const type = enumColumn.enum ? `"${enumColumn.enum.schema ?? "public"}"."${enumColumn.enum.enumName}"` : c.getSQLType();
        return { name: c.name, type, notNull: c.notNull || c.primary || config.primaryKeys.some((p) => p.columns.some((key) => key.name === c.name)),
          default: c.default === undefined ? null : is(c.default, SQL) ? render(c.default) : render(sql`${c.mapToDriverValue(c.default)}`) };
      }),
      indexes,
      foreignKeys: config.foreignKeys.map((fk): ForeignKeyDefinition => {
        const reference = fk.reference();
        const target = getTableConfig(reference.foreignTable);
        return { name: fk.getName(), columns: reference.columns.map((c) => c.name),
          target: `${target.schema ?? "public"}.${target.name}`,
          targetColumns: reference.foreignColumns.map((c) => c.name),
          onUpdate: fk.onUpdate ?? "no action", onDelete: fk.onDelete ?? "no action",
          match: "simple", deferrable: false, initiallyDeferred: false, validated: true };
      }),
    };
  });
}

type Query = <T>(text: string) => Promise<T[]>;

/** Catalog SELECTs only. Caller supplies a read-only transaction. */
export async function readTables(query: Query, schemas: string[]): Promise<TableDefinition[]> {
  const schemaList = schemas.map((s) => `'${s.replaceAll("'", "''")}'`).join(", ");
  const tables = await query<TableDefinition>(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p')
  `);
  for (const table of tables) { table.columns = []; table.indexes = []; table.foreignKeys = []; }
  const find = (schema: string, table: string) => tables.find((t) => t.schema === schema && t.name === table)!;
  const columns = await query<ColumnDefinition & { schema: string; table: string }>(`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
      CASE WHEN typ.typtype = 'e' THEN quote_ident(tn.nspname) || '.' || quote_ident(typ.typname)
        ELSE format_type(a.atttypid, a.atttypmod) END AS type,
      a.attnotnull AS "notNull", pg_get_expr(d.adbin, d.adrelid) AS default
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type typ ON typ.oid = a.atttypid JOIN pg_namespace tn ON tn.oid = typ.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname IN (${schemaList}) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
  for (const { schema, table, ...column } of columns) find(schema, table).columns.push(column);
  const indexes = await query<IndexDefinition & { schema: string; table: string; options: number[] }>(`
    SELECT n.nspname AS schema, t.relname AS table, c.relname AS name,
      ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(1, i.indnkeyatts) k) AS terms,
      ARRAY(SELECT i.indoption[k - 1]::integer FROM generate_series(1, i.indnkeyatts) k) AS options,
      i.indisunique AS unique, i.indisprimary AS primary, am.amname AS method,
      pg_get_expr(i.indpred, i.indrelid) AS predicate,
      ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(i.indnkeyatts + 1, i.indnatts) k) AS include,
      i.indnullsnotdistinct AS "nullsNotDistinct", (i.indisvalid AND i.indisready) AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_am am ON am.oid = c.relam
    WHERE n.nspname IN (${schemaList}) AND t.relkind IN ('r', 'p')
  `);
  for (const { schema, table, options, ...index } of indexes) {
    // pg_get_indexdef(index, column, ...) may omit ordering decorators.
    // Read the actual btree per-key flags instead of assuming ASC/NULLS LAST.
    if (index.method === "btree") index.terms = index.terms.map((term, k) =>
      `${term.replace(/(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$/i, "")} ${(options[k]! & 1) ? "desc" : "asc"} nulls ${(options[k]! & 2) ? "first" : "last"}`);
    find(schema, table).indexes.push(index);
  }
  const foreignKeys = await query<ForeignKeyDefinition & { schema: string; table: string }>(`
    SELECT n.nspname AS schema, t.relname AS table, con.conname AS name,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num ORDER BY k.ord) AS columns,
      rn.nspname || '.' || rt.relname AS target,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num ORDER BY k.ord) AS "targetColumns",
      CASE con.confupdtype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS "onUpdate",
      CASE con.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS "onDelete",
      CASE con.confmatchtype WHEN 's' THEN 'simple' WHEN 'f' THEN 'full' WHEN 'p' THEN 'partial' END AS match,
      con.condeferrable AS deferrable, con.condeferred AS "initiallyDeferred", con.convalidated AS validated
    FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class rt ON rt.oid = con.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE n.nspname IN (${schemaList}) AND con.contype = 'f'
  `);
  for (const { schema, table, ...fk } of foreignKeys) find(schema, table).foreignKeys.push(fk);
  return tables;
}