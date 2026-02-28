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
