import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression test for the drift guard's production-schema.sql parsing. Proves
 * the check exits 1 when a column or enum label goes missing from the SQL file —
 * including the scoped-matching case where the label still exists on OTHER enums
 * (which naive global substring matching would silently pass).
 *
 *   pnpm --filter @workspace/scripts run test-drift-guard
 */

const here = dirname(fileURLToPath(import.meta.url));
const prod = readFileSync(join(here, "../production-schema.sql"), "utf8");

function runCheck(sqlText: string): { status: number; output: string } {
  const file = join(mkdtempSync(join(tmpdir(), "drift-guard-")), "schema.sql");
  writeFileSync(file, sqlText);
  const res = spawnSync("pnpm", ["exec", "tsx", "src/check-schema-drift.ts", file], {
    cwd: join(here, ".."), encoding: "utf8",
  });
  return { status: res.status ?? 1, output: `${res.stdout}\n${res.stderr}` };
}

function expectCase(name: string, sqlText: string, expectedStatus: number, expectInOutput?: string) {
  const { status, output } = runCheck(sqlText);
  if (status !== expectedStatus || (expectInOutput && !output.includes(expectInOutput))) {
    console.error(`FAIL: ${name} — expected exit ${expectedStatus}, got ${status}`);
    console.error(output.slice(-2000));
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

// 1. The real file must pass.
expectCase("untampered production-schema.sql passes", prod, 0);

// 2. Removing a migration-appended column must fail.
const noColumn = prod.split("\n")
  .filter((line) => !(line.includes('"qaqc_metric_entries"') && line.includes("ADD COLUMN") && line.includes('"approver_id"')))
  .join("\n");
if (noColumn === prod) { console.error("FAIL: column tamper did not change the file"); process.exit(1); }
expectCase("removed approver_id column detected", noColumn, 1, "qaqc_metric_entries.approver_id");

// 3. Removing 'email' from ONE enum must fail even though 'email' remains on the
//    other two notification_channel enums (scoped, not global, matching).
const noLabel = prod.replace(
  `CREATE TYPE "app1_qaqc"."notification_channel" AS ENUM('in_app', 'email')`,
  `CREATE TYPE "app1_qaqc"."notification_channel" AS ENUM('in_app')`,
);
if (noLabel === prod) { console.error("FAIL: label tamper did not change the file"); process.exit(1); }
expectCase("label removed from one enum detected despite others keeping it", noLabel, 1, "'email' on app1_qaqc.notification_channel");

console.log("All drift-guard regressions pass.");
process.exit(0);
