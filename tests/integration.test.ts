import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import test from "node:test";
import supertest from "supertest";
import { createApp } from "../src/app";
import { resolveConfig } from "../src/config";

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DASHBOARD_CLIENT_HEADER = {
  "x-omni-client": "dashboard",
};

function createTempDataPath(): { dataFilePath: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-connector-test-"));

  return {
    dataFilePath: path.join(directory, "store.json"),
    cleanup: () => {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", (error) => {
      reject(error);
    });
  });
}

interface MockOAuthServerOptions {
  sharedWorkspaceId?: string;
  expectedClientId?: string;
  quotaRateLimitMessage?: string;
  fixedIdentity?: {
    subject: string;
    name: string;
    email: string;
  };
}

async function startMockOAuthServer(options: MockOAuthServerOptions = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const sharedWorkspaceId = options.sharedWorkspaceId ?? null;
  const expectedClientId = options.expectedClientId ?? OPENAI_CODEX_CLIENT_ID;
  const quotaRateLimitMessage = options.quotaRateLimitMessage ?? null;
  const fixedIdentity = options.fixedIdentity ?? null;
  const codeRecords = new Map<
    string,
    {
      redirectUri: string;
      subject: string;
      name: string;
      email: string;
      chatgptAccountId: string;
      fiveHourPercent: number;
      weeklyPercent: number;
    }
  >();
  const accessRecords = new Map<
    string,
    {
      subject: string;
      name: string;
      email: string;
      chatgptAccountId: string;
      fiveHourPercent: number;
      weeklyPercent: number;
    }
  >();
  let authorizationCounter = 0;

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);

    if (method === "GET" && url.pathname === "/oauth/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const codeChallenge = url.searchParams.get("code_challenge");
      const codeChallengeMethod = url.searchParams.get("code_challenge_method");
      const clientId = url.searchParams.get("client_id");

      if (!redirectUri || !state || !codeChallenge || codeChallengeMethod !== "S256" || !clientId) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }

      authorizationCounter += 1;
      const suffix = authorizationCounter.toString().padStart(2, "0");
      const code = `mock-code-${suffix}`;
      const subject = fixedIdentity?.subject ?? `codex-user-${suffix}`;
      const name = fixedIdentity?.name ?? `Codex User ${suffix}`;
      const email = fixedIdentity?.email ?? `codex-user-${suffix}@example.com`;

      codeRecords.set(code, {
        redirectUri,
        subject,
        name,
        email,
        chatgptAccountId: sharedWorkspaceId ?? `workspace-${suffix}`,
        fiveHourPercent: 20 + authorizationCounter,
        weeklyPercent: 12 + authorizationCounter,
      });

      const redirect = new URL(redirectUri);
      redirect.searchParams.set("state", state);
      redirect.searchParams.set("code", code);

      response.writeHead(302, {
        location: redirect.toString(),
      });
      response.end();
      return;
    }

    if (method === "POST" && url.pathname === "/oauth/token") {
      const body = await readRequestBody(request);
      const params = new URLSearchParams(body);
      const code = params.get("code") ?? "";
      const codeRecord = codeRecords.get(code);

      if (
        params.get("grant_type") !== "authorization_code" ||
        !codeRecord ||
        params.get("redirect_uri") !== codeRecord.redirectUri ||
        !params.get("code_verifier") ||
        params.get("client_id") !== expectedClientId
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }

      const accessToken = `mock-access-${codeRecord.subject}`;
      accessRecords.set(accessToken, {
        subject: codeRecord.subject,
        name: codeRecord.name,
        email: codeRecord.email,
        chatgptAccountId: codeRecord.chatgptAccountId,
        fiveHourPercent: codeRecord.fiveHourPercent,
        weeklyPercent: codeRecord.weeklyPercent,
      });

      const idTokenPayload = Buffer.from(
        JSON.stringify({
          sub: codeRecord.subject,
          name: codeRecord.name,
          email: codeRecord.email,
          chatgpt_account_id: codeRecord.chatgptAccountId,
          "https://api.openai.com/auth": {
            chatgpt_account_id: codeRecord.chatgptAccountId,
          },
        }),
      ).toString("base64url");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: `mock-refresh-${codeRecord.subject}`,
          expires_in: 3600,
          id_token: `header.${idTokenPayload}.signature`,
          token_type: "Bearer",
        }),
      );
      return;
    }

    if (method === "GET" && url.pathname === "/oauth/userinfo") {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
      const accessRecord = accessRecords.get(token);
      const accountHeader = request.headers["chatgpt-account-id"];
      const accountHeaderValue = Array.isArray(accountHeader) ? accountHeader[0] : accountHeader;

      if (!accessRecord) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (accountHeaderValue && accountHeaderValue !== accessRecord.chatgptAccountId) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sub: accessRecord.subject,
          name: accessRecord.name,
          email: accessRecord.email,
        }),
      );
      return;
    }

    if (
      method === "GET" &&
      (url.pathname === "/backend-api/wham/usage" || url.pathname === "/backend-api/codex/wham/usage")
    ) {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
      const accessRecord = accessRecords.get(token);

      if (!accessRecord) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (quotaRateLimitMessage) {
        response.writeHead(429, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: quotaRateLimitMessage,
            },
          }),
        );
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: accessRecord.fiveHourPercent,
              limit_window_seconds: 300 * 60,
              reset_after_seconds: 300,
              reset_at: Math.floor(Date.now() / 1000) + 300,
            },
            secondary_window: {
              used_percent: accessRecord.weeklyPercent,
              limit_window_seconds: 7 * 24 * 60 * 60,
              reset_after_seconds: 7 * 24 * 60 * 60,
              reset_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
            },
          },
          credits: {
            has_credits: true,
            unlimited: false,
            balance: "41",
          },
          additional_rate_limits: [],
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const addressInfo = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addressInfo.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

interface MockUsageServerOptions {
  responseDelayMs?: number;
  failFiveHourStatus?: number;
  failWeeklyStatus?: number;
}

async function startMockUsageServer(options: MockUsageServerOptions = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  getCounts: () => { fiveHour: number; weekly: number };
}> {
  const responseDelayMs = Math.max(0, options.responseDelayMs ?? 0);
  const failFiveHourStatus = options.failFiveHourStatus ?? null;
  const failWeeklyStatus = options.failWeeklyStatus ?? null;
  const requestCounts = {
    fiveHour: 0,
    weekly: 0,
  };

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const key = url.searchParams.get("key");

    if (method !== "GET") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (!key || key !== "gem-live-key") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (responseDelayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, responseDelayMs);
      });
    }

    if (url.pathname === "/usage/5h") {
      requestCounts.fiveHour += 1;
      if (failFiveHourStatus !== null) {
        response.writeHead(failFiveHourStatus, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "upstream_failure" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ used: 18, limit: 1000, plan_type: "enterprise" }));
      return;
    }

    if (url.pathname === "/usage/7d") {
      requestCounts.weekly += 1;
      if (failWeeklyStatus !== null) {
        response.writeHead(failWeeklyStatus, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "upstream_failure" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ used: 125, limit: 8000, credits_balance: "73" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const addressInfo = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addressInfo.port}`;

  return {
    baseUrl,
    getCounts: () => ({ ...requestCounts }),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function linkOAuthAccount(
  agent: ReturnType<typeof supertest.agent>,
  startPath: string = "/auth/omni/start",
): Promise<void> {
  const oauthStart = await agent.get(startPath).expect(302);
  const authorizationLocation = oauthStart.header.location;
  assert.ok(authorizationLocation);

  const authorizationUrl = new URL(authorizationLocation);
  const authorizationResponse = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(authorizationResponse.status, 302);

  const callbackLocation = authorizationResponse.headers.get("location");
  assert.ok(callbackLocation);

  const callbackUrl = new URL(callbackLocation);
  await agent
    .get(`${callbackUrl.pathname}${callbackUrl.search}`)
    .expect(302)
    .expect("location", "/?connected=1");
}

test("supports codex OAuth start route alias", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    await linkOAuthAccount(agent, "/auth/codex/start");

    await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts.length, 1);
    assert.equal(dashboard.body.accounts[0]?.provider, "codex");
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("returns 404 for missing /assets files instead of SPA fallback HTML", async () => {
  const temp = createTempDataPath();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    await supertest(app)
      .get("/assets/does-not-exist.svg")
      .expect(404)
      .expect(({ text }) => {
        assert.match(text, /Cannot GET \/assets\/does-not-exist\.svg/);
      });
  } finally {
    temp.cleanup();
  }
});

test("accepts callback from earlier OAuth start when multiple starts were initiated", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    const firstStart = await agent.get("/auth/omni/start").expect(302);
    const secondStart = await agent.get("/auth/omni/start").expect(302);

    const firstAuthorizationLocation = firstStart.header.location;
    const secondAuthorizationLocation = secondStart.header.location;
    assert.ok(firstAuthorizationLocation);
    assert.ok(secondAuthorizationLocation);

    const firstAuthorizationUrl = new URL(firstAuthorizationLocation);
    const secondAuthorizationUrl = new URL(secondAuthorizationLocation);

    const firstAuthorizationResponse = await fetch(firstAuthorizationUrl, { redirect: "manual" });
    assert.equal(firstAuthorizationResponse.status, 302);
    const firstCallbackLocation = firstAuthorizationResponse.headers.get("location");
    assert.ok(firstCallbackLocation);

    await fetch(secondAuthorizationUrl, { redirect: "manual" });

    const firstCallbackUrl = new URL(firstCallbackLocation);
    await agent
      .get(`${firstCallbackUrl.pathname}${firstCallbackUrl.search}`)
      .expect(302)
      .expect("location", "/?connected=1");

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts.length, 1);
    assert.equal(dashboard.body.accounts[0]?.provider, "codex");
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("rejects OAuth callback without matching session cookie", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const startAgent = supertest.agent(app);
    const oauthStart = await startAgent.get("/auth/omni/start").expect(302);
    const authorizationLocation = oauthStart.header.location;
    assert.ok(authorizationLocation);

    const authorizationUrl = new URL(authorizationLocation);
    const providerRedirectResponse = await fetch(authorizationUrl, { redirect: "manual" });
    assert.equal(providerRedirectResponse.status, 302);

    const callbackLocation = providerRedirectResponse.headers.get("location");
    assert.ok(callbackLocation);
    const callbackUrl = new URL(callbackLocation);

    await supertest(app)
      .get(`${callbackUrl.pathname}${callbackUrl.search}`)
      .expect(400)
      .expect("OAuth state validation failed.");

    const dashboard = await startAgent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts.length, 0);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("connects gemini through both OAuth options (Gemini CLI and Antigravity)", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer({ expectedClientId: "gemini-client-id" });

  try {
    const defaults = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    });

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...defaults.providerUsage,
        gemini: {
          ...defaults.providerUsage.gemini,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
      oauthProfiles: {
        ...defaults.oauthProfiles,
        gemini: [
          {
            id: "gemini-cli",
            label: "Gemini CLI",
            authorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
            tokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
            userInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
            clientId: "gemini-client-id",
            clientSecret: "",
            scopes: ["openid", "profile", "email"],
            originator: null,
            extraParams: {},
          },
          {
            id: "antigravity",
            label: "Antigravity",
            authorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
            tokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
            userInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
            clientId: "gemini-client-id",
            clientSecret: "",
            scopes: ["openid", "profile", "email"],
            originator: null,
            extraParams: {},
          },
        ],
      },
    });

    const agent = supertest.agent(app);
    const providersResponse = await agent.get("/api/auth/providers").expect(200);
    const geminiProvider = (providersResponse.body.providers as Array<{
      id: string;
      oauthConfigured: boolean;
      oauthOptions: Array<{ id: string }>;
    }>).find((provider) => provider.id === "gemini");

    assert.equal(geminiProvider?.oauthConfigured, true);
    assert.equal((geminiProvider?.oauthOptions ?? []).length, 2);

    await linkOAuthAccount(agent, "/auth/gemini/start?profile=gemini-cli");

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts.length, 1);
    assert.equal(dashboard.body.accounts[0]?.provider, "gemini");
    assert.equal(dashboard.body.accounts[0]?.authMethod, "oauth");
    assert.equal(dashboard.body.accounts[0]?.oauthProfileId, "gemini-cli");

    const connectorKey = dashboard.body.connector.apiKey as string;
    const routeResult = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 1 })
      .expect(200);

    assert.equal(routeResult.body.routedTo.provider, "gemini");
    assert.match(routeResult.body.authorizationHeader, /^Bearer mock-access-/);

    await agent.get("/auth/gemini/start?profile=antigravity").expect(302);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("estimates Gemini OAuth usage when live usage data is unavailable", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer({ expectedClientId: "gemini-client-id" });

  try {
    const defaults = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    });

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      oauthProfiles: {
        ...defaults.oauthProfiles,
        gemini: [
          {
            id: "gemini-cli",
            label: "Gemini CLI",
            authorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
            tokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
            userInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
            clientId: "gemini-client-id",
            clientSecret: "",
            scopes: ["openid", "profile", "email"],
            originator: null,
            extraParams: {},
          },
        ],
      },
    });

    const agent = supertest.agent(app);
    await linkOAuthAccount(agent, "/auth/gemini/start?profile=gemini-cli");

    const firstDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const beforeRoute = firstDashboard.body.accounts[0] as {
      quotaSyncStatus: string;
      estimatedUsageSampleCount: number;
      quota: {
        fiveHour: { limit: number; used: number };
        weekly: { limit: number; used: number };
      };
    };
    assert.equal(beforeRoute.quotaSyncStatus, "unavailable");
    assert.equal(beforeRoute.estimatedUsageSampleCount, 0);
    assert.equal(beforeRoute.quota.fiveHour.limit, 0);
    assert.equal(beforeRoute.quota.weekly.limit, 0);

    const connectorKey = firstDashboard.body.connector.apiKey as string;
    await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 2 })
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.quotaConsumed, true);
      });

    const secondDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const afterRoute = secondDashboard.body.accounts[0] as {
      quotaSyncStatus: string;
      estimatedUsageSampleCount: number;
      estimatedUsageTotalUnits: number;
      quota: {
        fiveHour: { limit: number; used: number };
        weekly: { limit: number; used: number };
      };
    };

    assert.equal(afterRoute.quotaSyncStatus, "stale");
    assert.equal(afterRoute.estimatedUsageSampleCount, 1);
    assert.equal(afterRoute.estimatedUsageTotalUnits, 2);
    assert.equal(afterRoute.quota.fiveHour.limit > 0, true);
    assert.equal(afterRoute.quota.weekly.limit > 0, true);
    assert.equal(afterRoute.quota.fiveHour.used, 2);
    assert.equal(afterRoute.quota.weekly.used, 2);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("connects account through external OAuth provider and routes by connector key", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    const providerMeta = await agent.get("/api/auth/provider").expect(200);
    assert.equal(providerMeta.body.providerName, "OpenAI");
    assert.equal(providerMeta.body.configured, true);

    const dashboardBefore = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(dashboardBefore.body.dashboardAuthorized, true);
    assert.equal(dashboardBefore.body.accounts.length, 0);
    assert.match(dashboardBefore.body.connector.apiKey as string, /^cxk_/);

    const oauthStart = await agent.get("/auth/omni/start").expect(302);
    const authorizationLocation = oauthStart.header.location;
    assert.ok(authorizationLocation);
    const authorizationUrl = new URL(authorizationLocation);
    assert.equal(authorizationUrl.origin, mockOAuth.baseUrl);
    assert.equal(authorizationUrl.pathname, "/oauth/authorize");
    assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
    assert.equal(authorizationUrl.searchParams.get("client_id"), OPENAI_CODEX_CLIENT_ID);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("codex_cli_simplified_flow"), "true");

    const authorizationResponse = await fetch(authorizationUrl, { redirect: "manual" });
    assert.equal(authorizationResponse.status, 302);
    const callbackLocation = authorizationResponse.headers.get("location");
    assert.ok(callbackLocation);

    const callbackUrl = new URL(callbackLocation);
    await agent
      .get(`${callbackUrl.pathname}${callbackUrl.search}`)
      .expect(302)
      .expect("location", "/?connected=1");

    const dashboardAfter = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(dashboardAfter.body.dashboardAuthorized, true);
    assert.equal(dashboardAfter.body.accounts.length, 1);
    const initialConnectorKey = dashboardAfter.body.connector.apiKey as string;
    assert.match(initialConnectorKey, /^cxk_/);
    assert.equal(dashboardAfter.body.accounts[0]?.provider, "codex");
    assert.equal(dashboardAfter.body.accounts[0]?.quota.fiveHour.limit, 100);
    assert.equal(dashboardAfter.body.accounts[0]?.quota.fiveHour.used, 21);
    assert.equal(dashboardAfter.body.accounts[0]?.quota.weekly.limit, 100);
    assert.equal(dashboardAfter.body.accounts[0]?.quota.weekly.used, 13);
    assert.equal(dashboardAfter.body.accounts[0]?.quotaSyncStatus, "live");

    const routeResult = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${initialConnectorKey}`)
      .send({ units: 5 })
      .expect(200);

    assert.equal(routeResult.body.unitsConsumed, 5);
    assert.equal(routeResult.body.routedTo.provider, "codex");
    assert.match(routeResult.body.authorizationHeader, /^Bearer mock-access-/);
    assert.equal(routeResult.body.quotaConsumed, false);

    const rotateResult = await agent
      .post("/api/connector/key/rotate")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const rotatedKey = rotateResult.body.apiKey as string;
    assert.notEqual(rotatedKey, initialConnectorKey);

    await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${initialConnectorKey}`)
      .send({ units: 1 })
      .expect(401);

    await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${rotatedKey}`)
      .send({ units: 1 })
      .expect(200);

    const accountId = dashboardAfter.body.accounts[0]?.id as string | undefined;
    assert.ok(accountId);

    await agent
      .post(`/api/accounts/${accountId}/remove`)
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(204);
    const dashboardFinal = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(dashboardFinal.body.accounts.length, 0);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("uses Codex 429 fallback parsing when live quota endpoint is rate limited", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer({
    quotaRateLimitMessage: "Rate limit reached, try again in 3h 42m",
  });

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    await linkOAuthAccount(agent);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const account = dashboard.body.accounts[0];

    assert.equal(account?.quotaSyncStatus, "live");
    assert.equal(account?.quota?.fiveHour?.mode, "percent");
    assert.equal(account?.quota?.weekly?.mode, "percent");
    assert.equal(account?.quota?.fiveHour?.used, 100);
    assert.equal(account?.quota?.weekly?.used, 100);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("links distinct accounts even when OAuth workspace id is shared", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer({ sharedWorkspaceId: "workspace-shared" });

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    await linkOAuthAccount(agent);
    await linkOAuthAccount(agent);
    await linkOAuthAccount(agent);
    await linkOAuthAccount(agent);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const accounts = dashboard.body.accounts as Array<{
      providerAccountId: string;
      chatgptAccountId?: string | null;
    }>;

    assert.equal(accounts.length, 4);
    assert.equal(new Set(accounts.map((account) => account.providerAccountId)).size, 4);
    assert.equal(new Set(accounts.map((account) => account.chatgptAccountId ?? null)).size, 1);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("lists providers and links API-key account for non-OAuth provider", async () => {
  const temp = createTempDataPath();
  const isolatedGeminiEnvKeys = [
    "GEMINI_CLI_OAUTH_CLIENT_ID",
    "GEMINI_CLI_OAUTH_CLIENT_SECRET",
    "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_ID",
    "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_SECRET",
    "OPENCLAW_GEMINI_OAUTH_CLIENT_ID",
    "OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET",
  ] as const;
  const previousGeminiEnv = new Map<string, string | undefined>(
    isolatedGeminiEnvKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of isolatedGeminiEnvKeys) {
    delete process.env[key];
  }
  const previousGeminiAutoDiscover = process.env.GEMINI_OAUTH_AUTO_DISCOVER;
  process.env.GEMINI_OAUTH_AUTO_DISCOVER = "false";

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: "https://auth.openai.com/oauth/authorize",
      oauthTokenUrl: "https://auth.openai.com/oauth/token",
      oauthUserInfoUrl: null,
      oauthQuotaUrl: null,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    const providersResponse = await agent.get("/api/auth/providers").expect(200);
    const providers = providersResponse.body.providers as Array<{
      id: string;
      supportsOAuth: boolean;
      supportsApiKey: boolean;
      oauthConfigured: boolean;
      usageConfigured: boolean;
      recommended?: boolean;
      warnings?: string[];
      oauthOptions?: Array<{
        id: string;
        configured: boolean;
        startPath: string;
        requiredClientIdEnv?: string | null;
        configurationHint?: string | null;
      }>;
    }>;
    const providerIds = new Set(providers.map((provider) => provider.id));

    assert.deepEqual(
      [...providerIds].sort(),
      ["claude", "codex", "gemini", "openrouter"],
    );

    const geminiProvider = providers.find((provider) => provider.id === "gemini");
    assert.equal(geminiProvider?.supportsOAuth, true);
    assert.equal(geminiProvider?.oauthConfigured, false);
    assert.equal(geminiProvider?.supportsApiKey, true);
    assert.equal((geminiProvider?.warnings?.length ?? 0) > 0, true);
    const geminiOauthOptionIds = new Set((geminiProvider?.oauthOptions ?? []).map((option) => option.id));
    assert.equal(geminiOauthOptionIds.has("gemini-cli"), true);
    assert.equal(geminiOauthOptionIds.has("antigravity"), true);
    const geminiCliOption = (geminiProvider?.oauthOptions ?? []).find((option) => option.id === "gemini-cli");
    assert.equal(geminiCliOption?.requiredClientIdEnv, "GEMINI_CLI_OAUTH_CLIENT_ID");
    assert.equal(
      geminiCliOption?.configurationHint,
      "OAuth not configured. Install @google/gemini-cli for auto-discovery, or set GEMINI_CLI_OAUTH_CLIENT_ID in .env and restart omni-connector.",
    );
    const geminiAntigravityOption = (geminiProvider?.oauthOptions ?? []).find((option) => option.id === "antigravity");
    assert.equal(geminiAntigravityOption?.requiredClientIdEnv, "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_ID");
    assert.equal(
      geminiAntigravityOption?.configurationHint,
      "OAuth not configured. Install Antigravity or OpenClaw for auto-discovery, or set GEMINI_ANTIGRAVITY_OAUTH_CLIENT_ID in .env and restart omni-connector.",
    );

    const openRouterProvider = providers.find((provider) => provider.id === "openrouter");
    assert.equal(openRouterProvider?.recommended, true);

    const claudeProvider = providers.find((provider) => provider.id === "claude");
    assert.equal(claudeProvider?.supportsOAuth, false);
    assert.equal(claudeProvider?.oauthConfigured, false);
    assert.equal(claudeProvider?.usageConfigured, false);
    assert.equal(claudeProvider?.supportsApiKey, true);
    assert.equal((claudeProvider?.oauthOptions ?? []).length, 0);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Workspace",
        providerAccountId: "gemini-primary",
        apiKey: "gem-api-key-123",
      })
      .expect(201);

    const geminiStart = await agent.get("/auth/gemini/start").expect(503);
    assert.equal(
      geminiStart.text,
      "OAuth profile is not configured for gemini/gemini-cli. Install @google/gemini-cli for auto-discovery, or set GEMINI_CLI_OAUTH_CLIENT_ID in .env and restart omni-connector.",
    );
    await agent.get("/auth/claude/start").expect(400);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const linkedAccount = dashboard.body.accounts[0] as {
      provider: string;
      authMethod?: string;
      providerAccountId: string;
    };

    assert.equal(dashboard.body.accounts.length, 1);
    assert.equal(linkedAccount.provider, "gemini");
    assert.equal(linkedAccount.authMethod, "api");
    assert.equal(linkedAccount.providerAccountId, "gemini-primary");

    const connectorKey = dashboard.body.connector.apiKey as string;
    const routeResult = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 2 })
      .expect(200);

    assert.equal(routeResult.body.routedTo.provider, "gemini");
    assert.equal(routeResult.body.routedTo.authMethod, "api");
    assert.equal(routeResult.body.authorizationHeader, "Bearer gem-api-key-123");
    assert.equal(routeResult.body.quotaConsumed, true);
  } finally {
    if (previousGeminiAutoDiscover === undefined) {
      delete process.env.GEMINI_OAUTH_AUTO_DISCOVER;
    } else {
      process.env.GEMINI_OAUTH_AUTO_DISCOVER = previousGeminiAutoDiscover;
    }
    for (const [key, value] of previousGeminiEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    temp.cleanup();
  }
});

test("updates provider-specific account settings via account settings endpoint", async () => {
  const temp = createTempDataPath();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Original",
        providerAccountId: "gemini-settings",
        apiKey: "gem-settings-key",
        manualFiveHourLimit: 500,
        manualWeeklyLimit: 5000,
      })
      .expect(201);

    const initialDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const account = initialDashboard.body.accounts[0] as {
      id: string;
      displayName: string;
      quota: {
        fiveHour: { limit: number };
        weekly: { limit: number };
      };
    };

    assert.ok(account?.id);
    assert.equal(account.displayName, "Gemini Original");
    assert.equal(account.quota.fiveHour.limit, 500);
    assert.equal(account.quota.weekly.limit, 5000);

    await agent
      .post(`/api/accounts/${account.id}/settings`)
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        displayName: "Gemini Tuned",
        manualFiveHourLimit: 1200,
        manualWeeklyLimit: 9800,
      })
      .expect(200);

    const updatedDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const updatedAccount = updatedDashboard.body.accounts[0] as {
      displayName: string;
      quota: {
        fiveHour: { limit: number };
        weekly: { limit: number };
      };
    };

    assert.equal(updatedAccount.displayName, "Gemini Tuned");
    assert.equal(updatedAccount.quota.fiveHour.limit, 1200);
    assert.equal(updatedAccount.quota.weekly.limit, 9800);
  } finally {
    temp.cleanup();
  }
});

test("rejects manual limits on API link when live usage adapter is configured", async () => {
  const temp = createTempDataPath();
  const mockUsage = await startMockUsageServer();

  try {
    const providerUsage = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    }).providerUsage;

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...providerUsage,
        gemini: {
          ...providerUsage.gemini,
          parser: "json_totals",
          authMode: "query-api-key",
          authQueryParam: "key",
          fiveHourUrl: `${mockUsage.baseUrl}/usage/5h`,
          weeklyUrl: `${mockUsage.baseUrl}/usage/7d`,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini With Manual",
        providerAccountId: "gemini-live-manual",
        apiKey: "gem-live-key",
        manualFiveHourLimit: 400,
        manualWeeklyLimit: 5000,
      })
      .expect(409)
      .expect(({ body }) => {
        assert.equal(body.error, "manual_limits_not_allowed");
      });

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Without Manual",
        providerAccountId: "gemini-live-default",
        apiKey: "gem-live-key",
      })
      .expect(201);
  } finally {
    await mockUsage.close();
    temp.cleanup();
  }
});

test("blocks manual limit edits for live-synced accounts but allows display-name updates", async () => {
  const temp = createTempDataPath();
  const now = new Date().toISOString();
  const seededStore = {
    connector: {
      apiKey: "cxk_seeded_test_key",
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [
      {
        id: "acc_live_api",
        provider: "openrouter",
        authMethod: "api",
        providerAccountId: "openrouter-live",
        chatgptAccountId: null,
        displayName: "OpenRouter Live",
        accessToken: "openrouter-live-token",
        refreshToken: null,
        tokenExpiresAt: "2999-01-01T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
        quotaSyncedAt: now,
        quotaSyncStatus: "live",
        quotaSyncError: null,
        planType: null,
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 700,
            used: 120,
            mode: "units",
            windowStartedAt: now,
            resetsAt: null,
          },
          weekly: {
            limit: 7000,
            used: 900,
            mode: "units",
            windowStartedAt: now,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(temp.dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/acc_live_api/settings")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        manualFiveHourLimit: 900,
      })
      .expect(409)
      .expect(({ body }) => {
        assert.equal(body.error, "manual_limits_not_allowed");
      });

    await agent
      .post("/api/accounts/acc_live_api/settings")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        displayName: "OpenRouter Renamed",
      })
      .expect(200);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const account = dashboard.body.accounts[0] as {
      displayName: string;
      quota: {
        fiveHour: { limit: number };
        weekly: { limit: number };
      };
    };
    assert.equal(account.displayName, "OpenRouter Renamed");
    assert.equal(account.quota.fiveHour.limit, 700);
    assert.equal(account.quota.weekly.limit, 7000);
  } finally {
    temp.cleanup();
  }
});

test("clears legacy Gemini OAuth placeholder limits when usage adapter is not configured", async () => {
  const temp = createTempDataPath();
  const now = new Date().toISOString();
  const seededStore = {
    connector: {
      apiKey: "cxk_seeded_test_key",
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [
      {
        id: "acc_gemini_legacy_placeholder",
        provider: "gemini",
        authMethod: "oauth",
        oauthProfileId: "gemini-cli",
        providerAccountId: "gemini-project-legacy",
        chatgptAccountId: null,
        displayName: "Gemini Legacy",
        accessToken: "legacy-gemini-token",
        refreshToken: null,
        tokenExpiresAt: "2999-01-01T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
        quotaSyncedAt: now,
        quotaSyncStatus: "stale",
        quotaSyncError: null,
        planType: null,
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 50_000,
            used: 0,
            mode: "units",
            windowStartedAt: now,
            resetsAt: null,
          },
          weekly: {
            limit: 500_000,
            used: 0,
            mode: "units",
            windowStartedAt: now,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(temp.dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    const account = dashboard.body.accounts[0] as {
      quotaSyncStatus: string;
      quotaSyncError: string | null;
      estimatedUsageSampleCount: number;
      estimatedUsageTotalUnits: number;
      quota: {
        fiveHour: { limit: number; used: number };
        weekly: { limit: number; used: number };
      };
    };

    assert.equal(account.quotaSyncStatus, "unavailable");
    assert.equal(account.quotaSyncError, null);
    assert.equal(account.estimatedUsageSampleCount, 0);
    assert.equal(account.estimatedUsageTotalUnits, 0);
    assert.equal(account.quota.fiveHour.limit, 0);
    assert.equal(account.quota.fiveHour.used, 0);
    assert.equal(account.quota.weekly.limit, 0);
    assert.equal(account.quota.weekly.used, 0);

    await agent
      .post("/api/connector/route")
      .set("Authorization", "Bearer cxk_seeded_test_key")
      .send({ units: 1 })
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.quotaConsumed, true);
      });

    const estimatedDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    const estimatedAccount = estimatedDashboard.body.accounts[0] as {
      quotaSyncStatus: string;
      estimatedUsageSampleCount: number;
      estimatedUsageTotalUnits: number;
      quota: {
        fiveHour: { limit: number; used: number };
        weekly: { limit: number; used: number };
      };
    };

    assert.equal(estimatedAccount.quotaSyncStatus, "stale");
    assert.equal(estimatedAccount.estimatedUsageSampleCount, 1);
    assert.equal(estimatedAccount.estimatedUsageTotalUnits, 1);
    assert.equal(estimatedAccount.quota.fiveHour.limit > 0, true);
    assert.equal(estimatedAccount.quota.weekly.limit > 0, true);
    assert.equal(estimatedAccount.quota.fiveHour.used, 1);
    assert.equal(estimatedAccount.quota.weekly.used, 1);
  } finally {
    temp.cleanup();
  }
});

test("enforces strict live quota mode when provider usage adapter is missing", async () => {
  const temp = createTempDataPath();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      strictLiveQuota: true,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Strict",
        providerAccountId: "gemini-strict",
        apiKey: "gemini-key-strict",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts[0]?.quotaSyncStatus, "unavailable");

    const connectorKey = dashboard.body.connector.apiKey as string;
    const route = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 1 })
      .expect(503);

    assert.equal(route.body.error, "strict_live_quota_required");
  } finally {
    temp.cleanup();
  }
});

test("requires OAuth session authorization when remote dashboard mode is enabled", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      allowRemoteDashboard: true,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);
    await agent.get("/api/dashboard").set(DASHBOARD_CLIENT_HEADER).expect(401);

    await linkOAuthAccount(agent);

    await agent.get("/api/dashboard").set(DASHBOARD_CLIENT_HEADER).expect(200);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("routes in strict live mode when provider usage adapter is configured", async () => {
  const temp = createTempDataPath();
  const mockUsage = await startMockUsageServer();

  try {
    const providerUsage = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    }).providerUsage;

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      strictLiveQuota: true,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...providerUsage,
        gemini: {
          ...providerUsage.gemini,
          parser: "json_totals",
          authMode: "query-api-key",
          authQueryParam: "key",
          fiveHourUrl: `${mockUsage.baseUrl}/usage/5h`,
          weeklyUrl: `${mockUsage.baseUrl}/usage/7d`,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Live",
        providerAccountId: "gemini-live",
        apiKey: "gem-live-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const account = dashboard.body.accounts[0];

    assert.equal(account?.quotaSyncStatus, "live");
    assert.equal(account?.quota?.fiveHour?.limit, 1000);
    assert.equal(account?.quota?.fiveHour?.used, 18);
    assert.equal(account?.quota?.weekly?.limit, 8000);
    assert.equal(account?.quota?.weekly?.used, 125);

    const connectorKey = dashboard.body.connector.apiKey as string;
    const route = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 2 })
      .expect(200);

    assert.equal(route.body.routedTo.provider, "gemini");
    assert.equal(route.body.quotaConsumed, false);
  } finally {
    await mockUsage.close();
    temp.cleanup();
  }
});

test("marks partial provider usage sync as stale in strict live mode", async () => {
  const temp = createTempDataPath();
  const mockUsage = await startMockUsageServer({ failFiveHourStatus: 500 });

  try {
    const providerUsage = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    }).providerUsage;

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      strictLiveQuota: true,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...providerUsage,
        gemini: {
          ...providerUsage.gemini,
          parser: "json_totals",
          authMode: "query-api-key",
          authQueryParam: "key",
          fiveHourUrl: `${mockUsage.baseUrl}/usage/5h`,
          weeklyUrl: `${mockUsage.baseUrl}/usage/7d`,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Partial",
        providerAccountId: "gemini-partial",
        apiKey: "gem-live-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboard.body.accounts[0]?.quotaSyncStatus, "stale");
    assert.match(String(dashboard.body.accounts[0]?.quotaSyncError ?? ""), /5h usage fetch failed/i);

    const connectorKey = dashboard.body.connector.apiKey as string;
    const route = await agent
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 1 })
      .expect(503);

    assert.equal(route.body.error, "strict_live_quota_required");
  } finally {
    await mockUsage.close();
    temp.cleanup();
  }
});

test("applies strict live sync cooldown after provider usage failure", async () => {
  const temp = createTempDataPath();
  const mockUsage = await startMockUsageServer({ failFiveHourStatus: 500, failWeeklyStatus: 500 });

  try {
    const providerUsage = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    }).providerUsage;

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      strictLiveQuota: true,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...providerUsage,
        gemini: {
          ...providerUsage.gemini,
          parser: "json_totals",
          authMode: "query-api-key",
          authQueryParam: "key",
          fiveHourUrl: `${mockUsage.baseUrl}/usage/5h`,
          weeklyUrl: `${mockUsage.baseUrl}/usage/7d`,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
    });

    const agent = supertest.agent(app);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "gemini",
        displayName: "Gemini Cooldown",
        providerAccountId: "gemini-cooldown",
        apiKey: "gem-live-key",
      })
      .expect(201);

    const firstDashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(firstDashboard.body.accounts[0]?.quotaSyncStatus, "unavailable");

    const countsAfterFirst = mockUsage.getCounts();

    await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    const countsAfterSecond = mockUsage.getCounts();
    assert.deepEqual(countsAfterSecond, countsAfterFirst);
  } finally {
    await mockUsage.close();
    temp.cleanup();
  }
});

test("returns dashboard quickly while slow quota sync continues in background", async () => {
  const temp = createTempDataPath();
  const mockUsage = await startMockUsageServer({ responseDelayMs: 2000 });

  const now = new Date().toISOString();
  const staleTime = "2000-01-01T00:00:00.000Z";
  const seededStore = {
    connector: {
      apiKey: "cxk_seeded_slow_sync",
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [
      {
        id: "acc_slow_sync",
        provider: "gemini",
        authMethod: "api",
        providerAccountId: "gemini-slow",
        chatgptAccountId: null,
        displayName: "Gemini Slow",
        accessToken: "gem-live-key",
        refreshToken: null,
        tokenExpiresAt: "2999-01-01T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
        quotaSyncedAt: staleTime,
        quotaSyncStatus: "stale",
        quotaSyncError: null,
        planType: null,
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 1000,
            used: 0,
            mode: "units",
            windowStartedAt: staleTime,
            resetsAt: null,
          },
          weekly: {
            limit: 8000,
            used: 0,
            mode: "units",
            windowStartedAt: staleTime,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(temp.dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");

  try {
    const providerUsage = resolveConfig({
      HOST: "127.0.0.1",
      PORT: "1455",
      DATA_FILE: temp.dataFilePath,
      SESSION_SECRET: "seeded",
      PUBLIC_DIR: path.join(process.cwd(), "public"),
    }).providerUsage;

    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      strictLiveQuota: false,
      oauthRequireQuota: false,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
      providerUsage: {
        ...providerUsage,
        gemini: {
          ...providerUsage.gemini,
          parser: "json_totals",
          authMode: "query-api-key",
          authQueryParam: "key",
          fiveHourUrl: `${mockUsage.baseUrl}/usage/5h`,
          weeklyUrl: `${mockUsage.baseUrl}/usage/7d`,
          fiveHourLimit: 1000,
          weeklyLimit: 8000,
        },
      },
    });

    const agent = supertest.agent(app);

    const startedAt = Date.now();
    const dashboardFast = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(dashboardFast.body.accounts.length, 1);
    assert.ok(elapsedMs < 1500, `dashboard request took ${elapsedMs}ms`);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2300);
    });

    const dashboardSynced = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);

    assert.equal(dashboardSynced.body.accounts[0]?.quotaSyncStatus, "live");
    assert.equal(dashboardSynced.body.accounts[0]?.quota?.fiveHour?.used, 18);
    assert.equal(dashboardSynced.body.accounts[0]?.quota?.weekly?.used, 125);
  } finally {
    await mockUsage.close();
    temp.cleanup();
  }
});

test("does not duplicate same auth when legacy workspace-based record already exists", async () => {
  const temp = createTempDataPath();
  const workspaceId = "workspace-legacy";
  const identity = {
    subject: "codex-user-legacy",
    name: "legacy@example.com",
    email: "legacy@example.com",
  };

  const now = new Date().toISOString();
  const seededStore = {
    connector: {
      apiKey: "cxk_seeded_test_key",
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [
      {
        id: "acc_seeded",
        provider: "codex",
        providerAccountId: workspaceId,
        chatgptAccountId: workspaceId,
        displayName: identity.email,
        accessToken: "seeded-access-token",
        refreshToken: "seeded-refresh-token",
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: now,
        updatedAt: now,
        quotaSyncedAt: now,
        quotaSyncStatus: "stale",
        quotaSyncError: null,
        planType: "pro",
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 100,
            used: 10,
            windowStartedAt: now,
            resetsAt: null,
          },
          weekly: {
            limit: 100,
            used: 20,
            windowStartedAt: now,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(temp.dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");

  const mockOAuth = await startMockOAuthServer({
    sharedWorkspaceId: workspaceId,
    fixedIdentity: identity,
  });

  try {
    const app = createApp({
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    });

    const agent = supertest.agent(app);

    await linkOAuthAccount(agent);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const accounts = dashboard.body.accounts as Array<{
      providerAccountId: string;
      displayName: string;
    }>;

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.providerAccountId, identity.subject);
    assert.equal(accounts[0]?.displayName, identity.email);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});

test("requires dashboard client header for dashboard and mutations", async () => {
  const temp = createTempDataPath();
  const now = new Date().toISOString();
  const seededStore = {
    connector: {
      apiKey: "cxk_seeded_test_key",
      createdAt: now,
      lastRotatedAt: now,
    },
    accounts: [
      {
        id: "acc_seeded",
        provider: "codex",
        providerAccountId: "seeded-provider-id",
        chatgptAccountId: "seeded-workspace-id",
        displayName: "seeded@example.com",
        accessToken: "seeded-access-token",
        refreshToken: "seeded-refresh-token",
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: now,
        updatedAt: now,
        quotaSyncedAt: now,
        quotaSyncStatus: "stale",
        quotaSyncError: null,
        planType: "pro",
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 100,
            used: 10,
            windowStartedAt: now,
            resetsAt: null,
          },
          weekly: {
            limit: 100,
            used: 20,
            windowStartedAt: now,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(temp.dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");

  const app = createApp({
    dataFilePath: temp.dataFilePath,
    sessionSecret: "test-session-secret",
    publicDir: path.join(process.cwd(), "public"),
    port: 0,
    oauthAuthorizationUrl: "https://auth.openai.com/oauth/authorize",
    oauthTokenUrl: "https://auth.openai.com/oauth/token",
    oauthUserInfoUrl: null,
    oauthQuotaUrl: null,
    oauthScopes: ["openid", "profile", "email", "offline_access"],
    oauthRequireQuota: false,
    defaultFiveHourLimit: 0,
    defaultWeeklyLimit: 0,
    defaultFiveHourUsed: 0,
    defaultWeeklyUsed: 0,
  });

  try {
    await supertest(app).get("/api/dashboard").expect(403);

    const dashboard = await supertest(app)
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(dashboard.body.connector.apiKey, "cxk_seeded_test_key");
    assert.equal(dashboard.body.dashboardAuthorized, true);
    assert.equal(dashboard.body.accounts.length, 1);
    assert.equal(dashboard.body.accounts[0]?.providerAccountId, "seeded-provider-id");
    assert.equal(dashboard.body.bestAccount?.providerAccountId, "seeded-provider-id");
    assert.deepEqual(dashboard.body.totals, {
      fiveHourLimit: 100,
      fiveHourUsed: 10,
      fiveHourRemaining: 80,
      weeklyLimit: 100,
      weeklyUsed: 20,
      weeklyRemaining: 80,
    });

    await supertest(app).post("/api/connector/key/rotate").expect(403);

    const rotateResponse = await supertest(app)
      .post("/api/connector/key/rotate")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.match(rotateResponse.body.apiKey as string, /^cxk_/);
    assert.notEqual(rotateResponse.body.apiKey as string, "cxk_seeded_test_key");

    await supertest(app).post("/api/accounts/acc_seeded/remove").expect(403);

    await supertest(app)
      .post("/api/accounts/acc_seeded/remove")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(204);

    const dashboardAfter = await supertest(app)
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    assert.equal(dashboardAfter.body.accounts.length, 0);
  } finally {
    temp.cleanup();
  }
});

test("persists connector and oauth tokens encrypted at rest", async () => {
  const temp = createTempDataPath();
  const mockOAuth = await startMockOAuthServer();

  try {
    const appConfig = {
      dataFilePath: temp.dataFilePath,
      sessionSecret: "test-session-secret",
      publicDir: path.join(process.cwd(), "public"),
      port: 0,
      oauthAuthorizationUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
      oauthTokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
      oauthUserInfoUrl: `${mockOAuth.baseUrl}/oauth/userinfo`,
      oauthQuotaUrl: `${mockOAuth.baseUrl}/backend-api/wham/usage`,
      oauthScopes: ["openid", "profile", "email", "offline_access"],
      oauthRequireQuota: true,
      defaultFiveHourLimit: 0,
      defaultWeeklyLimit: 0,
      defaultFiveHourUsed: 0,
      defaultWeeklyUsed: 0,
    };

    const app = createApp(appConfig);
    const agent = supertest.agent(app);

    await linkOAuthAccount(agent);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;
    assert.match(connectorKey, /^cxk_/);

    const persistedRaw = JSON.parse(fs.readFileSync(temp.dataFilePath, "utf8")) as {
      connector: {
        apiKey: string;
      };
      accounts: Array<{
        accessToken: string;
        refreshToken: string | null;
      }>;
    };

    assert.match(persistedRaw.connector.apiKey, /^enc:v1:/);
    assert.equal(persistedRaw.accounts.length, 1);
    assert.match(persistedRaw.accounts[0]?.accessToken ?? "", /^enc:v1:/);
    assert.match(persistedRaw.accounts[0]?.refreshToken ?? "", /^enc:v1:/);

    const reloadedApp = createApp(appConfig);
    await supertest(reloadedApp)
      .post("/api/connector/route")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({ units: 1 })
      .expect(200);
  } finally {
    await mockOAuth.close();
    temp.cleanup();
  }
});
