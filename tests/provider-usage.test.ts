import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveConfig } from "../src/config";
import { HttpError } from "../src/errors";
import { ProviderUsageService } from "../src/services/provider-usage";
import { ConnectedAccount } from "../src/types";

function createApiAccount(provider: ConnectedAccount["provider"]): ConnectedAccount {
  const nowIso = new Date().toISOString();
  return {
    id: `acc-${provider}`,
    provider,
    authMethod: "api",
    providerAccountId: `${provider}-account`,
    displayName: `${provider} account`,
    accessToken: "test-api-key",
    refreshToken: null,
    tokenExpiresAt: "2999-01-01T00:00:00.000Z",
    createdAt: nowIso,
    updatedAt: nowIso,
    quota: {
      fiveHour: {
        limit: 1_000,
        used: 0,
        windowStartedAt: nowIso,
      },
      weekly: {
        limit: 8_000,
        used: 0,
        windowStartedAt: nowIso,
      },
    },
  };
}

test("accepts loopback HTTP usage URLs on IPv6 localhost", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      codex: {
        ...defaults.providerUsage.codex,
        parser: "json_totals",
        authMode: "query-api-key",
        authQueryParam: "key",
        fiveHourUrl: "http://[::1]:1455/usage/5h",
        weeklyUrl: "http://[::1]:1455/usage/7d",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("codex");
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  const mockedFetch: typeof fetch = async (input) => {
    const requestUrl = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    requestedUrls.push(requestUrl);
    return new Response(JSON.stringify({ used: 12, limit: 1000 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  globalThis.fetch = mockedFetch;

  try {
    const snapshot = await service.fetchLiveQuotaSnapshot(account);
    assert.ok(snapshot);
    assert.equal(snapshot?.syncError, null);
    assert.equal(requestedUrls.length >= 2, true);
    assert.equal(requestedUrls.every((url) => url.startsWith("http://[::1]:1455/usage/")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects spoofed loopback hostnames for HTTP usage endpoints", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      codex: {
        ...defaults.providerUsage.codex,
        parser: "json_totals",
        authMode: "query-api-key",
        authQueryParam: "key",
        fiveHourUrl: "http://127.evil.com/usage/5h",
        weeklyUrl: "http://127.evil.com/usage/7d",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("codex");
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  const mockedFetch: typeof fetch = async () => {
    fetchCallCount += 1;
    throw new Error("fetch should not be called for rejected HTTP usage URL policy");
  };

  globalThis.fetch = mockedFetch;

  try {
    await assert.rejects(
      () => service.fetchLiveQuotaSnapshot(account),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 502 &&
        error.code === "provider_usage_fetch_failed" &&
        /Usage URL must use HTTPS\./.test(error.message),
    );
    assert.equal(fetchCallCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("json_totals combines plan and balance metadata across windows", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      openrouter: {
        ...defaults.providerUsage.openrouter,
        parser: "json_totals",
        authMode: "query-api-key",
        authQueryParam: "key",
        fiveHourUrl: "http://127.0.0.1:1455/openrouter/usage/5h",
        weeklyUrl: "http://127.0.0.1:1455/openrouter/usage/7d",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("openrouter");
  const originalFetch = globalThis.fetch;

  const mockedFetch: typeof fetch = async (input) => {
    const requestUrl = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url);
    assert.equal(requestUrl.searchParams.get("key"), "test-api-key");

    if (requestUrl.pathname === "/openrouter/usage/5h") {
      return new Response(JSON.stringify({ used: 24, limit: 1000, plan: "pro" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (requestUrl.pathname === "/openrouter/usage/7d") {
      return new Response(JSON.stringify({ used: 250, limit: 8000, credits_balance: "73" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected URL ${requestUrl.toString()}`);
  };

  globalThis.fetch = mockedFetch;

  try {
    const snapshot = await service.fetchLiveQuotaSnapshot(account);
    assert.ok(snapshot);
    assert.equal(snapshot?.planType, "pro");
    assert.equal(snapshot?.creditsBalance, "73");
    assert.equal(snapshot?.syncError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai_usage reads plan and balance metadata from any successful window", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      codex: {
        ...defaults.providerUsage.codex,
        parser: "openai_usage",
        authMode: "bearer",
        baseUrl: "http://127.0.0.1:1455/v1",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("codex");
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  const mockedFetch: typeof fetch = async (input, init) => {
    const requestUrl = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    requestCount += 1;
    assert.match(requestUrl, /\/organization\/usage\/completions/);
    assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, "Bearer test-api-key");

    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          data: [{ results: [{ input_tokens: 10, output_tokens: 5 }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        data: [{ results: [{ input_tokens: 110, output_tokens: 15 }] }],
        service_tier: "pro",
        credits_balance: "41",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  globalThis.fetch = mockedFetch;

  try {
    const snapshot = await service.fetchLiveQuotaSnapshot(account);
    assert.ok(snapshot);
    assert.equal(snapshot?.planType, "pro");
    assert.equal(snapshot?.creditsBalance, "41");
    assert.equal(snapshot?.syncError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("anthropic_usage derives remaining balance from total credits metadata", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      claude: {
        ...defaults.providerUsage.claude,
        parser: "anthropic_usage",
        authMode: "bearer",
        baseUrl: "http://127.0.0.1:1455/v1",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("claude");
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  const mockedFetch: typeof fetch = async (input, init) => {
    const requestUrl = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    requestCount += 1;
    assert.match(requestUrl, /\/organizations\/usage_report\/messages/);
    assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, "Bearer test-api-key");

    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          data: [{ input_tokens: 10, output_tokens: 5 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        data: [{ input_tokens: 20, output_tokens: 10 }],
        total_credits: 120,
        total_usage: 95,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  globalThis.fetch = mockedFetch;

  try {
    const snapshot = await service.fetchLiveQuotaSnapshot(account);
    assert.ok(snapshot);
    assert.equal(snapshot?.creditsBalance, "25.00");
    assert.equal(snapshot?.syncError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("json_totals reports OAuth-only endpoint mismatch for API-key auth mode", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      gemini: {
        ...defaults.providerUsage.gemini,
        parser: "json_totals",
        authMode: "query-api-key",
        authQueryParam: "key",
        fiveHourUrl: "http://127.0.0.1:1455/oauth-only/usage/5h",
        weeklyUrl: "http://127.0.0.1:1455/oauth-only/usage/7d",
        fiveHourLimit: 1_000,
        weeklyLimit: 8_000,
      },
    },
  });

  const account = createApiAccount("gemini");
  const originalFetch = globalThis.fetch;

  const mockedFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message:
            "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.",
          details: [{ reason: "CREDENTIALS_MISSING" }],
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );

  globalThis.fetch = mockedFetch;

  try {
    await assert.rejects(
      () => service.fetchLiveQuotaSnapshot(account),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 502 &&
        error.code === "provider_usage_fetch_failed" &&
        /CREDENTIALS_MISSING/.test(error.message) &&
        /Configured usage endpoint requires OAuth credentials/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("json_totals keeps metadata when both windows omit quota fields", async () => {
  const defaults = resolveConfig({
    HOST: "127.0.0.1",
    PORT: "1455",
    DATA_FILE: path.join(os.tmpdir(), `omni-provider-usage-test-${Date.now()}-${Math.random()}.json`),
    SESSION_SECRET: "test-session-secret",
    PUBLIC_DIR: path.join(process.cwd(), "public"),
  });

  const service = new ProviderUsageService({
    ...defaults,
    providerUsage: {
      ...defaults.providerUsage,
      openrouter: {
        ...defaults.providerUsage.openrouter,
        parser: "json_totals",
        authMode: "query-api-key",
        authQueryParam: "key",
        fiveHourUrl: "http://127.0.0.1:1455/openrouter/meta/5h",
        weeklyUrl: "http://127.0.0.1:1455/openrouter/meta/7d",
        fiveHourLimit: 1000,
        weeklyLimit: 8000,
      },
    },
  });

  const account = createApiAccount("openrouter");
  const originalFetch = globalThis.fetch;

  const mockedFetch: typeof fetch = async (input) => {
    const requestUrl = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const url = new URL(requestUrl);
    assert.equal(url.searchParams.get("key"), "test-api-key");

    if (url.pathname === "/openrouter/meta/5h") {
      return new Response(JSON.stringify({ plan_type: "enterprise" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/openrouter/meta/7d") {
      return new Response(JSON.stringify({ service_tier: "enterprise" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected URL ${url.toString()}`);
  };

  globalThis.fetch = mockedFetch;

  try {
    const snapshot = await service.fetchLiveQuotaSnapshot(account);
    assert.ok(snapshot);
    assert.equal(snapshot?.fiveHour.limit, 1000);
    assert.equal(snapshot?.weekly.limit, 8000);
    assert.equal(snapshot?.planType, "enterprise");
    assert.equal(snapshot?.creditsBalance, null);
    assert.equal(snapshot?.partial, true);
    assert.match(String(snapshot?.syncError ?? ""), /did not include quota window fields/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
