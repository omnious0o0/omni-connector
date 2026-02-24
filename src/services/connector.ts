import crypto from "node:crypto";
import { HttpError } from "../errors";
import { DataStore, createConnectorApiKey } from "../store";
import {
  ConnectedAccount,
  DashboardAccount,
  DashboardPayload,
  DashboardTotals,
  OAuthLinkedAccountPayload,
  RouteDecision,
} from "../types";
import {
  canServeUnits,
  compareByAvailability,
  normalizeAccountQuota,
  remainingQuota,
  toDashboardAccount,
} from "./quota";
import { OAuthProviderService } from "./oauth-provider";

function assertPositiveUnits(units: number): number {
  if (!Number.isInteger(units) || units <= 0 || units > 1000) {
    throw new HttpError(
      400,
      "invalid_units",
      "Units must be an integer between 1 and 1000.",
    );
  }

  return units;
}

function sortDashboardAccounts(accounts: DashboardAccount[]): DashboardAccount[] {
  return [...accounts].sort((a, b) => {
    const scoreDelta = b.routingScore - a.routingScore;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const weeklyDelta = b.quota.weekly.remaining - a.quota.weekly.remaining;
    if (weeklyDelta !== 0) {
      return weeklyDelta;
    }

    return b.quota.fiveHour.remaining - a.quota.fiveHour.remaining;
  });
}

function normalizeComparableIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesLinkedOAuthIdentity(
  account: ConnectedAccount,
  payload: OAuthLinkedAccountPayload,
): boolean {
  if (account.provider !== payload.provider) {
    return false;
  }

  if (account.providerAccountId === payload.providerAccountId) {
    return true;
  }

  const accountWorkspaceId = normalizeComparableIdentity(account.chatgptAccountId ?? null);
  const payloadWorkspaceId = normalizeComparableIdentity(payload.chatgptAccountId ?? null);
  if (!accountWorkspaceId || !payloadWorkspaceId || accountWorkspaceId !== payloadWorkspaceId) {
    return false;
  }

  const accountDisplayName = normalizeComparableIdentity(account.displayName);
  const payloadDisplayName = normalizeComparableIdentity(payload.displayName);
  if (!accountDisplayName || !payloadDisplayName) {
    return false;
  }

  return accountDisplayName === payloadDisplayName;
}

export class ConnectorService {
  private syncInFlight: Promise<void> | null = null;

  public constructor(
    private readonly store: DataStore,
    private readonly oauthProviderService: OAuthProviderService,
  ) {}

  public async getDashboardPayload(): Promise<DashboardPayload> {
    await this.syncAccountState();

    const normalized = this.store.update((draft) => {
      for (const account of draft.accounts) {
        normalizeAccountQuota(account);
      }
    });

    const rawAccounts = [...normalized.accounts].sort(compareByAvailability);
    const accounts = sortDashboardAccounts(rawAccounts.map((account) => toDashboardAccount(account)));
    const bestAccount =
      rawAccounts.find((account) => canServeUnits(account, 1)) !== undefined
        ? accounts[0] ?? null
        : null;

    const totals = this.calculateTotals(accounts);

    return {
      connector: normalized.connector,
      totals,
      bestAccount,
      accounts,
    };
  }

  public linkOAuthAccount(payload: OAuthLinkedAccountPayload): void {
    const nowIso = new Date().toISOString();
    const normalizedFiveHourUsed = Math.max(
      0,
      Math.min(payload.quota.fiveHourUsed ?? 0, payload.quota.fiveHourLimit),
    );
    const normalizedWeeklyUsed = Math.max(
      0,
      Math.min(payload.quota.weeklyUsed ?? 0, payload.quota.weeklyLimit),
    );

    this.store.update((draft) => {
      const existingAccount = draft.accounts.find((account) =>
        matchesLinkedOAuthIdentity(account, payload),
      );

      if (existingAccount) {
        existingAccount.providerAccountId = payload.providerAccountId;
        existingAccount.chatgptAccountId = payload.chatgptAccountId ?? existingAccount.chatgptAccountId ?? null;
        existingAccount.displayName = payload.displayName;
        existingAccount.accessToken = payload.accessToken;
        existingAccount.refreshToken = payload.refreshToken;
        existingAccount.tokenExpiresAt = payload.tokenExpiresAt;
        existingAccount.quotaSyncedAt = payload.quotaSyncedAt ?? existingAccount.quotaSyncedAt ?? null;
        existingAccount.quotaSyncStatus =
          payload.quotaSyncStatus ?? existingAccount.quotaSyncStatus ?? "unavailable";
        existingAccount.quotaSyncError = payload.quotaSyncError ?? null;
        existingAccount.planType = payload.planType ?? existingAccount.planType ?? null;
        existingAccount.creditsBalance = payload.creditsBalance ?? existingAccount.creditsBalance ?? null;
        existingAccount.quota.fiveHour.limit = payload.quota.fiveHourLimit;
        existingAccount.quota.weekly.limit = payload.quota.weeklyLimit;
        existingAccount.quota.fiveHour.used = normalizedFiveHourUsed;
        existingAccount.quota.weekly.used = normalizedWeeklyUsed;
        existingAccount.quota.fiveHour.mode = payload.quota.fiveHourMode ?? "units";
        existingAccount.quota.weekly.mode = payload.quota.weeklyMode ?? "units";
        existingAccount.quota.fiveHour.windowStartedAt =
          payload.quota.fiveHourWindowStartedAt ?? existingAccount.quota.fiveHour.windowStartedAt;
        existingAccount.quota.weekly.windowStartedAt =
          payload.quota.weeklyWindowStartedAt ?? existingAccount.quota.weekly.windowStartedAt;
        existingAccount.quota.fiveHour.resetsAt =
          payload.quota.fiveHourResetsAt ?? existingAccount.quota.fiveHour.resetsAt ?? null;
        existingAccount.quota.weekly.resetsAt =
          payload.quota.weeklyResetsAt ?? existingAccount.quota.weekly.resetsAt ?? null;
        existingAccount.updatedAt = nowIso;
        return;
      }

      draft.accounts.push({
        id: `acc_${crypto.randomUUID()}`,
        provider: payload.provider,
        providerAccountId: payload.providerAccountId,
        chatgptAccountId: payload.chatgptAccountId ?? null,
        displayName: payload.displayName,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        tokenExpiresAt: payload.tokenExpiresAt,
        createdAt: nowIso,
        updatedAt: nowIso,
        quotaSyncedAt: payload.quotaSyncedAt ?? null,
        quotaSyncStatus: payload.quotaSyncStatus ?? "unavailable",
        quotaSyncError: payload.quotaSyncError ?? null,
        planType: payload.planType ?? null,
        creditsBalance: payload.creditsBalance ?? null,
        quota: {
          fiveHour: {
            limit: payload.quota.fiveHourLimit,
            used: normalizedFiveHourUsed,
            mode: payload.quota.fiveHourMode ?? "units",
            windowStartedAt: payload.quota.fiveHourWindowStartedAt ?? nowIso,
            resetsAt: payload.quota.fiveHourResetsAt ?? null,
          },
          weekly: {
            limit: payload.quota.weeklyLimit,
            used: normalizedWeeklyUsed,
            mode: payload.quota.weeklyMode ?? "units",
            windowStartedAt: payload.quota.weeklyWindowStartedAt ?? nowIso,
            resetsAt: payload.quota.weeklyResetsAt ?? null,
          },
        },
      });
    });
  }

  public removeAccount(accountId: string): void {
    this.store.update((draft) => {
      const beforeCount = draft.accounts.length;
      draft.accounts = draft.accounts.filter((account) => account.id !== accountId);

      if (draft.accounts.length === beforeCount) {
        throw new HttpError(404, "account_not_found", "Account could not be found.");
      }
    });
  }

  public rotateConnectorApiKey(): string {
    let rotatedKey = "";
    this.store.update((draft) => {
      rotatedKey = createConnectorApiKey();
      draft.connector.apiKey = rotatedKey;
      draft.connector.lastRotatedAt = new Date().toISOString();
    });

    return rotatedKey;
  }

  public async routeRequest(apiKey: string, units: number): Promise<RouteDecision> {
    await this.syncAccountState();

    const safeUnits = assertPositiveUnits(units);

    let decision: RouteDecision | null = null;

    this.store.update((draft) => {
      if (draft.connector.apiKey !== apiKey) {
        throw new HttpError(
          401,
          "invalid_connector_key",
          "Connector API key is missing or invalid.",
        );
      }

      for (const account of draft.accounts) {
        normalizeAccountQuota(account);
      }

      const candidates = draft.accounts.filter((account) => canServeUnits(account, safeUnits));
      if (candidates.length === 0) {
        throw new HttpError(
          503,
          "no_available_accounts",
          "No account has enough remaining 5h and weekly quota for this request.",
        );
      }

      candidates.sort(compareByAvailability);
      const selected = candidates[0];
      if (!selected) {
        throw new HttpError(503, "no_route_target", "Unable to select an account.");
      }

      let quotaConsumed = false;
      if (selected.quotaSyncStatus !== "live") {
        selected.quota.fiveHour.used += safeUnits;
        selected.quota.weekly.used += safeUnits;
        selected.updatedAt = new Date().toISOString();
        quotaConsumed = true;
      }

      decision = {
        routedTo: {
          id: selected.id,
          provider: selected.provider,
          providerAccountId: selected.providerAccountId,
          displayName: selected.displayName,
        },
        unitsConsumed: safeUnits,
        quotaConsumed,
        authorizationHeader: `Bearer ${selected.accessToken}`,
        remaining: {
          fiveHour: Math.min(
            remainingQuota(selected.quota.fiveHour),
            remainingQuota(selected.quota.weekly),
          ),
          weekly: remainingQuota(selected.quota.weekly),
        },
      };
    });

    if (!decision) {
      throw new HttpError(500, "routing_failed", "Routing decision could not be produced.");
    }

    return decision;
  }

  private async syncAccountState(): Promise<void> {
    if (this.syncInFlight) {
      await this.syncInFlight;
      return;
    }

    this.syncInFlight = this.executeAccountSync();
    try {
      await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private shouldSyncQuota(account: ConnectedAccount): boolean {
    const syncedAtMs = account.quotaSyncedAt ? Date.parse(account.quotaSyncedAt) : Number.NaN;
    if (Number.isNaN(syncedAtMs)) {
      return true;
    }

    const ageMs = Date.now() - syncedAtMs;
    return ageMs >= 45_000;
  }

  private async executeAccountSync(): Promise<void> {
    const snapshot = this.store.read();

    const codexAccounts = snapshot.accounts.filter((account) => account.provider === "codex");

    for (const target of codexAccounts) {
      if (target.refreshToken && this.oauthProviderService.isTokenNearExpiry(target.tokenExpiresAt)) {
        try {
          const refreshedToken = await this.oauthProviderService.refreshAccessToken(target.refreshToken);
          const nowIso = new Date().toISOString();

          this.store.update((draft) => {
            const account = draft.accounts.find((candidate) => candidate.id === target.id);
            if (!account) {
              return;
            }

            account.accessToken = refreshedToken.accessToken;
            if (refreshedToken.refreshToken) {
              account.refreshToken = refreshedToken.refreshToken;
            }
            account.tokenExpiresAt = refreshedToken.tokenExpiresAt;
            account.updatedAt = nowIso;
          });
          target.accessToken = refreshedToken.accessToken;
          target.refreshToken = refreshedToken.refreshToken ?? target.refreshToken;
          target.tokenExpiresAt = refreshedToken.tokenExpiresAt;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to refresh access token.";
          this.store.update((draft) => {
            const account = draft.accounts.find((candidate) => candidate.id === target.id);
            if (!account) {
              return;
            }

            account.quotaSyncStatus = account.quota.fiveHour.limit > 0 ? "stale" : "unavailable";
            account.quotaSyncError = message;
            account.updatedAt = new Date().toISOString();
          });
        }
      }

      if (!this.shouldSyncQuota(target)) {
        continue;
      }

      try {
        const liveQuota = await this.oauthProviderService.fetchLiveQuotaSnapshot(
          target.accessToken,
          target.chatgptAccountId,
        );

        if (!liveQuota) {
          continue;
        }

        const nowIso = new Date().toISOString();

        this.store.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          account.quota.fiveHour.limit = liveQuota.fiveHour.limit;
          account.quota.fiveHour.used = liveQuota.fiveHour.used;
          account.quota.fiveHour.mode = liveQuota.fiveHour.mode;
          account.quota.fiveHour.windowStartedAt = liveQuota.fiveHour.windowStartedAt;
          account.quota.fiveHour.resetsAt = liveQuota.fiveHour.resetsAt;

          account.quota.weekly.limit = liveQuota.weekly.limit;
          account.quota.weekly.used = liveQuota.weekly.used;
          account.quota.weekly.mode = liveQuota.weekly.mode;
          account.quota.weekly.windowStartedAt = liveQuota.weekly.windowStartedAt;
          account.quota.weekly.resetsAt = liveQuota.weekly.resetsAt;

          account.planType = liveQuota.planType;
          account.creditsBalance = liveQuota.creditsBalance;
          account.quotaSyncedAt = liveQuota.syncedAt;
          account.quotaSyncStatus = "live";
          account.quotaSyncError = null;
          account.updatedAt = nowIso;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sync live quota.";
        this.store.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          account.quotaSyncStatus = account.quota.fiveHour.limit > 0 ? "stale" : "unavailable";
          account.quotaSyncError = message;
          account.updatedAt = new Date().toISOString();
        });
      }
    }
  }

  private calculateTotals(accounts: DashboardAccount[]): DashboardTotals {
    const totals: DashboardTotals = {
      fiveHourLimit: 0,
      fiveHourUsed: 0,
      fiveHourRemaining: 0,
      weeklyLimit: 0,
      weeklyUsed: 0,
      weeklyRemaining: 0,
    };

    for (const account of accounts) {
      totals.fiveHourLimit += account.quota.fiveHour.limit;
      totals.fiveHourUsed += account.quota.fiveHour.used;
      totals.fiveHourRemaining += account.quota.fiveHour.remaining;

      totals.weeklyLimit += account.quota.weekly.limit;
      totals.weeklyUsed += account.quota.weekly.used;
      totals.weeklyRemaining += account.quota.weekly.remaining;
    }

    return totals;
  }
}
