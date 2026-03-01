import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorLogText } from "../src/app";
import { safeErrorMessage } from "../src/routes/oauth";

test("app sanitizer redacts Basic and Bearer credentials", () => {
  const sanitized = sanitizeErrorLogText(
    'authorization: Basic Zm9vOmJhcg== token=secret-value Bearer sk-live-secret client_secret=top-secret id_token=id-secret',
  );

  assert.match(sanitized, /authorization:\s*\[redacted\]/i);
  assert.match(sanitized, /token=\[redacted\]/i);
  assert.match(sanitized, /Bearer\s+\[redacted\]/i);
  assert.match(sanitized, /client_secret=\[redacted\]/i);
  assert.match(sanitized, /id_token=\[redacted\]/i);
  assert.doesNotMatch(sanitized, /Zm9vOmJhcg==/i);
  assert.doesNotMatch(sanitized, /sk-live-secret/i);
  assert.doesNotMatch(sanitized, /top-secret/i);
  assert.doesNotMatch(sanitized, /id-secret/i);
});

test("oauth route safe error sanitizer redacts Basic credentials", () => {
  const sanitized = safeErrorMessage(
    new Error('provider failed: authorization: Basic Zm9vOmJhcg== token=secret-value Bearer sk-live-secret'),
  );

  assert.match(sanitized, /authorization:\s*\[redacted\]/i);
  assert.match(sanitized, /token=\[redacted\]/i);
  assert.match(sanitized, /Bearer\s+\[redacted\]/i);
  assert.doesNotMatch(sanitized, /Zm9vOmJhcg==/i);
  assert.doesNotMatch(sanitized, /secret-value/i);
  assert.doesNotMatch(sanitized, /sk-live-secret/i);
});
