import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveConfig } from "../src/config";

test("auto-manages session secret via file when env secret is absent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-test-"));

  try {
    const dataFilePath = path.join(directory, "store.json");
    const env: NodeJS.ProcessEnv = {
      DATA_FILE: dataFilePath,
      NODE_ENV: "production",
    };

    const firstConfig = resolveConfig(env);
    const sessionSecretFilePath = `${dataFilePath}.session`;
    assert.ok(fs.existsSync(sessionSecretFilePath));

    const persistedSecret = fs.readFileSync(sessionSecretFilePath, "utf8").trim();
    assert.ok(persistedSecret.length > 30);
    assert.equal(firstConfig.sessionSecret, persistedSecret);

    const mode = fs.statSync(sessionSecretFilePath).mode & 0o777;
    assert.equal(mode, 0o600);

    const secondConfig = resolveConfig(env);
    assert.equal(secondConfig.sessionSecret, persistedSecret);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
