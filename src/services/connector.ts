import { HttpError } from "../errors";
import {
  ApiLinkedAccountPayload,
  ConnectedAccount,
  DashboardAccount,
  DashboardPayload,
  DashboardTotals,
  OAuthLinkedAccountPayload,
  RouteDecision,
} from "../types";
import { AccountRepository } from "../storage/account-repository";
import {
  canServeUnits,
  compareByAvailability,
  normalizeAccountQuota,
  remainingQuota,
  toDashboardAccount,
} from "./quota";
import { OAuthProviderService } from "./oauth-provider";
import { ProviderUsageService } from "./provider-usage";

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

const DASHBOARD_SYNC_WAIT_BUDGET_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ConnectorService {
  private syncInFlight: Promise<void> | null = null;

  public constructor(
    private readonly accounts: AccountRepository,
    private readonly oauthProviderService: OAuthProviderService,
    private readonly providerUsageService: ProviderUsageService,
    private readonly strictLiveQuota: boolean,
  ) {}

  public async getDashboardPayload(): Promise<DashboardPayload> {
    await this.syncAccountStateWithBudget(DASHBOARD_SYNC_WAIT_BUDGET_MS);

    const normalized = this.accounts.normalizeQuotas(normalizeAccountQuota);

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
    this.accounts.upsertOAuthAccount(payload);
  }

  public linkApiAccount(payload: ApiLinkedAccountPayload): void {
    this.accounts.upsertApiAccount(payload, this.strictLiveQuota);
  }

  public removeAccount(accountId: string): void {
    this.accounts.removeAccount(accountId);
  }

  public rotateConnectorApiKey(): string {
    return this.accounts.rotateConnectorApiKey();
  }

  public async routeRequest(apiKey: string, units: number): Promise<RouteDecision> {
    await this.syncAccountState();

    const safeUnits = assertPositiveUnits(units);

    let decision: RouteDecision | null = null;

    this.accounts.update((draft) => {
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

      const candidates = draft.accounts.filter(
        (account) =>
          canServeUnits(account, safeUnits) &&
          (!this.strictLiveQuota || (account.quotaSyncStatus ?? "unavailable") === "live"),
      );
      if (candidates.length === 0) {
        if (this.strictLiveQuota) {
          throw new HttpError(
            503,
            "strict_live_quota_required",
            "Strict live quota mode is enabled. No account has live provider usage data.",
          );
        }

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
      if (!this.strictLiveQuota && selected.quotaSyncStatus !== "live") {
        selected.quota.fiveHour.used += safeUnits;
        selected.quota.weekly.used += safeUnits;
        selected.updatedAt = new Date().toISOString();
        quotaConsumed = true;
      }

      decision = {
        routedTo: {
          id: selected.id,
          provider: selected.provider,
          authMethod: selected.authMethod ?? "oauth",
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
    await this.ensureAccountSyncInFlight();
  }

  private async syncAccountStateWithBudget(maxWaitMs: number): Promise<void> {
    const inFlight = this.ensureAccountSyncInFlight();
    if (maxWaitMs <= 0) {
      return;
    }

    await Promise.race([inFlight, sleep(maxWaitMs)]);
  }

  private ensureAccountSyncInFlight(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.executeAccountSync()
      .catch(() => {
        return;
      })
      .finally(() => {
        this.syncInFlight = null;
      });

    return this.syncInFlight;
  }

  private shouldSyncQuota(account: ConnectedAccount): boolean {
    if (this.strictLiveQuota && (account.quotaSyncStatus ?? "unavailable") !== "live") {
      return true;
    }

    const syncedAtMs = account.quotaSyncedAt ? Date.parse(account.quotaSyncedAt) : Number.NaN;
    if (Number.isNaN(syncedAtMs)) {
      return true;
    }

    const ageMs = Date.now() - syncedAtMs;
    return ageMs >= 45_000;
  }

  private async executeAccountSync(): Promise<void> {
    const snapshot = this.accounts.read();

    for (const target of snapshot.accounts) {
      if (
        target.provider === "codex" &&
        target.refreshToken &&
        this.oauthProviderService.isTokenNearExpiry(target.tokenExpiresAt)
      ) {
        try {
          const refreshedToken = await this.oauthProviderService.refreshAccessToken(target.refreshToken);
          const nowIso = new Date().toISOString();

          this.accounts.update((draft) => {
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
          this.accounts.update((draft) => {
            const account = draft.accounts.find((candidate) => candidate.id === target.id);
            if (!account) {
              return;
            }

            account.quotaSyncStatus =
              this.strictLiveQuota || account.quota.fiveHour.limit <= 0 ? "unavailable" : "stale";
            account.quotaSyncError = message;
            account.updatedAt = new Date().toISOString();
          });
        }
      }

      if (!this.shouldSyncQuota(target)) {
        continue;
      }

      const useCodexOAuthLiveSync =
        target.provider === "codex" && (target.authMethod ?? "oauth") === "oauth";

      if (!useCodexOAuthLiveSync && !this.providerUsageService.isAccountConfigured(target)) {
        const nowIso = new Date().toISOString();
        this.accounts.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          account.quotaSyncStatus = this.strictLiveQuota ? "unavailable" : "stale";
          account.quotaSyncError =
            "Live usage adapter is not configured for this account. Configure provider usage endpoint and credentials.";
          account.quotaSyncedAt = nowIso;
          account.updatedAt = nowIso;
        });
        continue;
      }

      try {
        const liveQuota = useCodexOAuthLiveSync
          ? await this.oauthProviderService.fetchLiveQuotaSnapshot(
              target.accessToken,
              target.chatgptAccountId,
            )
          : await this.providerUsageService.fetchLiveQuotaSnapshot(target);

        if (!liveQuota) {
          const nowIso = new Date().toISOString();
          this.accounts.update((draft) => {
            const account = draft.accounts.find((candidate) => candidate.id === target.id);
            if (!account) {
              return;
            }

            account.quotaSyncStatus = this.strictLiveQuota ? "unavailable" : "stale";
            account.quotaSyncError = "Live usage endpoint returned no usable quota data.";
            account.quotaSyncedAt = nowIso;
            account.updatedAt = nowIso;
          });
          continue;
        }

        const nowIso = new Date().toISOString();

        this.accounts.update((draft) => {
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
        this.accounts.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          account.quotaSyncStatus =
            this.strictLiveQuota || account.quota.fiveHour.limit <= 0 ? "unavailable" : "stale";
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
