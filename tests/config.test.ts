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

test("uses provider OAuth defaults compatible with live token endpoints", () => {
  const config = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), "omni-config-defaults-store.json"),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const geminiCli = config.oauthProfiles.gemini.find((profile) => profile.id === "gemini-cli");
  const geminiAntigravity = config.oauthProfiles.gemini.find((profile) => profile.id === "antigravity");
  const claudeProfile = config.oauthProfiles.claude.find((profile) => profile.id === "claude-code");

  assert.ok(geminiCli);
  assert.ok(geminiAntigravity);
  assert.ok(claudeProfile);

  assert.equal(geminiCli?.tokenUrl, "https://oauth2.googleapis.com/token");
  assert.equal(geminiAntigravity?.tokenUrl, "https://oauth2.googleapis.com/token");
  assert.equal(claudeProfile?.tokenUrl, "https://console.anthropic.com/v1/oauth/token");
});

test("auto-discovers Gemini OAuth client credentials from installed CLI bundle", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-gemini-discovery-test-"));

  try {
    const fakeBinDirectory = path.join(directory, "bin");
    fs.mkdirSync(fakeBinDirectory, { recursive: true });
    const fakeGeminiExecutablePath = path.join(fakeBinDirectory, "gemini");
    fs.writeFileSync(fakeGeminiExecutablePath, "#!/usr/bin/env bash\nexit 0\n", {
      encoding: "utf8",
      mode: 0o755,
    });
    fs.chmodSync(fakeGeminiExecutablePath, 0o755);

    const oauthBundleDirectory = path.join(
      directory,
      "node_modules",
      "@google",
      "gemini-cli-core",
      "dist",
      "src",
      "code_assist",
    );
    fs.mkdirSync(oauthBundleDirectory, { recursive: true });

    const fakeClientId = `${"123456789012"}-${"abcdefghijklmnopqrstuv"}.${["apps", "googleusercontent", "com"].join(".")}`;
    const fakeClientSecret = `${"GOC"}${"SPX"}-${"fakeSecretToken_123"}`;
    fs.writeFileSync(
      path.join(oauthBundleDirectory, "oauth2.js"),
      `export const CLIENT_ID = "${fakeClientId}";\nexport const CLIENT_SECRET = "${fakeClientSecret}";\n`,
      "utf8",
    );

    const config = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: path.join(directory, "store.json"),
      SESSION_SECRET: "test-session-secret",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
      PATH: fakeBinDirectory,
      GEMINI_OAUTH_AUTO_DISCOVER: "true",
    });

    const geminiCli = config.oauthProfiles.gemini.find((profile) => profile.id === "gemini-cli");
    const geminiAntigravity = config.oauthProfiles.gemini.find((profile) => profile.id === "antigravity");

    assert.equal(geminiCli?.clientId, fakeClientId);
    assert.equal(geminiCli?.clientSecret, fakeClientSecret);
    assert.equal(geminiAntigravity?.clientId ?? "", "");
    assert.equal(geminiAntigravity?.clientSecret ?? "", "");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("auto-discovers Antigravity OAuth client credentials from OpenClaw bundle", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-antigravity-discovery-test-"));

  try {
    const fakeBinDirectory = path.join(directory, "bin");
    fs.mkdirSync(fakeBinDirectory, { recursive: true });
    const fakeOpenclawExecutablePath = path.join(fakeBinDirectory, "openclaw");
    fs.writeFileSync(fakeOpenclawExecutablePath, "#!/usr/bin/env bash\nexit 0\n", {
      encoding: "utf8",
      mode: 0o755,
    });
    fs.chmodSync(fakeOpenclawExecutablePath, 0o755);

    const antigravityOauthBundlePath = path.join(
      fakeBinDirectory,
      "node_modules",
      "@mariozechner",
      "pi-ai",
      "dist",
      "utils",
      "oauth",
      "google-antigravity.js",
    );
    fs.mkdirSync(path.dirname(antigravityOauthBundlePath), { recursive: true });

    const fakeClientId = `${"123456789012"}-${"abcdefghijklmnopqrstuvwxyz123456"}.${["apps", "googleusercontent", "com"].join(".")}`;
    const fakeClientSecret = `${"GOC"}${"SPX"}-fakeAntigravitySecret1234567890`;
    fs.writeFileSync(
      antigravityOauthBundlePath,
      `const decode = (s) => atob(s);\nconst CLIENT_ID = decode("${Buffer.from(fakeClientId, "utf8").toString("base64")}");\nconst CLIENT_SECRET = decode("${Buffer.from(fakeClientSecret, "utf8").toString("base64")}");\n`,
      "utf8",
    );

    const config = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: path.join(directory, "store.json"),
      SESSION_SECRET: "test-session-secret",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
      PATH: fakeBinDirectory,
      GEMINI_OAUTH_AUTO_DISCOVER: "true",
    });

    const geminiAntigravity = config.oauthProfiles.gemini.find((profile) => profile.id === "antigravity");
    assert.equal(geminiAntigravity?.clientId, fakeClientId);
    assert.equal(geminiAntigravity?.clientSecret, fakeClientSecret);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
