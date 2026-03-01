import assert from "node:assert/strict";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function readInstallerScript(): string {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  return fs.readFileSync(installerPath, "utf8");
}

function runInstallerDryRun(envOverrides: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "omni-installer-dry-run-"));

  try {
    return spawnSync("bash", [installerPath], {
      encoding: "utf8",
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: isolatedHome,
        OMNI_CONNECTOR_INSTALLER_DRY_RUN: "1",
        OMNI_CONNECTOR_AUTO_START: "0",
        ...envOverrides,
      },
    });
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

function combinedOutput(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function extractPlannedInstallerPhases(output: string): number {
  const phaseMatch = output.match(/Planned installer phases:\s*(\d+)/);
  assert.notEqual(phaseMatch, null);

  if (!phaseMatch) {
    return Number.NaN;
  }

  const parsed = Number.parseInt(phaseMatch[1] ?? "", 10);
  assert.equal(Number.isFinite(parsed), true);
  return parsed;
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

test("installer dry-run phase count stays consistent between source and global-target flows", () => {
  const sourceInstallResult = runInstallerDryRun();
  assert.equal(sourceInstallResult.error, undefined);
  assert.equal(sourceInstallResult.status, 0);
  assert.equal(sourceInstallResult.signal, null);

  const sourcePhaseCount = extractPlannedInstallerPhases(combinedOutput(sourceInstallResult));
  assert.equal(sourcePhaseCount, 5);

  const globalTargetResult = runInstallerDryRun({
    OMNI_CONNECTOR_INSTALL_TARGET: "omni-connector@latest",
  });
  assert.equal(globalTargetResult.error, undefined);
  assert.equal(globalTargetResult.status, 0);
  assert.equal(globalTargetResult.signal, null);

  const globalTargetPhaseCount = extractPlannedInstallerPhases(combinedOutput(globalTargetResult));
  assert.equal(globalTargetPhaseCount, 5);
});

test("installer dry-run adds exactly one phase when auto-start is enabled", () => {
  const withAutoStartResult = runInstallerDryRun({
    OMNI_CONNECTOR_AUTO_START: "1",
  });
  assert.equal(withAutoStartResult.error, undefined);
  assert.equal(withAutoStartResult.status, 0);
  assert.equal(withAutoStartResult.signal, null);

  const phaseCount = extractPlannedInstallerPhases(combinedOutput(withAutoStartResult));
  assert.equal(phaseCount, 6);
});

test("installer download steps use spinner-friendly quiet transfer flags", () => {
  const script = readInstallerScript();

  assert.equal(script.includes("curl -fsSL"), true);
  assert.equal(script.includes("wget -q -O"), true);
  assert.equal(script.includes("curl --progress-bar"), false);
  assert.equal(script.includes("wget --progress=bar:force:noscroll"), false);
  assert.equal(script.includes('run_with_spinner "Downloading source archive" download_file'), true);
  assert.equal(script.includes('run_with_spinner "Downloading nvm installer" download_file'), true);
});
