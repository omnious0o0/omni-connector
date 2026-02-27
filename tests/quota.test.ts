import assert from "node:assert/strict";
import test from "node:test";
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
