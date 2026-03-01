import assert from "node:assert/strict";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function readInstallerScript(): string {
  const installerPath = path.join(process.cwd(), "scripts", "install.sh");
  return fs.readFileSync(installerPath, "utf8");
}

function readUnixEntrypointInstallerScript(): string {
  const installerPath = path.join(process.cwd(), "install.sh");
  return fs.readFileSync(installerPath, "utf8");
}

function readWindowsEntrypointInstallerScript(): string {
  const installerPath = path.join(process.cwd(), "install.ps1");
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

function fileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sidecarSha256(filePath: string): string {
  const checksumPath = `${filePath}.sha256`;
  const line = fs.readFileSync(checksumPath, "utf8").split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? "";
  return (line.trim().split(/\s+/)[0] ?? "").toLowerCase();
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

test("installer stage progress line uses compact width and prefixes phase counter", () => {
  const script = readInstallerScript();

  assert.equal(script.includes("STAGE_BAR_WIDTH=24"), true);
  assert.equal(script.includes("STAGE_BAR_WIDTH=34"), false);
  assert.equal(script.includes("resolve_stage_bar_width()"), true);
  assert.equal(script.includes('bar_width="$(resolve_stage_bar_width)"'), true);
  assert.equal(script.includes('local bar_width="$2"'), true);
  assert.equal(script.includes('render_stage_bar "${completed}" "${bar_width}"'), true);

  const stageLineFormat = script
    .split("\n")
    .find((line) => line.includes('printf "%b[%s]%b %b%3d%%%b'));
  assert.equal(typeof stageLineFormat === "string", true);
  assert.equal((stageLineFormat ?? "").includes("%b(%d/%d)%b  %s"), true);
  assert.equal((stageLineFormat ?? "").includes("%s  %b(%d/%d)%b"), false);
});

test("unix installer entrypoint is POSIX and enforces secure payload fetch", () => {
  const script = readUnixEntrypointInstallerScript();

  assert.equal(script.startsWith("#!/bin/sh\n"), true);
  assert.equal(script.includes("default_install_script_url=\"https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh\""), true);
  assert.equal(script.includes('case "${install_script_url}" in'), true);
  assert.equal(script.includes('case "${install_script_checksum_url}" in'), true);
  assert.equal(script.includes('https://*) ;;'), true);
  assert.equal(
    script.includes(
      "custom OMNI_CONNECTOR_INSTALL_SCRIPT_URL requires OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256 or OMNI_CONNECTOR_INSTALL_SCRIPT_CHECKSUM_URL",
    ),
    true,
  );
  assert.equal(script.includes("curl -fsSL -o"), true);
  assert.equal(script.includes("wget -qO"), true);
  assert.equal(script.includes("install_script_checksum_url"), true);
  assert.equal(script.includes("ensure_bash()"), true);
  assert.equal(script.includes("bash is required to run the omni-connector installer payload."), true);
  assert.equal(script.includes("failed to install bash automatically"), true);
  assert.equal(script.includes("exec env"), true);
  assert.equal(script.includes('bash "${tmp_file}" "$@"'), true);
});

test("windows installer entrypoint validates archive and initializes runtime", () => {
  const script = readWindowsEntrypointInstallerScript();

  assert.equal(script.includes("#Requires -Version 5.1"), true);
  assert.equal(
    script.includes("custom OMNI_CONNECTOR_ARCHIVE_URL requires OMNI_CONNECTOR_ARCHIVE_SHA256"),
    true,
  );
  assert.equal(script.includes("Invoke-WebRequest"), true);
  assert.equal(script.includes("Get-FileHash"), true);
  assert.equal(script.includes("npm install -g --ignore-scripts"), true);
  assert.equal(script.includes("--init-only"), true);
});

test("installer checksum sidecars match installer script contents", () => {
  const unixEntrypoint = path.join(process.cwd(), "install.sh");
  const windowsEntrypoint = path.join(process.cwd(), "install.ps1");
  const payloadInstaller = path.join(process.cwd(), "scripts", "install.sh");

  assert.equal(sidecarSha256(unixEntrypoint), fileSha256(unixEntrypoint));
  assert.equal(sidecarSha256(windowsEntrypoint), fileSha256(windowsEntrypoint));
  assert.equal(sidecarSha256(payloadInstaller), fileSha256(payloadInstaller));
});
