import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import test from "node:test";
import supertest from "supertest";
import { createApp } from "../src/app";

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
        params.get("client_id") !== OPENAI_CODEX_CLIENT_ID
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

async function linkOAuthAccount(agent: ReturnType<typeof supertest.agent>): Promise<void> {
  const oauthStart = await agent.get("/auth/omni/start").expect(302);
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
