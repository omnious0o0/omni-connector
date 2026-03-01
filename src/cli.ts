#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createApp } from "./app";
import { DEFAULT_PORT, resolveConfig } from "./config";

const KNOWN_FLAGS = new Set(["--help", "-h", "--version", "-v", "--init-only", "--update", "--upd"]);

function packageRootFromRuntime(): string {
  return path.resolve(__dirname, "..", "..");
}

function readPackageVersion(packageRoot: string): string {
  const packagePath = path.join(packageRoot, "package.json");
  try {
    const raw = fs.readFileSync(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version;
    }
  } catch {
    return "0.0.0";
  }

  return "0.0.0";
}

function applyCliDefaults(env: NodeJS.ProcessEnv, packageRoot: string): void {
  const runtimeRoot = path.join(os.homedir(), ".omni-connector");
  const defaultDataFile = path.join(runtimeRoot, "data", "store.json");

  if (!env.HOST) {
    env.HOST = "127.0.0.1";
  }

  if (!env.PORT) {
    env.PORT = String(DEFAULT_PORT);
  }

  if (!env.DATA_FILE) {
    env.DATA_FILE = defaultDataFile;
  }

  if (!env.SESSION_SECRET_FILE) {
    env.SESSION_SECRET_FILE = `${env.DATA_FILE}.session`;
  }

  if (!env.PUBLIC_DIR) {
    env.PUBLIC_DIR = path.join(packageRoot, "public");
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "omni-connector",
      "",
      "Usage:",
      "  omni-connector [--init-only|--update|--upd]",
      "",
      "Options:",
      "  --init-only   Initialize runtime files and exit",
      "  --update      Update omni-connector to latest installer release",
      "  --upd         Shortcut for --update",
      "  --version     Print installed version",
      "  --help        Show this help text",
      "",
      "Environment defaults when unset:",
      "  HOST=127.0.0.1",
      "  ALLOW_REMOTE_DASHBOARD=false",
      "  TRUST_PROXY_HOPS=0",
      `  PORT=${DEFAULT_PORT}`,
      "  DATA_FILE=~/.omni-connector/data/store.json",
      "  SESSION_SECRET_FILE=~/.omni-connector/data/store.json.session",
      "  SESSION_STORE=memorystore",
      "  PUBLIC_DIR=<installed package>/public",
      "",
    ].join("\n"),
  );
}

function runSelfUpdate(): void {
  const repo = process.env.OMNI_CONNECTOR_REPO || "omnious0o0/omni-connector";
  const ref = process.env.OMNI_CONNECTOR_REF || "main";
  const installScriptUrl =
    process.env.OMNI_CONNECTOR_INSTALL_SCRIPT_URL || `https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh`;
  const installScriptSha256 = process.env.OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256 || "";
  const updateEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OMNI_CONNECTOR_REPO: repo,
    OMNI_CONNECTOR_REF: ref,
    OMNI_CONNECTOR_INSTALL_SCRIPT_URL: installScriptUrl,
    OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256: installScriptSha256,
    OMNI_CONNECTOR_AUTO_START: "0",
    OMNI_CONNECTOR_AUTO_OPEN_BROWSER: "0",
    OMNI_CONNECTOR_SKIP_LOCAL_ENV: "1",
  };

  const updateRunnerPath = path.join(os.homedir(), ".omni-connector", "install", "update.sh");
  if (fs.existsSync(updateRunnerPath)) {
    const localRunnerResult = spawnSync("bash", [updateRunnerPath], {
      stdio: "inherit",
      env: updateEnv,
      cwd: os.homedir(),
    });

    if ((localRunnerResult.status ?? 1) === 0) {
      return;
    }

    process.stderr.write("Local updater failed, retrying with a fresh installer download...\n");
  }

  const updateScript = [
    "set -euo pipefail",
    "tmp_file=\"$(mktemp)\"",
    "cleanup(){ rm -f \"${tmp_file}\"; }",
    "trap cleanup EXIT",
    "default_install_script_url=\"https://raw.githubusercontent.com/${OMNI_CONNECTOR_REPO}/${OMNI_CONNECTOR_REF}/scripts/install.sh\"",
    "if [ \"${OMNI_CONNECTOR_INSTALL_SCRIPT_URL}\" != \"${default_install_script_url}\" ] && [ -z \"${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256:-}\" ]; then",
    "  printf 'custom OMNI_CONNECTOR_INSTALL_SCRIPT_URL requires OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256\\n' >&2",
    "  exit 1",
    "fi",
    "if command -v curl >/dev/null 2>&1; then",
    "  curl -fsSL -o \"${tmp_file}\" \"${OMNI_CONNECTOR_INSTALL_SCRIPT_URL}\"",
    "elif command -v wget >/dev/null 2>&1; then",
    "  wget -qO \"${tmp_file}\" \"${OMNI_CONNECTOR_INSTALL_SCRIPT_URL}\"",
    "else",
    "  printf 'Update requires curl or wget in PATH\\n' >&2",
    "  exit 1",
    "fi",
    "if [ -n \"${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256:-}\" ]; then",
    "  expected_checksum=\"$(printf '%s' \"${OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256}\" | tr '[:upper:]' '[:lower:]')\"",
    "  if ! printf '%s' \"${expected_checksum}\" | grep -Eq '^[0-9a-f]{64}$'; then",
    "    printf 'OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256 must be a 64-character hex string\\n' >&2",
    "    exit 1",
    "  fi",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    actual_checksum=\"$(sha256sum \"${tmp_file}\" | awk '{print $1}')\"",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    actual_checksum=\"$(shasum -a 256 \"${tmp_file}\" | awk '{print $1}')\"",
    "  elif command -v openssl >/dev/null 2>&1; then",
    "    actual_checksum=\"$(openssl dgst -sha256 \"${tmp_file}\" | awk '{print $2}')\"",
    "  else",
    "    printf 'Checksum verification requires sha256sum, shasum, or openssl\\n' >&2",
    "    exit 1",
    "  fi",
    "  if [ \"${actual_checksum}\" != \"${expected_checksum}\" ]; then",
    "    printf 'Installer checksum mismatch\\n' >&2",
    "    printf 'Expected: %s\\n' \"${expected_checksum}\" >&2",
    "    printf 'Actual:   %s\\n' \"${actual_checksum}\" >&2",
    "    exit 1",
    "  fi",
    "fi",
    "OMNI_CONNECTOR_SKIP_LOCAL_ENV=1 bash \"${tmp_file}\"",
  ].join("\n");

  const result = spawnSync("bash", ["-lc", updateScript], {
    stdio: "inherit",
    env: updateEnv,
    cwd: os.homedir(),
  });

  if ((result.status ?? 1) !== 0) {
    const statusSuffix = typeof result.status === "number" ? ` (exit ${result.status})` : "";
    const signalSuffix = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(`Update failed${statusSuffix}${signalSuffix}`);
  }
}

function assertKnownFlags(argv: string[]): void {
  const unknown = argv.filter((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  }
}

function assertPublicDir(publicDirPath: string): void {
  if (!fs.existsSync(publicDirPath)) {
    throw new Error(`PUBLIC_DIR does not exist: ${publicDirPath}`);
  }

  const stat = fs.statSync(publicDirPath);
  if (!stat.isDirectory()) {
    throw new Error(`PUBLIC_DIR is not a directory: ${publicDirPath}`);
  }
}

function parseDotEnvValue(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return "";
  }

  const quote = trimmedValue[0];
  const isQuoted =
    (quote === '"' || quote === "'") && trimmedValue.length >= 2 && trimmedValue[trimmedValue.length - 1] === quote;

  if (!isQuoted) {
    return trimmedValue.replace(/\s+#.*$/, "").trimEnd();
  }

  const inner = trimmedValue.slice(1, -1);
  if (quote === "'") {
    return inner;
  }

  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const match = normalizedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const variableName = match[1];
    const variableValue = match[2] ?? "";
    if (!variableName) {
      continue;
    }
    if (typeof env[variableName] !== "undefined") {
      continue;
    }

    env[variableName] = parseDotEnvValue(variableValue);
  }
}

function loadLocalEnv(env: NodeJS.ProcessEnv, baseDirectory: string): void {
  loadEnvFile(path.join(baseDirectory, ".env"), env);
  loadEnvFile(path.join(baseDirectory, ".env.local"), env);
}

function shouldSkipLocalEnv(env: NodeJS.ProcessEnv): boolean {
  return env.OMNI_CONNECTOR_SKIP_LOCAL_ENV === "1";
}

export function runCli(argv: string[]): void {
  assertKnownFlags(argv);

  const packageRoot = packageRootFromRuntime();
  if (!shouldSkipLocalEnv(process.env)) {
    loadLocalEnv(process.env, process.cwd());
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${readPackageVersion(packageRoot)}\n`);
    return;
  }

  if (argv.includes("--update") || argv.includes("--upd")) {
    runSelfUpdate();
    return;
  }

  applyCliDefaults(process.env, packageRoot);
  const config = resolveConfig(process.env);
  assertPublicDir(config.publicDir);

  if (argv.includes("--init-only")) {
    createApp(config);
    process.stdout.write(`Initialized omni-connector runtime at ${config.dataFilePath}\n`);
    return;
  }

  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    process.stdout.write(`omni-connector running at http://${config.host}:${config.port}\n`);
  });
}

if (require.main === module) {
  runCli(process.argv.slice(2));
}
