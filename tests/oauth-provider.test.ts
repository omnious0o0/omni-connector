import assert from "node:assert/strict";
import test from "node:test";
import { extractGeminiCliProjectId } from "../src/services/oauth-provider";

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
