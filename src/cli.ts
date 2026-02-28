#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { resolveConfig } from "./config";

const KNOWN_FLAGS = new Set(["--help", "-h", "--version", "-v", "--init-only"]);

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
    env.PORT = "1455";
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
      "  omni-connector [--init-only]",
      "",
      "Options:",
      "  --init-only   Initialize runtime files and exit",
      "  --version     Print installed version",
      "  --help        Show this help text",
      "",
      "Environment defaults when unset:",
      "  HOST=127.0.0.1",
      "  ALLOW_REMOTE_DASHBOARD=false",
      "  TRUST_PROXY_HOPS=0",
      "  PORT=1455",
      "  DATA_FILE=~/.omni-connector/data/store.json",
      "  SESSION_SECRET_FILE=~/.omni-connector/data/store.json.session",
      "  SESSION_STORE=memorystore",
      "  PUBLIC_DIR=<installed package>/public",
      "",
    ].join("\n"),
  );
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

export function runCli(argv: string[]): void {
  assertKnownFlags(argv);

  const packageRoot = packageRootFromRuntime();
  loadLocalEnv(process.env, process.cwd());

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${readPackageVersion(packageRoot)}\n`);
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
