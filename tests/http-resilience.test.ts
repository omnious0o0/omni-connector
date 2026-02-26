import assert from "node:assert/strict";
import test from "node:test";
import { resilientFetch } from "../src/services/http-resilience";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

test("resilientFetch retries retryable HTTP status and eventually succeeds", async () => {
  let attempts = 0;
  const sleepCalls: number[] = [];

  const response = await resilientFetch(
    "https://example.com/retryable",
    { method: "GET" },
    {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          return jsonResponse(500, { error: "temporary" });
        }

        return jsonResponse(200, { ok: true });
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      random: () => 0,
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 1_000,
      timeoutMs: 100,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(sleepCalls, [200, 400]);
});

test("resilientFetch does not retry non-retryable HTTP status", async () => {
  let attempts = 0;
  const sleepCalls: number[] = [];

  const response = await resilientFetch(
    "https://example.com/non-retryable",
    { method: "GET" },
    {
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(401, { error: "unauthorized" });
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      maxAttempts: 4,
      timeoutMs: 100,
    },
  );

  assert.equal(response.status, 401);
  assert.equal(attempts, 1);
  assert.equal(sleepCalls.length, 0);
});

test("resilientFetch retries transient network error", async () => {
  let attempts = 0;
  const sleepCalls: number[] = [];

  const response = await resilientFetch(
    "https://example.com/network",
    { method: "GET" },
    {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }

        return jsonResponse(200, { ok: true });
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      random: () => 0,
      maxAttempts: 2,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
      timeoutMs: 100,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(sleepCalls, [250]);
});

test("resilientFetch caps Retry-After wait by maxDelayMs", async () => {
  let attempts = 0;
  const sleepCalls: number[] = [];

  const response = await resilientFetch(
    "https://example.com/retry-after",
    { method: "GET" },
    {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse(429, { error: "rate_limited" }, { "Retry-After": "120" });
        }

        return jsonResponse(200, { ok: true });
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      maxAttempts: 2,
      maxDelayMs: 900,
      timeoutMs: 100,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(sleepCalls, [900]);
});
