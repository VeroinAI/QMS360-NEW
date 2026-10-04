import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Test the real shell script without changing any database or installing packages.
const script = join(dirname(fileURLToPath(import.meta.url)), "../post-merge.sh");
for (const failedStep of ["install", "push", "check-drift", "none"]) {
  const temp = mkdtempSync(join(tmpdir(), "post-merge-test-"));
  try {
    const stub = join(temp, "pnpm");
    writeFileSync(stub, `#!/bin/bash
echo "$*" >> "$CALL_LOG"
case "$*" in
  install*) step=install ;;
  *"run push") step=push ;;
  *"run check-drift") step=check-drift ;;
  *) exit 99 ;;
esac
if [ "$step" = "$FAIL_STEP" ]; then exit 7; fi
`);
    chmodSync(stub, 0o755);
    const log = join(temp, "calls");
    const result = spawnSync("bash", [script], {
      cwd: temp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, CALL_LOG: log, FAIL_STEP: failedStep },
    });
    const calls = readFileSync(log, "utf8");
    assert.equal(result.status, failedStep === "none" ? 0 : 7);
    if (failedStep !== "none") {
      assert.match(result.stderr, /Do not Publish/);
      assert.doesNotMatch(result.stdout, /setup and drift checks passed/);
    }
    if (failedStep === "install") assert.doesNotMatch(calls, /run push/);
    if (failedStep === "install" || failedStep === "push") assert.doesNotMatch(calls, /run check-drift/);
    if (failedStep === "none") assert.match(result.stdout, /setup and drift checks passed/);
    console.log(`PASS: post-merge ${failedStep === "none" ? "success" : `${failedStep} failure`}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}