import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { drizzleTables, readTables } from "./schema-catalog";
import { compareTables, normalizeDefault, normalizeExpression, normalizeType, postgresIdentifier, type TableDefinition } from "./schema-semantics";
import { canonicalJsonb } from "./jsonb-canonical";

const fixture = (): TableDefinition => ({
  schema: "shared", name: "connector_field_mappings",
  columns: [
    { name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()" },
    { name: "connector_id", type: "uuid", notNull: true, default: null },
    { name: "target", type: "text", notNull: true, default: "'draft'" },
    { name: "deleted_at", type: "timestamp with time zone", notNull: false, default: null },
    { name: "created_at", type: "timestamp with time zone", notNull: true, default: "now()" },
    { name: "configuration", type: "jsonb", notNull: true, default: "'{\"a\":1,\"b\":2}'" },
    { name: "count", type: "integer", notNull: true, default: "0" },
  ],
  indexes: [{
    name: "connector_field_mappings_connector_idx", terms: ['"connector_id" asc nulls last'],
    unique: false, primary: false, method: "btree", predicate: '"shared"."connector_field_mappings"."deleted_at" IS NULL',
    include: [], nullsNotDistinct: false, valid: true,
  }],
  foreignKeys: [{
    name: "connector_field_mappings_connector_id_integration_connectors_id_fk",
    columns: ["connector_id"], target: "shared.integration_connectors", targetColumns: ["id"],
    onUpdate: "no action", onDelete: "cascade", match: "simple",
    deferrable: false, initiallyDeferred: false, validated: true,
  }],
});

export async function runSemanticFixtures(): Promise<void> {
  let cases = 0;
  const test = (name: string, run: () => void) => { run(); cases++; console.log(`PASS: ${name}`); };
  const drift = (name: string, change: (live: TableDefinition) => void, diagnostic: string) => test(name, () => {
    const expected = fixture();
    const live = structuredClone(expected);
    change(live);
    const report = compareTables([expected], [live]);
    assert(report.errors.some((e) => e.includes(diagnostic)), JSON.stringify(report));
    assert(report.errors.some((e) => /Review|missing/.test(e)));
  });
  test("equivalent introspection defaults, predicates and legacy FK names pass", () => {
    const expected = fixture();
    const live = structuredClone(expected);
    live.columns[0]!.default = "(public.gen_random_uuid())";
    live.columns[2]!.default = "('draft'::text)";
    live.columns[3]!.default = "NULL::timestamp with time zone";
    live.columns[4]!.default = "CURRENT_TIMESTAMP";
    live.columns[5]!.default = `'{"b": 2, "a": 1}'::jsonb`;
    live.columns[6]!.default = "('000'::integer)";
    live.columns[6]!.type = "int4";
    live.indexes[0]!.terms = ["connector_id"];
    live.indexes[0]!.predicate = "(deleted_at IS NULL)";
    live.foreignKeys[0]!.name = postgresIdentifier(expected.foreignKeys[0]!.name.replace(/_fk$/, ""));
    assert.deepEqual(compareTables([expected], [live]), { errors: [], warnings: [] });
  });
  test("type aliases normalize but precision, length, timezone and namespace remain significant", () => {
    for (const [a, b] of [["varchar(32)", "character varying(32)"], ["numeric(10,2)", "decimal(10, 2)"], ["timestamptz", "timestamp with time zone"], ["integer[]", "int4[]"]]) assert.equal(normalizeType(a!), normalizeType(b!));
    for (const [a, b] of [["varchar(32)", "varchar(64)"], ["numeric(10,2)", "numeric(10,3)"], ["timestamp", "timestamptz"], ['"shared"."state"', '"app1_qaqc"."state"'], ["text", "text[]"]]) assert.notEqual(normalizeType(a!), normalizeType(b!));
  });
  test("equivalent array/numeric/boolean/escaped defaults pass without losing precision", () => {
    for (const [a, b, type] of [
      ["ARRAY[]::uuid[]", "'{}'::uuid[]", "uuid[]"], ["'0'::numeric", "0.00", "numeric(10,2)"],
      ["true", "'t'::boolean", "boolean"], ["'O''Brien'::text", "'O''Brien'", "text"],
      ["(transaction_timestamp())", "now()", "timestamp with time zone"],
    ]) assert.equal(normalizeDefault(a!, type!), normalizeDefault(b!, type!));
    assert.notEqual(normalizeDefault("9007199254740992", "bigint"), normalizeDefault("9007199254740993", "bigint"));
  });
  test("substantive casts, clock functions and literal content remain distinct", () => {
    for (const [a, b, type] of [
      ["now()::date", "now()", "timestamp with time zone"],
      ["clock_timestamp()", "now()", "timestamp with time zone"],
      ["CURRENT_TIMESTAMP(0)", "now()", "timestamp with time zone"],
      ["'Draft'::text", "'draft'", "text"], ["'a  b'", "'a b'", "text"],
      ["'{}'::json", "'{}'::jsonb", "jsonb"],
    ]) assert.notEqual(normalizeDefault(a!, type!), normalizeDefault(b!, type!));
  });
  test("predicate casts and parentheses pass, but grouping, case and functions remain significant", () => {
    const table = fixture();
    assert.equal(normalizeExpression(`("deleted_at" IS NULL) AND ("target" = 'draft'::text)`, table),
      normalizeExpression(`"shared"."connector_field_mappings"."deleted_at" IS NULL AND "target" = 'draft'`, table));
    assert.notEqual(normalizeExpression("a AND (b OR c)", table), normalizeExpression("(a AND b) OR c", table));
    assert.notEqual(normalizeExpression(`"Target" = 'draft'`, table), normalizeExpression(`target = 'draft'`, table));
    assert.notEqual(normalizeExpression("lower(target)", table), normalizeExpression("upper(target)", table));
  });
  test("partial unique index literal text is opaque to parenthesis and cast rewrites", () => {
    for (const [a, b] of [
      ["( foo )", "foo"], ["( target is null )", "target is null"],
      ["( target = ''draft'' )", "target = ''draft''"],
      ["target = ''draft'' :: text", "target = ''draft''"],
      ["and ( foo )", "and foo"], ["lower ( foo )", "lower foo"],
    ]) {
      const expected = fixture(); const live = fixture();
      expected.indexes[0]!.unique = live.indexes[0]!.unique = true;
      expected.indexes[0]!.predicate = `target = '${a}'`;
      live.indexes[0]!.predicate = `target = '${b}'`;
      assert.match(compareTables([expected], [live]).errors.join("\n"), /Index definition differs/);
    }
  });
  test("JSONB defaults preserve large integers and high-precision decimals", () => {
    for (const [a, b] of [
      ["9007199254740992", "9007199254740993"],
      ["123456789012345678901234567890", "123456789012345678901234567891"],
      ["0.123456789012345678901", "0.123456789012345678902"],
      ["1e-400", "2e-400"], ["1e400", "2e400"],
    ]) {
      const expected = fixture(); const live = fixture();
      expected.columns[5]!.default = `'{"value": ${a}}'::jsonb`;
      live.columns[5]!.default = `'{"value": ${b}}'::jsonb`;
      assert.match(compareTables([expected], [live]).errors.join("\n"), /Column default differs/);
    }
    assert.equal(canonicalJsonb('{"a": 1.00, "b": [0.10, 1e3]}'), canonicalJsonb('{"b": [1e-1,1000], "a": 1}'));
    assert.equal(canonicalJsonb('{"a": 1, "a": 2}'), canonicalJsonb('{"a": 2}'));
    assert.equal(canonicalJsonb('{"a": -0.0}'), canonicalJsonb('{"a": 0}'));
    assert.notEqual(canonicalJsonb('{"a":"9007199254740993"}'), canonicalJsonb('{"a":9007199254740993}'));
    assert.throws(() => canonicalJsonb('{"a": 01}'));
  });
  drift("column type drift blocks", (t) => { t.columns[2]!.type = "varchar(40)"; }, "Column type differs: shared.connector_field_mappings.target");
  drift("nullable-to-required drift blocks", (t) => { t.columns[2]!.notNull = false; }, "Column nullability differs");
  drift("required-to-nullable drift blocks", (t) => { t.columns[3]!.notNull = true; }, "Column nullability differs");
  drift("changed default blocks", (t) => { t.columns[2]!.default = "'published'::text"; }, "Column default differs");
  drift("missing default blocks", (t) => { t.columns[2]!.default = null; }, "Column default differs");
  drift("unexpected default blocks", (t) => { t.columns[1]!.default = "gen_random_uuid()"; }, "Column default differs");
  drift("missing column blocks", (t) => { t.columns.splice(1, 1); }, "Column missing in database");
  test("missing table blocks", () => assert.match(compareTables([fixture()], []).errors.join("\n"), /Table missing in database/));
  drift("missing index blocks", (t) => { t.indexes = []; }, "Index definition missing");
  for (const [name, change] of [
    ["uniqueness", (t: TableDefinition) => { t.indexes[0]!.unique = true; }],
    ["key columns", (t: TableDefinition) => { t.indexes[0]!.terms = ["target"]; }],
    ["partial predicate", (t: TableDefinition) => { t.indexes[0]!.predicate = "deleted_at IS NOT NULL"; }],
    ["method", (t: TableDefinition) => { t.indexes[0]!.method = "hash"; }],
    ["sort direction", (t: TableDefinition) => { t.indexes[0]!.terms = ["connector_id desc"]; }],
    ["null ordering", (t: TableDefinition) => { t.indexes[0]!.terms = ["connector_id asc nulls first"]; }],
    ["included columns", (t: TableDefinition) => { t.indexes[0]!.include = ["target"]; }],
    ["null uniqueness", (t: TableDefinition) => { t.indexes[0]!.nullsNotDistinct = true; }],
    ["validity", (t: TableDefinition) => { t.indexes[0]!.valid = false; }],
  ] as const) drift(`index ${name} drift blocks`, change, "Index definition differs");
  test("index column order is significant", () => {
    const expected = fixture(); const live = fixture();
    expected.indexes[0]!.terms = ["connector_id", "target"];
    live.indexes[0]!.terms = ["target", "connector_id"];
    assert.match(compareTables([expected], [live]).errors.join("\n"), /Index definition differs/);
  });
  drift("missing foreign key blocks", (t) => { t.foreignKeys = []; }, "Foreign key definition missing");
  for (const [name, change] of [
    ["target namespace", (t: TableDefinition) => { t.foreignKeys[0]!.target = "public.integration_connectors"; }],
    ["target column", (t: TableDefinition) => { t.foreignKeys[0]!.targetColumns = ["other_id"]; }],
    ["source column", (t: TableDefinition) => { t.foreignKeys[0]!.columns = ["id"]; }],
    ["delete action", (t: TableDefinition) => { t.foreignKeys[0]!.onDelete = "no action"; }],
    ["update action", (t: TableDefinition) => { t.foreignKeys[0]!.onUpdate = "cascade"; }],
    ["match type", (t: TableDefinition) => { t.foreignKeys[0]!.match = "full"; }],
    ["deferrability", (t: TableDefinition) => { t.foreignKeys[0]!.deferrable = true; }],
    ["initially deferred", (t: TableDefinition) => { t.foreignKeys[0]!.initiallyDeferred = true; }],
    ["validation", (t: TableDefinition) => { t.foreignKeys[0]!.validated = false; }],
  ] as const) drift(`foreign-key ${name} drift blocks`, change, "Foreign key definition differs");
  test("renamed foreign key with changed action still blocks", () => {
    const live = fixture(); live.foreignKeys[0]!.name = "legacy_fk"; live.foreignKeys[0]!.onDelete = "restrict";
    assert.match(compareTables([fixture()], [live]).errors.join("\n"), /Foreign key definition missing.*legacy_fk/);
  });
  test("truncated UTF-8 names and renamed indexes are non-fatal", () => {
    const expected = fixture(); const live = fixture();
    expected.indexes[0]!.name = "é".repeat(40);
    live.indexes[0]!.name = postgresIdentifier(expected.indexes[0]!.name);
    assert.equal(Buffer.byteLength(live.indexes[0]!.name), 62);
    assert.deepEqual(compareTables([expected], [live]), { errors: [], warnings: [] });
    live.indexes[0]!.name = "legacy_idx";
    assert.deepEqual(compareTables([expected], [live]), { errors: [], warnings: [] });
  });
  test("undeclared live connector index and constraints warn, are preserved, and do not block", () => {
    const live = fixture();
    live.indexes.push({ ...live.indexes[0]!, name: "connector_field_mappings_live_target_idx", terms: ["connector_id", "target"], unique: true });
    live.foreignKeys.push({ ...live.foreignKeys[0]!, name: "extra_fk", columns: ["id"] });
    live.columns.push({ name: "legacy", type: "text", notNull: false, default: null });
    const before = structuredClone(live);
    const report = compareTables([fixture()], [live]);
    assert.deepEqual(report.errors, []);
    assert.equal(report.warnings.length, 3);
    assert.match(report.warnings.join("\n"), /connector_field_mappings_live_target_idx.*Preserve it/);
    assert.deepEqual(live, before);
  });
  test("same index names in different schemas cannot mask missing definitions", () => {
    const a = fixture(); const b = fixture(); b.schema = "public";
    const live = structuredClone([a, b]); live[0]!.indexes = [];
    assert.equal(compareTables([a, b], live).errors.length, 1);
  });
  test("Drizzle extraction includes SQL/literal defaults, qualified enums and PK/unique/FK/index definitions", () => {
    const s = pgSchema("fixture");
    const state = s.enum("state", ["draft", "approved"]);
    const parent = s.table("parent", { id: uuid("id").primaryKey() });
    const child = s.table("child", {
      id: uuid("id").defaultRandom(), parent: uuid("parent_id").references(() => parent.id, { onDelete: "cascade" }),
      status: state("status").default("draft"), payload: jsonb("payload").default({}),
      count: integer("count").default(0), enabled: boolean("enabled").default(false),
      created: timestamp("created", { withTimezone: true }).defaultNow(),
      label: varchar("label", { length: 20 }).unique(),
    }, (t) => [
      primaryKey({ columns: [t.id, t.parent] }), unique("child_pair_unique").on(t.status, t.parent).nullsNotDistinct(),
      uniqueIndex("child_idx").on(t.parent.desc().nullsLast()).where(sql`${t.status} = 'draft'`),
      index("child_expression").on(sql`lower(${t.label})`),
      foreignKey({ columns: [t.parent], foreignColumns: [parent.id], name: "child_named_fk" }),
    ]);
    const tables = drizzleTables({ child, alias: child, parent });
    assert.equal(tables.length, 2);
    const table = tables.find((t) => t.name === "child")!;
    assert.equal(table.columns.find((c) => c.name === "status")!.type, '"fixture"."state"');
    assert.equal(normalizeDefault(table.columns.find((c) => c.name === "payload")!.default, "jsonb"), canonicalJsonb("{}"));
    assert.equal(table.indexes.length, 5);
    assert.equal(table.foreignKeys.length, 2);
    assert(table.indexes.some((i) => i.primary && i.terms.length === 2));
    assert(table.columns.find((c) => c.name === "parent_id")!.notNull, "Composite primary keys imply NOT NULL in PostgreSQL");
    assert(table.indexes.some((i) => i.nullsNotDistinct));
    assert(table.indexes.some((i) => i.terms[0]!.includes("desc nulls last")));
  });
  // A minimal catalog-shaped result also checks the query adapter without connecting.
  const catalogTable = fixture();
  let calls = 0;
  const catalog = await readTables(async <T>(query: string): Promise<T[]> => {
    calls++;
    assert.match(query.trim(), /^SELECT/);
    if (query.includes("FROM pg_attribute a")) return catalogTable.columns.map((c) => ({ schema: catalogTable.schema, table: catalogTable.name, ...c })) as T[];
    if (query.includes("FROM pg_index i")) return catalogTable.indexes.map((i) => ({ schema: catalogTable.schema, table: catalogTable.name, ...i, options: [0] })) as T[];
    if (query.includes("FROM pg_constraint con")) {
      assert.match(query, /a\.attname::text/); // name[] is not decoded as text[] by pg.
      return catalogTable.foreignKeys.map((f) => ({ schema: catalogTable.schema, table: catalogTable.name, ...f })) as T[];
    }
    return [{ schema: catalogTable.schema, name: catalogTable.name }] as T[];
  }, ["shared"]);
  test("read-only catalog adapter reconstructs a table with text-array foreign-key columns", () => {
    assert.equal(calls, 4);
    assert.deepEqual(compareTables([catalogTable], catalog), { errors: [], warnings: [] });
  });
  const orderedCatalog = await readTables(async <T>(query: string): Promise<T[]> => {
    if (query.includes("FROM pg_attribute a")) return catalogTable.columns.map((c) => ({ schema: catalogTable.schema, table: catalogTable.name, ...c })) as T[];
    if (query.includes("FROM pg_index i")) return catalogTable.indexes.map((i) => ({ schema: catalogTable.schema, table: catalogTable.name, ...i, terms: ["connector_id"], options: [1] })) as T[];
    if (query.includes("FROM pg_constraint con")) return catalogTable.foreignKeys.map((f) => ({ schema: catalogTable.schema, table: catalogTable.name, ...f })) as T[];
    return [{ schema: catalogTable.schema, name: catalogTable.name }] as T[];
  }, ["shared"]);
  test("btree ordering comes from catalog flags even when per-column deparser omits it", () => {
    assert.equal(orderedCatalog[0]!.indexes[0]!.terms[0], "connector_id desc nulls last");
    assert.match(compareTables([catalogTable], orderedCatalog).errors.join("\n"), /Index definition differs/);
  });
  console.log(`All ${cases} semantic drift fixtures pass.`);
}