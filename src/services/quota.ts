import { ConnectedAccount, DashboardAccount, QuotaWindowState } from "../types";

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseTimeMs(timestamp: string): number {
  return Date.parse(timestamp);
}

function normalizeWindow(window: QuotaWindowState, durationMs: number, nowMs: number): void {
  const resetsAtMs = window.resetsAt ? parseTimeMs(window.resetsAt) : Number.NaN;
  if (!Number.isNaN(resetsAtMs) && nowMs >= resetsAtMs) {
    window.used = 0;
    window.windowStartedAt = new Date(nowMs).toISOString();
    window.resetsAt = null;
  }

  const startMs = parseTimeMs(window.windowStartedAt);
  if (Number.isNaN(startMs)) {
    window.windowStartedAt = new Date(nowMs).toISOString();
  }

  const safeStartMs = Number.isNaN(startMs) ? nowMs : startMs;
  if (Number.isNaN(resetsAtMs) && nowMs - safeStartMs >= durationMs) {
    window.used = 0;
    window.windowStartedAt = new Date(nowMs).toISOString();
  }

  if (window.used < 0) {
    window.used = 0;
  }

  if (window.limit < 0) {
    window.limit = 0;
  }

  if (window.used > window.limit) {
    window.used = window.limit;
  }
}

function lockFiveHourWindowWhenWeeklyExhausted(account: ConnectedAccount, nowMs: number): void {
  const weeklyRemaining = remainingQuota(account.quota.weekly);
  if (weeklyRemaining > 0) {
    return;
  }

  account.quota.fiveHour.used = account.quota.fiveHour.limit;
  account.quota.fiveHour.windowStartedAt = new Date(nowMs).toISOString();
  account.quota.fiveHour.resetsAt = null;
}

export function normalizeAccountQuota(account: ConnectedAccount, nowMs: number = Date.now()): void {
  normalizeWindow(account.quota.fiveHour, FIVE_HOUR_WINDOW_MS, nowMs);
  normalizeWindow(account.quota.weekly, WEEK_WINDOW_MS, nowMs);
  lockFiveHourWindowWhenWeeklyExhausted(account, nowMs);
}

export function remainingQuota(window: QuotaWindowState): number {
  return Math.max(window.limit - window.used, 0);
}

function remainingRatio(window: QuotaWindowState): number {
  if (window.limit <= 0) {
    return 0;
  }

  return remainingQuota(window) / window.limit;
}

function effectiveFiveHourRemaining(account: ConnectedAccount): number {
  const fiveHourRemaining = remainingQuota(account.quota.fiveHour);
  const weeklyRemaining = remainingQuota(account.quota.weekly);
  return Math.min(fiveHourRemaining, weeklyRemaining);
}

export function calculateRoutingScore(account: ConnectedAccount): number {
  const fiveHourRatio = remainingRatio(account.quota.fiveHour);
  const weeklyRatio = remainingRatio(account.quota.weekly);

  return Number(Math.min(fiveHourRatio, weeklyRatio).toFixed(4));
}

export function canServeUnits(account: ConnectedAccount, units: number): boolean {
  return (
    remainingQuota(account.quota.fiveHour) >= units &&
    remainingQuota(account.quota.weekly) >= units
  );
}

export function compareByAvailability(a: ConnectedAccount, b: ConnectedAccount): number {
  const scoreDelta = calculateRoutingScore(b) - calculateRoutingScore(a);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const weeklyDelta = remainingQuota(b.quota.weekly) - remainingQuota(a.quota.weekly);
  if (weeklyDelta !== 0) {
    return weeklyDelta;
  }

  const fiveHourDelta = remainingQuota(b.quota.fiveHour) - remainingQuota(a.quota.fiveHour);
  if (fiveHourDelta !== 0) {
    return fiveHourDelta;
  }

  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function toDashboardAccount(account: ConnectedAccount): DashboardAccount {
  const fiveHourRemaining = effectiveFiveHourRemaining(account);
  const weeklyRemaining = remainingQuota(account.quota.weekly);

  return {
    id: account.id,
    provider: account.provider,
    authMethod: account.authMethod ?? "oauth",
    oauthProfileId: account.oauthProfileId,
    providerAccountId: account.providerAccountId,
    chatgptAccountId: account.chatgptAccountId ?? null,
    displayName: account.displayName,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    quotaSyncedAt: account.quotaSyncedAt ?? null,
    quotaSyncStatus: account.quotaSyncStatus ?? "unavailable",
    quotaSyncError: account.quotaSyncError ?? null,
    planType: account.planType ?? null,
    creditsBalance: account.creditsBalance ?? null,
    quota: {
      fiveHour: {
        limit: account.quota.fiveHour.limit,
        used: account.quota.fiveHour.used,
        mode: account.quota.fiveHour.mode ?? "units",
        remaining: fiveHourRemaining,
        resetsAt: account.quota.fiveHour.resetsAt ?? null,
        remainingRatio:
          account.quota.fiveHour.limit <= 0
            ? 0
            : fiveHourRemaining / account.quota.fiveHour.limit,
      },
      weekly: {
        limit: account.quota.weekly.limit,
        used: account.quota.weekly.used,
        mode: account.quota.weekly.mode ?? "units",
        remaining: weeklyRemaining,
        resetsAt: account.quota.weekly.resetsAt ?? null,
        remainingRatio:
          account.quota.weekly.limit <= 0
            ? 0
            : weeklyRemaining / account.quota.weekly.limit,
      },
    },
    routingScore: calculateRoutingScore(account),
  };
}
