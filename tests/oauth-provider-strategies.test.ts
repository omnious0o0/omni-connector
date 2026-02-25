import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OAuthProviderProfileConfig, resolveConfig } from "../src/config";
import { HttpError } from "../src/errors";
import { buildClaudeAuthorizationCodeTokenPayload } from "../src/services/oauth-provider/claude";
import {
  buildCodexOAuthProfile,
  CODEX_OAUTH_PROFILE_ID,
  codexUsageCandidateUrls,
  extractCodexRateLimitPayload,
} from "../src/services/oauth-provider/codex";

function createProfile(overrides: Partial<OAuthProviderProfileConfig> = {}): OAuthProviderProfileConfig {
  return {
    id: "claude-code",
    label: "Claude Code",
    authorizationUrl: "https://console.anthropic.com/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    userInfoUrl: null,
    clientId: "client-id",
    clientSecret: "client-secret",
    scopes: ["org:create_api_key", "user:profile"],
    originator: null,
    extraParams: {},
    ...overrides,
  };
}

test("buildClaudeAuthorizationCodeTokenPayload builds required fields", () => {
  const payload = buildClaudeAuthorizationCodeTokenPayload(createProfile(), {
    code: "abc123",
    state: "state-token",
    redirectUri: "http://localhost:1455/auth/callback",
    codeVerifier: "verifier-token",
  });

  assert.deepEqual(payload, {
    grant_type: "authorization_code",
    client_id: "client-id",
    client_secret: "client-secret",
    code: "abc123",
    state: "state-token",
    redirect_uri: "http://localhost:1455/auth/callback",
    code_verifier: "verifier-token",
  });
});

test("buildClaudeAuthorizationCodeTokenPayload omits client secret when missing", () => {
  const payload = buildClaudeAuthorizationCodeTokenPayload(createProfile({ clientSecret: "" }), {
    code: "abc123",
    state: "state-token",
    redirectUri: "http://localhost:1455/auth/callback",
    codeVerifier: "verifier-token",
  });

  assert.equal(payload.client_secret, undefined);
});

test("buildClaudeAuthorizationCodeTokenPayload rejects missing state", () => {
  assert.throws(
    () =>
      buildClaudeAuthorizationCodeTokenPayload(createProfile(), {
        code: "abc123",
        redirectUri: "http://localhost:1455/auth/callback",
        codeVerifier: "verifier-token",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "missing_oauth_state",
  );
});

test("extractCodexRateLimitPayload reads top-level codex payload", () => {
  const payload = extractCodexRateLimitPayload({
    rateLimits: {
      primary: { used_percent: 15, limit_window_minutes: 300 },
    },
  });

  assert.deepEqual(payload, {
    result: {
      rateLimits: {
        primary: { used_percent: 15, limit_window_minutes: 300 },
      },
    },
  });
});

test("extractCodexRateLimitPayload reads nested result payload", () => {
  const payload = extractCodexRateLimitPayload({
    result: {
      rate_limits: {
        primary_window: { used_percent: 35, limit_window_minutes: 300 },
      },
    },
  });

  assert.deepEqual(payload, {
    result: {
      rateLimits: {
        primary_window: { used_percent: 35, limit_window_minutes: 300 },
      },
    },
  });
});

test("extractCodexRateLimitPayload falls back to top-level limits when result has no limits", () => {
  const payload = extractCodexRateLimitPayload({
    result: {
      ok: true,
    },
    rateLimits: {
      primary: { used_percent: 55, limit_window_minutes: 300 },
    },
  });

  assert.deepEqual(payload, {
    result: {
      rateLimits: {
        primary: { used_percent: 55, limit_window_minutes: 300 },
      },
    },
  });
});

test("extractCodexRateLimitPayload returns null when payload has no rate limits", () => {
  assert.equal(extractCodexRateLimitPayload({ ok: true }), null);
});

test("buildCodexOAuthProfile maps app config OAuth defaults", () => {
  const config = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-codex-strategy-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
    OAUTH_PROVIDER_NAME: "OpenAI",
    OAUTH_AUTHORIZATION_URL: "https://auth.openai.com/oauth/authorize",
    OAUTH_TOKEN_URL: "https://auth.openai.com/oauth/token",
    OAUTH_USERINFO_URL: "https://auth.openai.com/oauth/userinfo",
    OAUTH_CLIENT_ID: "codex-client-id",
    OAUTH_CLIENT_SECRET: "codex-client-secret",
    OAUTH_SCOPES: "openid profile email",
    OAUTH_ORIGINATOR: "omni-connector",
  });

  const profile = buildCodexOAuthProfile(config);

  assert.equal(profile.id, CODEX_OAUTH_PROFILE_ID);
  assert.equal(profile.clientId, "codex-client-id");
  assert.equal(profile.clientSecret, "codex-client-secret");
  assert.equal(profile.authorizationUrl, "https://auth.openai.com/oauth/authorize");
  assert.deepEqual(profile.scopes, ["openid", "profile", "email"]);
  assert.equal(profile.extraParams.codex_cli_simplified_flow, "true");
  assert.equal(profile.extraParams.id_token_add_organizations, "true");
});

test("codexUsageCandidateUrls prioritizes configured quota URL", () => {
  const withOverride = codexUsageCandidateUrls("https://example.com/custom-quota");
  assert.deepEqual(withOverride, [
    "https://example.com/custom-quota",
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/backend-api/codex/wham/usage",
  ]);

  const defaultsOnly = codexUsageCandidateUrls(null);
  assert.deepEqual(defaultsOnly, [
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/backend-api/codex/wham/usage",
  ]);
});
