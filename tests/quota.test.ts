import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { normalizeAccountQuota, remainingQuota, toDashboardAccount } from "../src/services/quota";
import { ConnectedAccount } from "../src/types";

function createAccountState(): ConnectedAccount {
  const nowIso = new Date().toISOString();

  return {
    id: "acc_test",
    provider: "codex",
    providerAccountId: "acct-provider",
    chatgptAccountId: "workspace-1",
    displayName: "account@example.com",
    accessToken: "access",
    refreshToken: "refresh",
    tokenExpiresAt: new Date(Date.now() + 10_000).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
    quota: {
      fiveHour: {
        limit: 100,
        used: 100,
        windowStartedAt: nowIso,
        resetsAt: null,
      },
      weekly: {
        limit: 100,
        used: 0,
        windowStartedAt: nowIso,
        resetsAt: null,
      },
    },
  };
}

test("weekly exhaustion does not overwrite five-hour usage window", () => {
  const nowMs = Date.now();
  const account = createAccountState();

  account.quota.weekly.used = account.quota.weekly.limit;
  account.quota.fiveHour.used = 20;
  account.quota.fiveHour.windowStartedAt = new Date(nowMs - 60 * 60 * 1000).toISOString();

  normalizeAccountQuota(account, nowMs);

  assert.equal(remainingQuota(account.quota.weekly), 0);
  assert.equal(remainingQuota(account.quota.fiveHour), 80);
  assert.equal(account.quota.fiveHour.used, 20);
});

test("five-hour window can refresh while weekly still has quota", () => {
  const nowMs = Date.now();
  const account = createAccountState();

  account.quota.weekly.used = 10;
  account.quota.fiveHour.used = account.quota.fiveHour.limit;
  account.quota.fiveHour.windowStartedAt = new Date(nowMs - 6 * 60 * 60 * 1000).toISOString();

  normalizeAccountQuota(account, nowMs);

  assert.equal(remainingQuota(account.quota.weekly), 90);
  assert.equal(remainingQuota(account.quota.fiveHour), 100);
  assert.equal(account.quota.fiveHour.used, 0);
});

test("dashboard keeps five-hour and weekly remaining independent", () => {
  const account = createAccountState();

  account.quota.fiveHour.used = 0;
  account.quota.weekly.used = 95;

  const dashboardAccount = toDashboardAccount(account);

  assert.equal(dashboardAccount.quota.weekly.remaining, 5);
  assert.equal(dashboardAccount.quota.fiveHour.remaining, 100);
  assert.equal(dashboardAccount.quota.fiveHour.remainingRatio, 1);
});

type AppContext = vm.Context & {
  authoritativeCadenceMinutes: (windowData: unknown, quotaSyncedAt: unknown) => number | null;
  buildCadenceConsensusByScope: (accounts: unknown[]) => Map<string, number>;
  buildSidebarModelEntries: (
    payload: unknown,
    searchQuery: unknown,
  ) => {
    totalProviders: number;
    visibleProviders: Array<{
      provider: string;
      modelIds: string[];
    }>;
    normalizedSearchQuery: string;
  };
  buildQuotaWindowView: (windowData: unknown, quotaSyncedAt: unknown) => Record<string, unknown>;
  composeProviderModelId: (providerId: unknown, modelId: unknown) => string;
  normalizeSidebarModelSearchQuery: (value: unknown) => string;
  normalizedAccountQuotaWindows: (account: unknown) => unknown[];
  resolveQuotaWindowLabel: (account: unknown, slot: string, windowView: unknown) => string;
  quotaWindowSignature: (windowView: unknown) => string;
  __consensus?: Map<string, number>;
};

function loadFrontendAppContext(): AppContext {
  class HTMLElement {}
  class HTMLInputElement extends HTMLElement {}
  class HTMLButtonElement extends HTMLElement {}
  class HTMLFormElement extends HTMLElement {}
  class HTMLAnchorElement extends HTMLElement {}
  class HTMLSelectElement extends HTMLElement {}
  class HTMLTextAreaElement extends HTMLElement {}

  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    activeElement: null,
  };

  const windowStub = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    lucide: null,
  };

  const contextObject: Record<string, unknown> = {
    console,
    document: documentStub,
    window: windowStub,
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    navigator: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
    location: {
      search: "",
      hash: "",
    },
    history: {
      replaceState: () => undefined,
      pushState: () => undefined,
    },
    fetch: async () => ({
      ok: false,
      headers: { get: () => "application/json" },
      json: async () => ({ message: "request failed" }),
      text: async () => "",
    }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Promise,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    HTMLElement,
    HTMLInputElement,
    HTMLButtonElement,
    HTMLFormElement,
    HTMLAnchorElement,
    HTMLSelectElement,
    HTMLTextAreaElement,
  };

  Object.assign(windowStub, {
    document: documentStub,
    navigator: contextObject.navigator,
    location: contextObject.location,
    history: contextObject.history,
    fetch: contextObject.fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });

  const context = vm.createContext(contextObject) as AppContext;
  const appScriptPath = path.join(process.cwd(), "public", "app.js");
  const appScriptSource = fs.readFileSync(appScriptPath, "utf8");
  vm.runInContext(appScriptSource, context, { filename: appScriptPath });
  return context;
}

function geminiQuotaFixture(params: {
  oauthProfileId: string;
  quotaSyncedAt: string;
  fiveHourWindowMinutes: number | null;
  weeklyWindowMinutes: number | null;
  resetIso: string;
}) {
  return {
    provider: "gemini",
    authMethod: "oauth",
    oauthProfileId: params.oauthProfileId,
    quotaSyncedAt: params.quotaSyncedAt,
    quota: {
      fiveHour: {
        limit: 100,
        used: 0,
        remaining: 100,
        remainingRatio: 1,
        label: null,
        windowMinutes: params.fiveHourWindowMinutes,
        windowStartedAt: params.quotaSyncedAt,
        resetsAt: params.resetIso,
      },
      weekly: {
        limit: 100,
        used: 0,
        remaining: 100,
        remainingRatio: 1,
        label: null,
        windowMinutes: params.weeklyWindowMinutes,
        windowStartedAt: params.quotaSyncedAt,
        resetsAt: params.resetIso,
      },
    },
  };
}

test("frontend cadence resolver ignores reset countdown from synthetic starts", () => {
  const context = loadFrontendAppContext();

  const cadenceMinutes = context.authoritativeCadenceMinutes(
    {
      label: null,
      windowMinutes: null,
      windowStartedAt: "2026-02-28T05:00:00.000Z",
      resetsAt: "2026-02-28T05:20:00.000Z",
    },
    "2026-02-28T05:00:00.000Z",
  );

  assert.equal(cadenceMinutes, null);
});

test("frontend consensus fills missing cadence labels within provider profile scope", () => {
  const context = loadFrontendAppContext();

  const knownCadence = geminiQuotaFixture({
    oauthProfileId: "gemini-cli",
    quotaSyncedAt: "2026-02-28T05:00:00.000Z",
    fiveHourWindowMinutes: 1440,
    weeklyWindowMinutes: 1440,
    resetIso: "2026-03-01T05:00:00.000Z",
  });
  const missingCadence = geminiQuotaFixture({
    oauthProfileId: "gemini-cli",
    quotaSyncedAt: "2026-02-28T05:00:00.000Z",
    fiveHourWindowMinutes: null,
    weeklyWindowMinutes: null,
    resetIso: "2026-02-28T05:20:00.000Z",
  });

  const consensus = context.buildCadenceConsensusByScope([knownCadence, missingCadence]);
  assert.equal(consensus.get("gemini|oauth|gemini-cli|fiveHour"), 1440);
  assert.equal(consensus.get("gemini|oauth|gemini-cli|weekly"), 1440);

  context.__consensus = consensus;
  vm.runInContext("quotaCadenceConsensusByScope = __consensus;", context);

  const unresolvedWindow = context.buildQuotaWindowView(
    missingCadence.quota.fiveHour,
    missingCadence.quotaSyncedAt,
  );
  const resolvedLabel = context.resolveQuotaWindowLabel(missingCadence, "fiveHour", unresolvedWindow);
  assert.equal(resolvedLabel, "1d");
});

test("frontend quota signature collapses slot-only duplicate windows", () => {
  const context = loadFrontendAppContext();
  const baseWindow = {
    slot: "fiveHour",
    windowMinutes: 1440,
    cadenceMinutes: 1440,
    label: "1d",
    scheduleDurationMs: 1440 * 60_000,
    resetAt: "2026-03-01T05:00:00.000Z",
    ratio: 1,
    limit: 100,
    used: 0,
  };

  const fiveHourSignature = context.quotaWindowSignature(baseWindow);
  const weeklySignature = context.quotaWindowSignature({ ...baseWindow, slot: "weekly" });
  assert.equal(fiveHourSignature, weeklySignature);
});

test("frontend normalized windows render one or two fields based on unique windows", () => {
  const context = loadFrontendAppContext();

  const duplicateWindowAccount = geminiQuotaFixture({
    oauthProfileId: "gemini-cli",
    quotaSyncedAt: "2026-02-28T05:00:00.000Z",
    fiveHourWindowMinutes: 1440,
    weeklyWindowMinutes: 1440,
    resetIso: "2026-03-01T05:00:00.000Z",
  });

  const distinctWindowAccount = {
    ...duplicateWindowAccount,
    quota: {
      fiveHour: {
        ...duplicateWindowAccount.quota.fiveHour,
        windowMinutes: 300,
        resetsAt: "2026-02-28T10:00:00.000Z",
      },
      weekly: {
        ...duplicateWindowAccount.quota.weekly,
        windowMinutes: 10080,
        resetsAt: "2026-03-07T05:00:00.000Z",
      },
    },
  };

  const deduped = context.normalizedAccountQuotaWindows(duplicateWindowAccount);
  const distinct = context.normalizedAccountQuotaWindows(distinctWindowAccount);

  assert.equal(Array.isArray(deduped), true);
  assert.equal(Array.isArray(distinct), true);
  assert.equal(deduped.length, 1);
  assert.equal(distinct.length, 2);
});

test("frontend sidebar model helpers normalize IDs and queries", () => {
  const context = loadFrontendAppContext();

  assert.equal(context.normalizeSidebarModelSearchQuery("  gemini  "), "gemini");
  assert.equal(context.normalizeSidebarModelSearchQuery(null), "");

  assert.equal(context.composeProviderModelId("gemini", "gemini-2.5-pro"), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("gemini", " gemini/gemini-2.5-pro "), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("gemini", "/gemini-2.5-pro"), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("unknown", "custom-model"), "custom-model");
});

test("frontend sidebar model builder dedupes, prefixes, sorts, and filters", () => {
  const context = loadFrontendAppContext();

  const payload = {
    providers: [
      {
        provider: "gemini",
        accountCount: 1,
        status: "live",
        modelIds: [
          " gemini-2.5-pro ",
          "gemini/gemini-2.0-flash",
          "/gemini-2.5-pro",
          "",
          "gemini-1.5-pro",
        ],
        syncError: null,
      },
      {
        provider: "unsupported-provider",
        accountCount: 1,
        status: "live",
        modelIds: ["ignore-me"],
        syncError: null,
      },
    ],
  };

  const allEntries = JSON.parse(
    JSON.stringify(context.buildSidebarModelEntries(payload, "")),
  ) as ReturnType<AppContext["buildSidebarModelEntries"]>;

  assert.equal(allEntries.totalProviders, 1);
  assert.equal(allEntries.visibleProviders.length, 1);
  assert.deepEqual(allEntries.visibleProviders[0]?.modelIds, [
    "gemini/gemini-1.5-pro",
    "gemini/gemini-2.0-flash",
    "gemini/gemini-2.5-pro",
  ]);

  const filteredEntries = JSON.parse(
    JSON.stringify(context.buildSidebarModelEntries(payload, " 2.0 ")),
  ) as ReturnType<AppContext["buildSidebarModelEntries"]>;

  assert.equal(filteredEntries.normalizedSearchQuery, "2.0");
  assert.equal(filteredEntries.visibleProviders.length, 1);
  assert.deepEqual(filteredEntries.visibleProviders[0]?.modelIds, ["gemini/gemini-2.0-flash"]);

  const noMatchEntries = JSON.parse(
    JSON.stringify(context.buildSidebarModelEntries(payload, "claude-sonnet")),
  ) as ReturnType<AppContext["buildSidebarModelEntries"]>;

  assert.equal(noMatchEntries.visibleProviders.length, 0);
});
