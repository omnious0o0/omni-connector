import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import supertest from "supertest";
import { createApp } from "../src/app";
import { HttpError } from "../src/errors";
import { createOpenAiRouter } from "../src/routes/openai";
import { ProviderId } from "../src/types";

const DASHBOARD_CLIENT_HEADER = {
  "x-omni-client": "dashboard",
};

function createTempDataPath(): { dataFilePath: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-openai-route-test-"));

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

interface MockOpenAiServer {
  baseUrl: string;
  requests: Array<{ path: string; authorization: string | null; body: unknown }>;
  close: () => Promise<void>;
}

interface MockCodexSseServer {
  baseUrl: string;
  requests: Array<{
    path: string;
    authorization: string | null;
    chatgptAccountId: string | null;
    originator: string | null;
    body: unknown;
  }>;
  close: () => Promise<void>;
}

async function startMockOpenAiServer(options: {
  status: number;
  responseBody: Record<string, unknown>;
}): Promise<MockOpenAiServer> {
  const requests: Array<{ path: string; authorization: string | null; body: unknown }> = [];

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);

    if (method !== "POST" || url.pathname !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    const rawBody = await readRequestBody(request);
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = null;
    }

    const authorizationHeader = request.headers.authorization;
    const authorization = Array.isArray(authorizationHeader)
      ? authorizationHeader[0] ?? null
      : authorizationHeader ?? null;
    requests.push({
      path: url.pathname,
      authorization,
      body: parsedBody,
    });

    response.writeHead(options.status, { "content-type": "application/json" });
    response.end(JSON.stringify(options.responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function startMockCodexSseServer(options: {
  status?: number;
  errorBody?: Record<string, unknown>;
  events?: Array<Record<string, unknown>>;
} = {}): Promise<MockCodexSseServer> {
  const requests: Array<{
    path: string;
    authorization: string | null;
    chatgptAccountId: string | null;
    originator: string | null;
    body: unknown;
  }> = [];

  const status = options.status ?? 200;
  const defaultEvents: Array<Record<string, unknown>> = [
    {
      type: "response.created",
      response: {
        id: "resp_mock_codex",
      },
    },
    {
      type: "response.output_text.delta",
      delta: "LIVE",
    },
    {
      type: "response.output_text.delta",
      delta: "_OK",
    },
    {
      type: "response.completed",
      response: {
        id: "resp_mock_codex",
        model: "gpt-5-codex",
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        },
      },
    },
  ];
  const events = options.events ?? defaultEvents;

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);

    if (method !== "POST" || url.pathname !== "/backend-api/codex/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "not found" }));
      return;
    }

    const rawBody = await readRequestBody(request);
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = null;
    }

    const authorizationHeader = request.headers.authorization;
    const authorization = Array.isArray(authorizationHeader)
      ? authorizationHeader[0] ?? null
      : authorizationHeader ?? null;
    const accountHeader = request.headers["chatgpt-account-id"];
    const chatgptAccountId = Array.isArray(accountHeader) ? accountHeader[0] ?? null : accountHeader ?? null;
    const originatorHeader = request.headers.originator;
    const originator = Array.isArray(originatorHeader) ? originatorHeader[0] ?? null : originatorHeader ?? null;
    requests.push({
      path: url.pathname,
      authorization,
      chatgptAccountId,
      originator,
      body: parsedBody,
    });

    if (status !== 200) {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(options.errorBody ?? { detail: "mock codex failure" }));
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of events) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    response.write("data: [DONE]\n\n");
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

function writeSeededCodexOAuthStore(dataFilePath: string, connectorKey: string): void {
  const nowIso = new Date().toISOString();
  const seededStore = {
    connector: {
      apiKey: connectorKey,
      createdAt: nowIso,
      lastRotatedAt: nowIso,
      routingPreferences: {
        preferredProvider: "auto",
        fallbackProviders: [],
        priorityModels: ["auto"],
      },
    },
    accounts: [
      {
        id: "acc_codex_oauth_seed",
        provider: "codex",
        authMethod: "oauth",
        oauthProfileId: "oauth",
        providerAccountId: "google-oauth2|seeded-codex-oauth",
        chatgptAccountId: "workspace-seeded",
        displayName: "Seeded Codex OAuth",
        accessToken: "oauth-seeded-access-token",
        refreshToken: "oauth-seeded-refresh-token",
        tokenExpiresAt: "2999-01-01T00:00:00.000Z",
        createdAt: nowIso,
        updatedAt: nowIso,
        quotaSyncedAt: nowIso,
        quotaSyncStatus: "live",
        quotaSyncError: null,
        estimatedUsageSampleCount: 0,
        estimatedUsageTotalUnits: 0,
        estimatedUsageUpdatedAt: null,
        planType: "pro",
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: 100,
            used: 0,
            mode: "units",
            windowStartedAt: nowIso,
            resetsAt: null,
          },
          weekly: {
            limit: 100,
            used: 0,
            mode: "units",
            windowStartedAt: nowIso,
            resetsAt: null,
          },
        },
      },
    ],
  };

  fs.writeFileSync(dataFilePath, JSON.stringify(seededStore, null, 2), "utf8");
}

function buildInferenceBaseUrls(overrides: Partial<Record<ProviderId, string>>): Record<ProviderId, string> {
  return {
    codex: overrides.codex ?? "https://api.openai.com/v1",
    gemini: overrides.gemini ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    claude: overrides.claude ?? "https://api.anthropic.com/v1",
    openrouter: overrides.openrouter ?? "https://openrouter.ai/api/v1",
  };
}

function assertOpenAiErrorShape(
  payload: unknown,
  expected: {
    type: string;
    code: string;
    message: string;
  },
): void {
  assert.equal(payload !== null && typeof payload === "object", true);
  const body = payload as { error?: unknown };
  assert.equal(body.error !== null && typeof body.error === "object", true);

  const error = body.error as Record<string, unknown>;
  assert.equal(error.type, expected.type);
  assert.equal(error.code, expected.code);
  assert.equal(error.message, expected.message);
}

test("rejects missing Authorization header with OpenAI auth error schema", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .send({
        model: "auto",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(401)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "authentication_error",
      code: "missing_authorization",
      message: "Missing Authorization header.",
    });
    assert.equal("provider_failures" in (response.body.error as Record<string, unknown>), false);
  } finally {
    temp.cleanup();
  }
});

test("rejects non-Bearer Authorization header with strict error contract", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Token invalid")
      .send({
        model: "auto",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(401)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "authentication_error",
      code: "invalid_authorization",
      message: "Authorization header must use Bearer token format.",
    });
  } finally {
    temp.cleanup();
  }
});

test("rejects stream=true payloads with explicit unsupported-stream error", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer any-key")
      .send({
        model: "auto",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(400)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "invalid_request_error",
      code: "stream_not_supported",
      message: "stream=true is not supported by omni-connector yet.",
    });
  } finally {
    temp.cleanup();
  }
});

test("rejects non-array messages before any routing attempt", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer any-key")
      .send({
        model: "auto",
        messages: { role: "user", content: "hello" },
      })
      .expect(400)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "invalid_request_error",
      code: "invalid_messages",
      message: "messages must be a non-empty array.",
    });
  } finally {
    temp.cleanup();
  }
});

test("rejects empty model values with strict invalid_model contract", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer any-key")
      .send({
        model: "  ",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(400)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "invalid_request_error",
      code: "invalid_model",
      message: "model must be a non-empty string.",
    });
  } finally {
    temp.cleanup();
  }
});

test("returns invalid_connector_key for unknown connector bearer token", async () => {
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

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer not-the-real-connector-key")
      .send({
        model: "auto",
        messages: [{ role: "user", content: "hello" }],
      })
      .expect(401)
      .expect("content-type", /json/);

    assertOpenAiErrorShape(response.body, {
      type: "authentication_error",
      code: "invalid_connector_key",
      message: "Connector API key is missing or invalid.",
    });
  } finally {
    temp.cleanup();
  }
});

test("maps 429 errors to OpenAI rate_limit_error type", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/v1",
    createOpenAiRouter({
      connectorService: {
        async routeCandidates() {
          throw new HttpError(429, "connector_rate_limited", "Connector routing temporarily rate limited.");
        },
        consumeRoutedUsage() {
          return;
        },
      },
      providerInferenceBaseUrls: buildInferenceBaseUrls({}),
      codexChatgptBaseUrl: "https://chatgpt.com/backend-api/codex",
    }),
  );

  const response = await supertest(app)
    .post("/v1/chat/completions")
    .set("Authorization", "Bearer test-key")
    .send({
      model: "auto",
      messages: [{ role: "user", content: "hello" }],
    })
    .expect(429)
    .expect("content-type", /json/);

  assertOpenAiErrorShape(response.body, {
    type: "rate_limit_error",
    code: "connector_rate_limited",
    message: "Connector routing temporarily rate limited.",
  });
});

test("uses Codex OAuth backend-api responses for oauth accounts", async () => {
  const temp = createTempDataPath();
  const codexBackendServer = await startMockCodexSseServer();

  try {
    writeSeededCodexOAuthStore(temp.dataFilePath, "omni-seeded-codex-oauth");

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
      codexChatgptBaseUrl: `${codexBackendServer.baseUrl}/backend-api/codex`,
    });

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer omni-seeded-codex-oauth")
      .send({
        model: "auto",
        messages: [{ role: "user", content: "Reply with exactly LIVE_OK" }],
      })
      .expect(200);

    assert.equal(response.body.choices[0]?.message?.content, "LIVE_OK");
    assert.equal(response.body.usage?.prompt_tokens, 12);
    assert.equal(response.body.usage?.completion_tokens, 4);

    assert.equal(codexBackendServer.requests.length, 1);
    assert.equal(codexBackendServer.requests[0]?.path, "/backend-api/codex/responses");
    assert.equal(codexBackendServer.requests[0]?.authorization, "Bearer oauth-seeded-access-token");
    assert.equal(codexBackendServer.requests[0]?.chatgptAccountId, "workspace-seeded");
    assert.equal(codexBackendServer.requests[0]?.originator, "codex_cli_rs");
    assert.equal((codexBackendServer.requests[0]?.body as { stream?: boolean }).stream, true);
    assert.equal(
      ((codexBackendServer.requests[0]?.body as { instructions?: string }).instructions ?? "").length > 0,
      true,
    );
    assert.equal((codexBackendServer.requests[0]?.body as { model?: string }).model, "gpt-5-codex");
  } finally {
    await codexBackendServer.close();
    temp.cleanup();
  }
});

test("falls back to OpenAI-compatible codex endpoint when Codex backend-api fails", async () => {
  const temp = createTempDataPath();
  const codexBackendServer = await startMockCodexSseServer({
    status: 400,
    errorBody: {
      detail: "backend-api unavailable",
    },
  });
  const codexOpenAiServer = await startMockOpenAiServer({
    status: 200,
    responseBody: {
      id: "chatcmpl-codex-openai-fallback",
      object: "chat.completion",
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Fallback via OpenAI-compatible endpoint",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 5,
        total_tokens: 13,
      },
    },
  });

  try {
    writeSeededCodexOAuthStore(temp.dataFilePath, "omni-seeded-codex-fallback");

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
      codexChatgptBaseUrl: `${codexBackendServer.baseUrl}/backend-api/codex`,
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexOpenAiServer.baseUrl}/v1`,
      }),
    });

    const response = await supertest(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer omni-seeded-codex-fallback")
      .send({
        model: "auto",
        messages: [{ role: "user", content: "Fallback test" }],
      })
      .expect(200);

    assert.equal(response.body.id, "chatcmpl-codex-openai-fallback");
    assert.equal(response.body.choices[0]?.message?.content, "Fallback via OpenAI-compatible endpoint");
    assert.equal(codexBackendServer.requests.length, 1);
    assert.equal(codexOpenAiServer.requests.length, 1);
  } finally {
    await codexBackendServer.close();
    await codexOpenAiServer.close();
    temp.cleanup();
  }
});

test("proxies /v1/chat/completions to routed Codex account", async () => {
  const temp = createTempDataPath();
  const codexServer = await startMockOpenAiServer({
    status: 200,
    responseBody: {
      id: "chatcmpl-mock-codex",
      object: "chat.completion",
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Codex mock response",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    },
  });

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
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexServer.baseUrl}/v1`,
      }),
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "codex",
        displayName: "Codex API",
        providerAccountId: "codex-live",
        apiKey: "codex-live-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;

    const response = await agent
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({
        model: "auto",
        messages: [{ role: "user", content: "Say hello." }],
      })
      .expect(200);

    assert.equal(response.body.id, "chatcmpl-mock-codex");
    assert.equal(response.body.choices[0]?.message?.content, "Codex mock response");
    assert.equal(codexServer.requests.length, 1);
    assert.equal(codexServer.requests[0]?.authorization, "Bearer codex-live-key");
    assert.equal((codexServer.requests[0]?.body as { model?: string }).model, "gpt-4.1-mini");
  } finally {
    await codexServer.close();
    temp.cleanup();
  }
});

test("falls back to next provider when first chat upstream fails", async () => {
  const temp = createTempDataPath();
  const codexServer = await startMockOpenAiServer({
    status: 502,
    responseBody: {
      error: {
        message: "codex temporary outage",
      },
    },
  });
  const openrouterServer = await startMockOpenAiServer({
    status: 200,
    responseBody: {
      id: "chatcmpl-mock-openrouter",
      object: "chat.completion",
      model: "openai/gpt-4o-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "OpenRouter fallback response",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 6,
        total_tokens: 13,
      },
    },
  });

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
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexServer.baseUrl}/v1`,
        openrouter: `${openrouterServer.baseUrl}/v1`,
      }),
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "codex",
        displayName: "Codex API",
        providerAccountId: "codex-fallback",
        apiKey: "codex-fallback-key",
      })
      .expect(201);

    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "openrouter",
        displayName: "OpenRouter API",
        providerAccountId: "openrouter-fallback",
        apiKey: "openrouter-fallback-key",
      })
      .expect(201);

    await agent
      .post("/api/connector/routing")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        preferredProvider: "codex",
        fallbackProviders: ["openrouter"],
        priorityModels: ["auto"],
      })
      .expect(200);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;

    const response = await agent
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({
        model: "auto",
        messages: [{ role: "user", content: "fallback test" }],
      })
      .expect(200);

    assert.equal(response.body.id, "chatcmpl-mock-openrouter");
    assert.equal(response.body.choices[0]?.message?.content, "OpenRouter fallback response");
    assert.equal(codexServer.requests.length, 1);
    assert.equal(openrouterServer.requests.length, 1);
  } finally {
    await codexServer.close();
    await openrouterServer.close();
    temp.cleanup();
  }
});

test("redacts sensitive provider failure messages in OpenAI error responses", async () => {
  const temp = createTempDataPath();
  const codexServer = await startMockOpenAiServer({
    status: 503,
    responseBody: {
      error: {
        message:
          "Bearer sk-this-should-never-leak and token=secret-token-value and api_key=abc123 should be redacted",
      },
    },
  });

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
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexServer.baseUrl}/v1`,
      }),
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "codex",
        displayName: "Codex API",
        providerAccountId: "codex-redaction",
        apiKey: "codex-redaction-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;

    const response = await agent
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({
        model: "auto",
        messages: [{ role: "user", content: "redaction test" }],
      })
      .expect(503);

    assert.equal(response.body.error?.code, "no_providers_available");
    assert.equal(response.body.error?.type, "server_error");
    const failures = response.body.error?.provider_failures as Array<{ message?: string }>;
    assert.equal(Array.isArray(failures), true);
    assert.equal(failures.length, 1);
    const message = failures[0]?.message ?? "";
    assert.equal(message.length > 0, true);
    assert.equal(message.length <= 260, true);
    assert.match(message, /\[redacted\]/i);
    assert.doesNotMatch(message, /sk-this-should-never-leak/i);
    assert.doesNotMatch(message, /secret-token-value/i);
    assert.doesNotMatch(message, /api_key=abc123/i);
  } finally {
    await codexServer.close();
    temp.cleanup();
  }
});

test("redacts JSON-style tokens and Basic credentials in OpenAI error responses", async () => {
  const temp = createTempDataPath();
  const codexServer = await startMockOpenAiServer({
    status: 503,
    responseBody: {
      error: {
        message:
          '{"access_token":"super-secret-access","refresh_token":"super-secret-refresh","authorization":"Bearer sk-live-super-secret-token","basic":"Basic Zm9vOmJhcg=="}',
      },
    },
  });

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
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexServer.baseUrl}/v1`,
      }),
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "codex",
        displayName: "Codex API",
        providerAccountId: "codex-redaction-json",
        apiKey: "codex-redaction-json-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;

    const response = await agent
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({
        model: "auto",
        messages: [{ role: "user", content: "redaction json/basic test" }],
      })
      .expect(503);

    assert.equal(response.body.error?.code, "no_providers_available");
    assert.equal(response.body.error?.type, "server_error");
    const failures = response.body.error?.provider_failures as Array<{ message?: string }>;
    assert.equal(Array.isArray(failures), true);
    assert.equal(failures.length, 1);
    const message = failures[0]?.message ?? "";
    assert.equal(message.length > 0, true);
    assert.equal(message.length <= 260, true);
    assert.match(message, /\[redacted\]/i);
    assert.doesNotMatch(message, /super-secret-access/i);
    assert.doesNotMatch(message, /super-secret-refresh/i);
    assert.doesNotMatch(message, /sk-live-super-secret-token/i);
    assert.doesNotMatch(message, /Bearer\s+sk-live-super-secret-token/i);
    assert.doesNotMatch(message, /Zm9vOmJhcg==/i);
    assert.doesNotMatch(message, /Basic\s+Zm9vOmJhcg==/i);
  } finally {
    await codexServer.close();
    temp.cleanup();
  }
});

test("returns 503 with provider failure breakdown when all upstream calls fail", async () => {
  const temp = createTempDataPath();
  const codexServer = await startMockOpenAiServer({
    status: 503,
    responseBody: {
      error: {
        message: "upstream unavailable",
      },
    },
  });

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
      providerInferenceBaseUrls: buildInferenceBaseUrls({
        codex: `${codexServer.baseUrl}/v1`,
      }),
    });

    const agent = supertest.agent(app);
    await agent
      .post("/api/accounts/link-api")
      .set(DASHBOARD_CLIENT_HEADER)
      .send({
        provider: "codex",
        displayName: "Codex API",
        providerAccountId: "codex-only",
        apiKey: "codex-only-key",
      })
      .expect(201);

    const dashboard = await agent
      .get("/api/dashboard")
      .set(DASHBOARD_CLIENT_HEADER)
      .expect(200);
    const connectorKey = dashboard.body.connector.apiKey as string;

    const response = await agent
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${connectorKey}`)
      .send({
        model: "auto",
        messages: [{ role: "user", content: "fail test" }],
      })
      .expect(503);

    assert.equal(response.body.error?.code, "no_providers_available");
    assert.equal(response.body.error?.type, "server_error");
    assert.equal(response.body.error?.message, "No connected provider is currently available for this request.");
    assert.equal(Array.isArray(response.body.error?.provider_failures), true);
    assert.equal(response.body.error.provider_failures.length, 1);
    assert.deepEqual(Object.keys(response.body.error.provider_failures[0] ?? {}).sort(), [
      "message",
      "provider",
      "status",
    ]);
    assert.equal(response.body.error.provider_failures[0]?.provider, "codex");
    assert.equal(response.body.error.provider_failures[0]?.status, 503);
    assert.equal(typeof response.body.error.provider_failures[0]?.message, "string");
  } finally {
    await codexServer.close();
    temp.cleanup();
  }
});
