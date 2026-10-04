import { assertDevelopment, applySafePlan } from "./push-safety";

try {
  assertDevelopment(process.env, process.argv.slice(2));
  // Load the connection only after rejecting production/override attempts.
  const { pushSchema } = await import("drizzle-kit/api");
  const { sql } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { pool } = await import("../src/index");
  const schema = await import("../src/schema");
  const { managedSchemas } = await import("../src/managed-schemas");
  try {
    // The kit API expects a schema-less database; relational configuration is
    // unnecessary here because the source schema is passed separately.
    const db = drizzle(pool);
    const plan = await pushSchema(schema, db, managedSchemas);
    console.log(`Development push: ${plan.statementsToExecute.length} statement(s) across ${managedSchemas.join(", ")}.`);
    const applied = await applySafePlan(plan, (statement) => db.execute(sql.raw(statement)));
    console.log(applied ? `${applied} additive development schema change(s) applied.` : "No additive development schema changes detected.");
  } finally {
    await pool.end();
  }
} catch (error) {
  // Avoid dumping connection objects or credentials in unattended merge logs.
  console.error(`ERROR: Development schema push failed: ${error instanceof Error ? error.message : "unknown error"}`);
  console.error("Do not Publish until development push and check-drift both pass.");
  process.exitCode = 1;
}