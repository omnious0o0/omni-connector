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

  assert.ok(geminiCli);
  assert.ok(geminiAntigravity);

  assert.equal(geminiCli?.tokenUrl, "https://oauth2.googleapis.com/token");
  assert.equal(geminiAntigravity?.tokenUrl, "https://oauth2.googleapis.com/token");
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

test("defaults data file path to home runtime directory when DATA_FILE is unset", () => {
  const config = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  assert.equal(config.dataFilePath, path.join(os.homedir(), ".omni-connector", "data", "store.json"));
});

test("requires loopback OAuth redirect URI when remote dashboard is disabled", () => {
  assert.throws(
    () =>
      resolveConfig({
        HOST: "127.0.0.1",
        PORT: "1455",
        SESSION_SECRET: "test-session-secret",
        PUBLIC_DIR: path.join(process.cwd(), "public"),
        OAUTH_REDIRECT_URI: "https://example.com/auth/callback",
      }),
    /OAUTH_REDIRECT_URI must use a loopback host unless ALLOW_REMOTE_DASHBOARD=true/,
  );
});

test("requires HTTPS OAuth redirect URI for remote non-loopback hosts", () => {
  assert.throws(
    () =>
      resolveConfig({
        HOST: "0.0.0.0",
        ALLOW_REMOTE_DASHBOARD: "true",
        PORT: "1455",
        SESSION_SECRET: "test-session-secret",
        PUBLIC_DIR: path.join(process.cwd(), "public"),
        OAUTH_REDIRECT_URI: "http://example.com/auth/callback",
      }),
    /OAUTH_REDIRECT_URI must use HTTPS for non-loopback hosts/,
  );

  const config = resolveConfig({
    HOST: "0.0.0.0",
    ALLOW_REMOTE_DASHBOARD: "true",
    PORT: "1455",
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
    OAUTH_REDIRECT_URI: "https://example.com/auth/callback",
  });

  assert.equal(config.oauthRedirectUri, "https://example.com/auth/callback");
});
