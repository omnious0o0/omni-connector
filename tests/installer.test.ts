import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readInstallerScript(): string {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  return fs.readFileSync(installerPath, "utf8");
}

test("installer persists PATH entries with idempotent shell guards", () => {
  const script = readInstallerScript();

  const exportLine = script.split("\n").find((line) => line.includes("export_line="));
  assert.equal(typeof exportLine === "string", true);
  assert.equal((exportLine ?? "").includes("case "), true);
  assert.equal((exportLine ?? "").includes("${path_entry}"), true);
  assert.equal((exportLine ?? "").includes("\\$PATH"), true);
  assert.equal((exportLine ?? "").includes("export PATH="), true);
  assert.equal((exportLine ?? "").includes("esac"), true);

  const fishLine = script.split("\n").find((line) => line.includes("fish_line="));
  assert.equal(typeof fishLine === "string", true);
  assert.equal((fishLine ?? "").includes("contains --"), true);
  assert.equal((fishLine ?? "").includes("or set -gx PATH"), true);
  assert.equal((fishLine ?? "").includes("${path_entry}"), true);
  assert.equal((fishLine ?? "").includes("\\$PATH"), true);
});

test("shell auto-update fallback records last-run epoch only after a successful update", () => {
  const script = readInstallerScript();

  const updateRunnerCallIndex = script.indexOf('if "${update_runner_path}" >>"${log_file}" 2>&1; then');
  const writeEpochIndex = script.indexOf('printf "%s" "${current_epoch}" >"${last_run_file}"');
  const failureLogIndex = script.indexOf('Auto-update failed\\n');

  assert.equal(updateRunnerCallIndex >= 0, true);
  assert.equal(writeEpochIndex > updateRunnerCallIndex, true);
  assert.equal(failureLogIndex > writeEpochIndex, true);
  assert.equal(
    script.includes('printf "%s" "${current_epoch}" >"${last_run_file}"\nif ! "${update_runner_path}" >>"${log_file}" 2>&1; then'),
    false,
  );
});
