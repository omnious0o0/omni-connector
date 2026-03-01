import assert from "node:assert/strict";
import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runCli(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): SpawnSyncReturns<string> {
  const tsxCliPath = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const cliPath = path.join(process.cwd(), "src", "cli.ts");
  return spawnSync(process.execPath, [tsxCliPath, cliPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function combinedOutput(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

test("--update requires checksum when using a custom installer script URL", () => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-cli-update-test-"));
  const isolatedHome = path.join(workingDirectory, "home");
  fs.mkdirSync(isolatedHome, { recursive: true });

  try {
    const result = runCli(["--update"], {
      cwd: workingDirectory,
      env: {
        HOME: isolatedHome,
        OMNI_CONNECTOR_INSTALL_SCRIPT_URL: "https://example.com/custom-install.sh",
      },
    });

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(result.signal, null);

    const output = combinedOutput(result);
    assert.match(
      output,
      /custom OMNI_CONNECTOR_INSTALL_SCRIPT_URL requires OMNI_CONNECTOR_INSTALL_SCRIPT_SHA256/i,
    );
    assert.match(output, /Update failed/i);
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("OMNI_CONNECTOR_SKIP_LOCAL_ENV=1 ignores .env DATA_FILE override during init", () => {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-cli-env-test-"));
  const isolatedHome = path.join(workingDirectory, "home");
  const dotenvDataFilePath = path.join(workingDirectory, "runtime-from-dotenv", "store.json");
  const defaultDataFilePath = path.join(isolatedHome, ".omni-connector", "data", "store.json");
  const publicDirPath = path.join(process.cwd(), "public");
  const sessionSecret = "this-is-a-very-strong-session-secret-for-cli-tests";

  fs.mkdirSync(isolatedHome, { recursive: true });
  fs.writeFileSync(path.join(workingDirectory, ".env"), `DATA_FILE=${dotenvDataFilePath}\n`, "utf8");

  const baseEnv: NodeJS.ProcessEnv = {
    HOME: isolatedHome,
    SESSION_SECRET: sessionSecret,
    PUBLIC_DIR: publicDirPath,
    DATA_FILE: undefined,
    SESSION_SECRET_FILE: undefined,
  };

  try {
    const withoutSkip = runCli(["--init-only"], {
      cwd: workingDirectory,
      env: {
        ...baseEnv,
        OMNI_CONNECTOR_SKIP_LOCAL_ENV: "0",
      },
    });

    assert.equal(withoutSkip.error, undefined);
    assert.equal(withoutSkip.status, 0);
    assert.equal(withoutSkip.signal, null);
    assert.match(withoutSkip.stdout ?? "", new RegExp(`Initialized omni-connector runtime at ${dotenvDataFilePath}`));
    assert.equal(fs.existsSync(dotenvDataFilePath), true);

    fs.rmSync(path.dirname(dotenvDataFilePath), { recursive: true, force: true });
    fs.rmSync(path.join(isolatedHome, ".omni-connector"), { recursive: true, force: true });

    const withSkip = runCli(["--init-only"], {
      cwd: workingDirectory,
      env: {
        ...baseEnv,
        OMNI_CONNECTOR_SKIP_LOCAL_ENV: "1",
      },
    });

    assert.equal(withSkip.error, undefined);
    assert.equal(withSkip.status, 0);
    assert.equal(withSkip.signal, null);
    assert.match(withSkip.stdout ?? "", new RegExp(`Initialized omni-connector runtime at ${defaultDataFilePath}`));
    assert.equal(fs.existsSync(defaultDataFilePath), true);
    assert.equal(fs.existsSync(dotenvDataFilePath), false);
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
});
