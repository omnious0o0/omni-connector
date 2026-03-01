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
  HTMLElement: {
    new (): {
      closest: (selector: string) => unknown;
      dataset?: Record<string, string | undefined>;
      parentElement?: unknown;
    };
  };
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
  shouldShowSidebarModelSearchClearButton: (value: unknown) => boolean;
  sidebarProviderIssueView: (entry: unknown) => {
    severity: string;
    icon: string;
    title: string;
    items: string[];
    action: string;
    actionLabel: string;
  } | null;
  collectTopbarIssues: () => Array<{
    type: string;
    message: string;
    accountId: string | null;
    action: string | null;
  }>;
  computeOverallQuotaRemainingPercent: (accounts: unknown[]) => number | null;
  buildDashboardApiBalanceMetrics: (accounts: unknown[]) => {
    value: string;
    detail: string;
    accountCount: number;
    liveBalanceCount: number;
  } | null;
  buildQuotaWindowView: (windowData: unknown, quotaSyncedAt: unknown) => Record<string, unknown>;
  connectionsHeadingText: (value: unknown) => string;
  copySidebarModelId: (fullModelId: unknown) => Promise<void>;
  composeProviderModelId: (providerId: unknown, modelId: unknown) => string;
  formatBalanceValue: (value: unknown) => string;
  matchesSidebarModelSearch: (modelId: unknown, normalizedSearchQuery: unknown) => boolean;
  normalizeSidebarModelSearchQuery: (value: unknown) => string;
  normalizedAccountQuotaWindows: (account: unknown) => unknown[];
  topbarIssueTooltipPayload: (
    type: unknown,
    issues: unknown,
  ) => {
    title: string;
    items: string[];
    action: string | null;
    actionLabel: string;
    accountId: string | null;
  } | null;
  warningActionLabel: (action: unknown) => string;
  warningDataItems: (items: unknown) => string;
  warningItemsFromTrigger: (trigger: unknown) => string[];
  renderApiBalanceBlock: (account: unknown) => string;
  resolveCurrentModelMetric: () => {
    value: string;
    detail: string;
  };
  reRenderIcons: () => void;
  resolveQuotaWindowLabel: (account: unknown, slot: string, windowView: unknown) => string;
  quotaWindowSignature: (windowView: unknown) => string;
  __documentListeners?: Map<string, Array<(event: { target: unknown }) => unknown>>;
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

  const documentListeners = new Map<string, Array<(event: { target: unknown }) => unknown>>();

  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (eventType: string, listener: ((event: { target: unknown }) => unknown) | null) => {
      if (typeof listener !== "function") {
        return;
      }

      const existing = documentListeners.get(eventType) ?? [];
      existing.push(listener);
      documentListeners.set(eventType, existing);
    },
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
  context.__documentListeners = documentListeners;
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

test("frontend weekly quota cap limits shorter quota windows", () => {
  const context = loadFrontendAppContext();
  const exhaustedWeeklyAccount = createAccountState();

  exhaustedWeeklyAccount.quota.fiveHour.used = 0;
  exhaustedWeeklyAccount.quota.weekly.used = 100;

  const exhaustedWindows = JSON.parse(
    JSON.stringify(context.normalizedAccountQuotaWindows(toDashboardAccount(exhaustedWeeklyAccount))),
  ) as Array<{
    slot: string;
    ratio: number;
    value: string;
    remaining: number;
  }>;

  const exhaustedFiveHour = exhaustedWindows.find((windowView) => windowView.slot === "fiveHour");
  const exhaustedWeekly = exhaustedWindows.find((windowView) => windowView.slot === "weekly");

  assert.ok(exhaustedFiveHour);
  assert.ok(exhaustedWeekly);
  assert.equal(exhaustedWeekly?.ratio, 0);
  assert.equal(exhaustedFiveHour?.ratio, 0);
  assert.equal(exhaustedFiveHour?.value.includes("0%"), true);
  assert.equal(exhaustedFiveHour?.remaining, 0);

  const limitedWeeklyAccount = createAccountState();
  limitedWeeklyAccount.quota.fiveHour.limit = 100;
  limitedWeeklyAccount.quota.fiveHour.used = 0;
  limitedWeeklyAccount.quota.weekly.limit = 1000;
  limitedWeeklyAccount.quota.weekly.used = 950;

  const limitedWindows = JSON.parse(
    JSON.stringify(context.normalizedAccountQuotaWindows(toDashboardAccount(limitedWeeklyAccount))),
  ) as Array<{
    slot: string;
    ratio: number;
    value: string;
    remaining: number;
  }>;

  const limitedFiveHour = limitedWindows.find((windowView) => windowView.slot === "fiveHour");
  const limitedWeekly = limitedWindows.find((windowView) => windowView.slot === "weekly");

  assert.ok(limitedFiveHour);
  assert.ok(limitedWeekly);
  assert.equal(Math.round((limitedWeekly?.ratio ?? 0) * 100), 5);
  assert.equal(Math.round((limitedFiveHour?.ratio ?? 0) * 100), 50);
  assert.equal(limitedFiveHour?.remaining, 50);
  assert.equal(limitedFiveHour?.value.includes("50%"), true);
});

test("frontend sidebar model helpers normalize IDs and queries", () => {
  const context = loadFrontendAppContext();

  assert.equal(context.normalizeSidebarModelSearchQuery("  gemini  "), "gemini");
  assert.equal(context.normalizeSidebarModelSearchQuery(null), "");

  assert.equal(context.composeProviderModelId("gemini", "gemini-2.5-pro"), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("gemini", " gemini/gemini-2.5-pro "), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("gemini", "/gemini-2.5-pro"), "gemini/gemini-2.5-pro");
  assert.equal(context.composeProviderModelId("gemini", "openrouter/deepseek-r1"), "openrouter/deepseek-r1");
  assert.equal(context.composeProviderModelId("gemini", "vendor/custom-model"), "gemini/vendor/custom-model");
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
          "GEMINI/gemini-2.5-pro",
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

  const nullQueryEntries = JSON.parse(
    JSON.stringify(context.buildSidebarModelEntries(payload, null)),
  ) as ReturnType<AppContext["buildSidebarModelEntries"]>;

  assert.equal(nullQueryEntries.normalizedSearchQuery, "");
  assert.equal(nullQueryEntries.visibleProviders.length, 1);
  assert.deepEqual(nullQueryEntries.visibleProviders[0]?.modelIds, [
    "gemini/gemini-1.5-pro",
    "gemini/gemini-2.0-flash",
    "gemini/gemini-2.5-pro",
  ]);
});

test("frontend sidebar search matches case-insensitive multi-token queries", () => {
  const context = loadFrontendAppContext();

  const payload = {
    providers: [
      {
        provider: "gemini",
        accountCount: 1,
        status: "live",
        modelIds: ["gemini-2.5-pro-preview", "gemini-2.0-flash"],
        syncError: null,
      },
    ],
  };

  const tokenFiltered = JSON.parse(
    JSON.stringify(context.buildSidebarModelEntries(payload, " GEmini   2.5   pro ")),
  ) as ReturnType<AppContext["buildSidebarModelEntries"]>;

  assert.equal(tokenFiltered.visibleProviders.length, 1);
  assert.deepEqual(tokenFiltered.visibleProviders[0]?.modelIds, ["gemini/gemini-2.5-pro-preview"]);

  assert.equal(context.matchesSidebarModelSearch("gemini/gemini-2.5-pro-preview", "2.5 preview"), true);
  assert.equal(context.matchesSidebarModelSearch("gemini/gemini-2.5-pro-preview", "2.5 sonnet"), false);
});

test("frontend sidebar search clear helper only shows clear action for non-empty query", () => {
  const context = loadFrontendAppContext();

  assert.equal(context.shouldShowSidebarModelSearchClearButton(""), false);
  assert.equal(context.shouldShowSidebarModelSearchClearButton("   "), false);
  assert.equal(context.shouldShowSidebarModelSearchClearButton("gemini"), true);
  assert.equal(context.shouldShowSidebarModelSearchClearButton("  gemini  "), true);
});

test("frontend sidebar provider issue view maps severity and action metadata", () => {
  const context = loadFrontendAppContext();

  const noIssue = context.sidebarProviderIssueView({
    status: "live",
    syncError: "",
  });
  assert.equal(noIssue, null);

  const warningIssue = JSON.parse(
    JSON.stringify(
      context.sidebarProviderIssueView({
        status: "live",
        syncError: "quota sync delayed",
      }),
    ),
  ) as ReturnType<AppContext["sidebarProviderIssueView"]>;
  assert.deepEqual(warningIssue, {
    severity: "warning",
    icon: "triangle-alert",
    title: "Sync issue",
    items: ["quota sync delayed"],
    action: "open-settings-page",
    actionLabel: "Open settings",
  });

  const errorIssue = JSON.parse(
    JSON.stringify(
      context.sidebarProviderIssueView({
        status: "unavailable",
        syncError: "provider usage endpoint failed",
      }),
    ),
  ) as ReturnType<AppContext["sidebarProviderIssueView"]>;
  assert.deepEqual(errorIssue, {
    severity: "error",
    icon: "circle-alert",
    title: "Sync issue",
    items: ["provider usage endpoint failed"],
    action: "open-settings-page",
    actionLabel: "Open settings",
  });
});

test("frontend copySidebarModelId handles success, empty id, and missing clipboard", async () => {
  const context = loadFrontendAppContext();
  const contextState = context as unknown as {
    navigator: {
      clipboard: {
        writeText: (value: string) => Promise<void>;
      } | null;
    };
  };

  const writes: string[] = [];
  contextState.navigator.clipboard = {
    writeText: async (value: string) => {
      writes.push(value);
    },
  };

  await context.copySidebarModelId(" gemini/gemini-2.5-pro ");
  assert.deepEqual(writes, ["gemini/gemini-2.5-pro"]);

  await context.copySidebarModelId("   ");
  assert.deepEqual(writes, ["gemini/gemini-2.5-pro"]);

  contextState.navigator.clipboard = null;
  await assert.rejects(
    () => context.copySidebarModelId("gemini/gemini-2.5-pro"),
    /Clipboard is unavailable in this browser/,
  );
});

test("frontend click handler surfaces clipboard write failures for model copy", async () => {
  const context = loadFrontendAppContext();
  const contextState = context as unknown as {
    navigator: {
      clipboard: {
        writeText: (value: string) => Promise<void>;
      };
    };
    __testToasts: Array<{ message: string; isError: boolean }>;
  };

  contextState.__testToasts = [];
  vm.runInContext(
    `showToast = (message, isError = false) => { __testToasts.push({ message: String(message), isError: Boolean(isError) }); };`,
    context,
  );

  contextState.navigator.clipboard.writeText = async () => {
    throw new Error("clipboard offline");
  };

  const listeners = context.__documentListeners?.get("click") ?? [];
  assert.equal(listeners.length > 0, true);
  const clickHandler = listeners[0];
  assert.equal(typeof clickHandler, "function");

  const target = new context.HTMLElement();
  target.dataset = {
    copyModelId: "gemini/gemini-2.5-pro",
  };
  target.closest = (selector: string) =>
    selector === "[data-copy-model-id]" ? target : null;

  await clickHandler?.({ target });

  const normalizedToasts = JSON.parse(
    JSON.stringify(contextState.__testToasts),
  ) as Array<{ message: string; isError: boolean }>;
  assert.deepEqual(normalizedToasts, [{ message: "clipboard offline", isError: true }]);
});

test("frontend quota label fallback uses API balance wording for API-linked accounts", () => {
  const context = loadFrontendAppContext();

  const apiLabel = context.resolveQuotaWindowLabel(
    {
      authMethod: "api",
      provider: "openrouter",
    },
    "fiveHour",
    {
      cadenceLabel: "",
      explicitLabel: "",
    },
  );
  assert.equal(apiLabel, "API balance");

  const oauthLabel = context.resolveQuotaWindowLabel(
    {
      authMethod: "oauth",
      provider: "gemini",
      oauthProfileId: "gemini-cli",
    },
    "fiveHour",
    {
      cadenceLabel: "",
      explicitLabel: "",
    },
  );
  assert.equal(oauthLabel, "Quota");
});

test("frontend API balance helpers render readable values and account metrics", () => {
  const context = loadFrontendAppContext();

  assert.match(context.formatBalanceValue("$1,234.50"), /1/);
  assert.match(context.formatBalanceValue("credits: 80"), /80/);
  assert.equal(context.formatBalanceValue("").includes("$"), true);
  assert.equal(context.formatBalanceValue("").includes("0.00"), true);

  const balanceMarkup = context.renderApiBalanceBlock({
    authMethod: "api",
    creditsBalance: "125.25",
    planType: "pro",
  });
  assert.equal(balanceMarkup.includes("API balance"), true);
  assert.equal(balanceMarkup.includes("125"), true);
  assert.equal(balanceMarkup.includes("pro plan"), false);

  const fallbackMarkup = context.renderApiBalanceBlock({
    authMethod: "api",
  });
  assert.equal(fallbackMarkup.includes("API balance"), true);
  assert.equal(fallbackMarkup.includes("api-balance-only"), true);
  assert.equal(fallbackMarkup.includes("quota-track"), false);
  assert.equal(fallbackMarkup.includes("$"), true);
  assert.equal(fallbackMarkup.includes("0.00"), true);

  const nonNumericMarkup = context.renderApiBalanceBlock({
    authMethod: "api",
    creditsBalance: "unavailable",
  });
  assert.equal(nonNumericMarkup.includes("$"), true);
  assert.equal(nonNumericMarkup.includes("0.00"), true);

  const summary = context.buildDashboardApiBalanceMetrics([
    {
      authMethod: "api",
      creditsBalance: "10",
    },
    {
      authMethod: "api",
      creditsBalance: "20",
    },
  ]);

  assert.ok(summary);
  assert.match(String(summary?.value ?? ""), /30\.00/);
  assert.equal(summary?.accountCount, 2);
  assert.equal(summary?.liveBalanceCount, 2);
  assert.match(String(summary?.detail ?? ""), /2 API connections with live balance/);
});

test("frontend connections heading helper formats connection counts", () => {
  const context = loadFrontendAppContext();

  assert.equal(context.connectionsHeadingText(0), "Connections 0");
  assert.equal(context.connectionsHeadingText(3.6), "Connections 4");
  assert.equal(context.connectionsHeadingText(-2), "Connections 0");
  assert.equal(context.connectionsHeadingText(Number.NaN), "Connections 0");
});

test("frontend API balance summary includes API subset in mixed auth dashboards", () => {
  const context = loadFrontendAppContext();

  const mixedSummary = context.buildDashboardApiBalanceMetrics([
    {
      authMethod: "api",
      creditsBalance: "10",
    },
    {
      authMethod: "oauth",
      creditsBalance: "90",
    },
  ]);

  assert.ok(mixedSummary);
  assert.equal(mixedSummary?.accountCount, 1);
  assert.equal(mixedSummary?.liveBalanceCount, 1);
  assert.match(String(mixedSummary?.value ?? ""), /10\.00/);
});

test("frontend API balance summary detects mixed currencies without unsafe aggregation", () => {
  const context = loadFrontendAppContext();

  const mixedCurrencies = context.buildDashboardApiBalanceMetrics([
    {
      authMethod: "api",
      creditsBalance: "$10",
    },
    {
      authMethod: "api",
      creditsBalance: "€20",
    },
  ]);

  assert.ok(mixedCurrencies);
  assert.match(String(mixedCurrencies?.detail ?? ""), /mixed currencies/);
});

test("frontend overall quota metric computes weighted remaining percentage", () => {
  const context = loadFrontendAppContext();

  const first = createAccountState();
  first.provider = "codex";
  first.displayName = "Codex A";
  first.quota.fiveHour.limit = 100;
  first.quota.fiveHour.used = 50;
  first.quota.weekly.limit = 100;
  first.quota.weekly.used = 20;

  const second = createAccountState();
  second.provider = "gemini";
  second.displayName = "Gemini B";
  second.quota.fiveHour.limit = 100;
  second.quota.fiveHour.used = 80;
  second.quota.weekly.limit = 100;
  second.quota.weekly.used = 0;

  const remaining = context.computeOverallQuotaRemainingPercent([
    toDashboardAccount(first),
    toDashboardAccount(second),
  ]);

  assert.ok(remaining !== null);
  assert.equal(Math.round(Number(remaining)), 35);
});

test("frontend current model metric follows routing preferences", () => {
  const context = loadFrontendAppContext();

  vm.runInContext(
    `dashboard = { connector: { routingPreferences: { priorityModels: ["gpt-5-mini"] } }, accounts: [] };`,
    context,
  );
  const pinned = context.resolveCurrentModelMetric();
  assert.equal(pinned.value, "gpt-5-mini");
  assert.match(pinned.detail, /Pinned/);

  vm.runInContext(
    `dashboard = { connector: { routingPreferences: { priorityModels: ["auto"] } }, accounts: [] };`,
    context,
  );
  const automatic = context.resolveCurrentModelMetric();
  assert.equal(automatic.value, "auto");
  assert.match(automatic.detail, /automatically/);
});

test("frontend warning helper functions encode decode and label actions consistently", () => {
  const context = loadFrontendAppContext();

  const encoded = context.warningDataItems([
    " first warning ",
    "",
    "Second warning",
  ]);
  assert.equal(encoded, "first%20warning|Second%20warning");

  const trigger = new context.HTMLElement();
  trigger.dataset = {
    warningItems: `${encoded}|%E0%A4%A`,
  };

  const decodedWarnings = JSON.parse(
    JSON.stringify(context.warningItemsFromTrigger(trigger)),
  ) as string[];
  assert.deepEqual(decodedWarnings, ["first warning", "Second warning"]);

  assert.equal(context.warningActionLabel("open-account-settings"), "Open settings");
  assert.equal(context.warningActionLabel("open-connect"), "Open Connect");
  assert.equal(context.warningActionLabel("open-settings-page"), "Open settings");
  assert.equal(context.warningActionLabel("refresh-dashboard"), "Refresh now");
  assert.equal(context.warningActionLabel("unknown"), "");
});

test("frontend topbar tooltip payload keeps severity messages and routes actions", () => {
  const context = loadFrontendAppContext();

  const issues = [
    {
      type: "error",
      message: "Gemini API: Balance fetch failed",
      accountId: "acc1",
      action: null,
    },
    {
      type: "error",
      message: "Second hard failure",
      accountId: null,
      action: "refresh-dashboard",
    },
    {
      type: "warning",
      message: "Provider warning",
      accountId: null,
      action: "open-connect",
    },
  ];

  const errorPayload = context.topbarIssueTooltipPayload("error", issues);
  assert.ok(errorPayload);
  assert.equal(errorPayload?.title, "Errors");
  assert.deepEqual(errorPayload?.items, [
    "Gemini API: Balance fetch failed",
    "Second hard failure",
  ]);
  assert.equal(errorPayload?.action, "open-account-settings");
  assert.equal(errorPayload?.actionLabel, "Open settings");
  assert.equal(errorPayload?.accountId, "acc1");

  const warningPayload = context.topbarIssueTooltipPayload("warning", issues);
  assert.ok(warningPayload);
  assert.equal(warningPayload?.title, "Warnings");
  assert.deepEqual(warningPayload?.items, ["Provider warning"]);
  assert.equal(warningPayload?.action, "open-connect");
  assert.equal(warningPayload?.actionLabel, "Open Connect");
  assert.equal(warningPayload?.accountId, null);

  const emptyPayload = context.topbarIssueTooltipPayload("info", issues);
  assert.equal(emptyPayload, null);
});

test("frontend topbar issue collector groups errors warnings and notifications", () => {
  const context = loadFrontendAppContext();

  vm.runInContext(
    `
      statusError = true;
      dashboardLoaded = true;
      dashboard = {
        accounts: [
          {
            id: "acc1",
            displayName: "Gemini API",
            quotaSyncStatus: "unavailable",
            quotaSyncError: "Balance fetch failed",
            authMethod: "api"
          }
        ],
        connector: { routingPreferences: { priorityModels: ["auto"] } }
      };
      connectProviders = [
        { id: "gemini", name: "Gemini", warnings: ["Rate limits are unstable"] }
      ];
    `,
    context,
  );

  const issues = JSON.parse(
    JSON.stringify(context.collectTopbarIssues()),
  ) as ReturnType<AppContext["collectTopbarIssues"]>;
  const counts = issues.reduce(
    (accumulator, issue) => {
      const key = issue.type as "error" | "warning" | "info";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    },
    { error: 0, warning: 0, info: 0 } as Record<"error" | "warning" | "info", number>,
  );

  assert.equal(counts.error >= 1, true);
  assert.equal(counts.warning >= 1, true);

  vm.runInContext(
    `
      statusError = false;
      dashboardLoaded = true;
      dashboard = { accounts: [], connector: { routingPreferences: { priorityModels: ["auto"] } } };
      connectProviders = [];
    `,
    context,
  );

  const infoIssues = JSON.parse(
    JSON.stringify(context.collectTopbarIssues()),
  ) as ReturnType<AppContext["collectTopbarIssues"]>;
  assert.equal(infoIssues.some((issue) => issue.type === "info"), true);
});

test("frontend icon rerender marks lucide svgs as decorative", () => {
  const context = loadFrontendAppContext();

  const iconA = {
    attrs: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value);
    },
  };
  const iconB = {
    attrs: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value);
    },
  };

  let createIconsCalls = 0;
  const lucideStub = {
    createIcons() {
      createIconsCalls += 1;
    },
  };

  const documentStub = context.document as {
    querySelectorAll: (selector: string) => unknown[];
  };
  documentStub.querySelectorAll = (selector: string) => {
    if (selector === "svg.lucide") {
      return [iconA, iconB];
    }

    return [];
  };

  const windowStub = context.window as {
    lucide: { createIcons: () => void } | null;
  };
  windowStub.lucide = lucideStub;
  context.lucide = lucideStub;

  context.reRenderIcons();

  assert.equal(createIconsCalls, 1);
  assert.equal(iconA.attrs.get("aria-hidden"), "true");
  assert.equal(iconA.attrs.get("focusable"), "false");
  assert.equal(iconB.attrs.get("aria-hidden"), "true");
  assert.equal(iconB.attrs.get("focusable"), "false");
});
