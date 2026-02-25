import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppConfig, resolveConfig } from "../src/config";
import { HttpError } from "../src/errors";
import { extractGeminiCliProjectId, OAuthProviderService } from "../src/services/oauth-provider";

function createService(overrides: Partial<AppConfig> = {}): OAuthProviderService {
  const config = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-oauth-provider-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
    OAUTH_REQUIRE_QUOTA: "false",
    DEFAULT_FIVE_HOUR_LIMIT: "0",
    DEFAULT_WEEKLY_LIMIT: "0",
    DEFAULT_FIVE_HOUR_USED: "0",
    DEFAULT_WEEKLY_USED: "0",
  });

  return new OAuthProviderService({
    ...config,
    ...overrides,
  });
}

test("extractGeminiCliProjectId reads direct project id fields", () => {
  assert.equal(extractGeminiCliProjectId({ projectId: "proj-direct" }), "proj-direct");
  assert.equal(extractGeminiCliProjectId({ project_id: "proj-snake" }), "proj-snake");
});

test("extractGeminiCliProjectId reads cloudaicompanionProject payload variants", () => {
  assert.equal(
    extractGeminiCliProjectId({ cloudaicompanionProject: "proj-string" }),
    "proj-string",
  );

  assert.equal(
    extractGeminiCliProjectId({
      cloudaicompanionProject: {
        id: "proj-object",
      },
    }),
    "proj-object",
  );
});

test("extractGeminiCliProjectId reads nested response project id", () => {
  assert.equal(
    extractGeminiCliProjectId({
      response: {
        cloudaicompanionProject: {
          id: "proj-nested",
        },
      },
    }),
    "proj-nested",
  );
});

test("extractGeminiCliProjectId returns null when payload has no project identifier", () => {
  assert.equal(extractGeminiCliProjectId({ allowedTiers: [{ id: "free-tier" }] }), null);
  assert.equal(extractGeminiCliProjectId(null), null);
});

test("exchangeCodeFor claude requires oauth state at service level", async () => {
  const service = createService();

  await assert.rejects(
    () =>
      service.exchangeCodeFor("claude", "claude-code", {
        code: "auth-code",
        redirectUri: "http://localhost:1455/auth/callback",
        codeVerifier: "pkce-verifier",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "missing_oauth_state",
  );
});

test("exchangeCodeFor gemini-cli uses post-auth project id override for Google profile", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-oauth-provider-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
    OAUTH_REQUIRE_QUOTA: "false",
    DEFAULT_FIVE_HOUR_LIMIT: "0",
    DEFAULT_WEEKLY_LIMIT: "0",
    DEFAULT_FIVE_HOUR_USED: "0",
    DEFAULT_WEEKLY_USED: "0",
  });
  const service = createService({
    oauthProfiles: {
      ...defaults.oauthProfiles,
      gemini: [
        {
          id: "gemini-cli",
          label: "Gemini CLI",
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          tokenUrl: "https://oauth2.googleapis.com/token",
          userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
          clientId: "gemini-test-client-id",
          clientSecret: "",
          scopes: ["openid", "email", "profile"],
          originator: null,
          extraParams: {},
        },
      ],
    },
  });
  const originalFetch = globalThis.fetch;

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const userInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";
  const loadCodeAssistUrl = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
  const fetchCalls: string[] = [];

  const mockedFetch: typeof fetch = async (input, _init) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    fetchCalls.push(url);

    if (url === tokenUrl) {
      return new Response(
        JSON.stringify({
          access_token: "gemini-access-token",
          refresh_token: "gemini-refresh-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (url === userInfoUrl) {
      return new Response(
        JSON.stringify({
          sub: "userinfo-sub-id",
          name: "Gemini User",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (url === loadCodeAssistUrl) {
      return new Response(
        JSON.stringify({
          projectId: "gemini-project-from-load-code-assist",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected fetch call during gemini exchange test: ${url}`);
  };

  globalThis.fetch = mockedFetch;

  try {
    const linked = await service.exchangeCodeFor("gemini", "gemini-cli", {
      code: "auth-code",
      state: "oauth-state",
      redirectUri: "http://localhost:1455/auth/callback",
      codeVerifier: "pkce-verifier",
    });

    assert.equal(linked.provider, "gemini");
    assert.equal(linked.oauthProfileId, "gemini-cli");
    assert.equal(linked.providerAccountId, "gemini-project-from-load-code-assist");
    assert.equal(fetchCalls.includes(loadCodeAssistUrl), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
