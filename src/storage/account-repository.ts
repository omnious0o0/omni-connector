import crypto from "node:crypto";
import { HttpError } from "../errors";
import { DataStore, createConnectorApiKey } from "../store";
import {
  AccountSettingsUpdatePayload,
  ApiLinkedAccountPayload,
  ConnectedAccount,
  OAuthLinkedAccountPayload,
  PersistedData,
  RoutingPreferences,
} from "../types";

function normalizeComparableIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeApiProviderAccountId(providerAccountId: string, apiKey: string): string {
  const trimmed = providerAccountId.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  const stableHash = crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
  return `api_${stableHash}`;
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

const API_DEFAULT_FIVE_HOUR_LIMIT = 50_000;
const API_DEFAULT_WEEKLY_LIMIT = 500_000;
const API_DEFAULT_TOKEN_EXPIRES_AT = "2999-01-01T00:00:00.000Z";

export class AccountRepository {
  public constructor(private readonly store: DataStore) {}

  public read(): PersistedData {
    return this.store.read();
  }

  public update(mutator: (draft: PersistedData) => void): PersistedData {
    return this.store.update(mutator);
  }

  public routingPreferences(): RoutingPreferences {
    return this.store.read().connector.routingPreferences;
  }

  public updateRoutingPreferences(preferences: RoutingPreferences): RoutingPreferences {
    let nextPreferences = preferences;

    this.store.update((draft) => {
      draft.connector.routingPreferences = {
        preferredProvider: preferences.preferredProvider,
        fallbackProviders: [...preferences.fallbackProviders],
        priorityModels: [...preferences.priorityModels],
      };
      nextPreferences = draft.connector.routingPreferences;
    });

    return nextPreferences;
  }

  public normalizeQuotas(normalize: (account: ConnectedAccount) => void): PersistedData {
    return this.store.update((draft) => {
      for (const account of draft.accounts) {
        normalize(account);
      }
    });
  }

  public upsertOAuthAccount(payload: OAuthLinkedAccountPayload): void {
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
        (account.authMethod ?? "oauth") === "oauth" && matchesLinkedOAuthIdentity(account, payload),
      );

      if (existingAccount) {
        existingAccount.authMethod = "oauth";
        existingAccount.oauthProfileId = payload.oauthProfileId ?? existingAccount.oauthProfileId;
        existingAccount.providerAccountId = payload.providerAccountId;
        existingAccount.chatgptAccountId = payload.chatgptAccountId ?? existingAccount.chatgptAccountId ?? null;
        existingAccount.displayName = payload.displayName;
        existingAccount.accessToken = payload.accessToken;
        existingAccount.refreshToken = payload.refreshToken;
        existingAccount.tokenExpiresAt = payload.tokenExpiresAt;
        existingAccount.quotaSyncedAt = payload.quotaSyncedAt ?? null;
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
        existingAccount.quota.fiveHour.label = payload.quota.fiveHourLabel ?? existingAccount.quota.fiveHour.label ?? null;
        existingAccount.quota.weekly.label = payload.quota.weeklyLabel ?? existingAccount.quota.weekly.label ?? null;
        existingAccount.quota.fiveHour.windowMinutes =
          payload.quota.fiveHourWindowMinutes ?? existingAccount.quota.fiveHour.windowMinutes ?? null;
        existingAccount.quota.weekly.windowMinutes =
          payload.quota.weeklyWindowMinutes ?? existingAccount.quota.weekly.windowMinutes ?? null;
        existingAccount.quota.fiveHour.windowStartedAt =
          payload.quota.fiveHourWindowStartedAt ?? existingAccount.quota.fiveHour.windowStartedAt;
        existingAccount.quota.weekly.windowStartedAt =
          payload.quota.weeklyWindowStartedAt ?? existingAccount.quota.weekly.windowStartedAt;
        existingAccount.quota.fiveHour.resetsAt =
          payload.quota.fiveHourResetsAt ?? existingAccount.quota.fiveHour.resetsAt ?? null;
        existingAccount.quota.weekly.resetsAt =
          payload.quota.weeklyResetsAt ?? existingAccount.quota.weekly.resetsAt ?? null;
        existingAccount.estimatedUsageSampleCount = 0;
        existingAccount.estimatedUsageTotalUnits = 0;
        existingAccount.estimatedUsageUpdatedAt = null;
        existingAccount.updatedAt = nowIso;
        return;
      }

      draft.accounts.push({
        id: `acc_${crypto.randomUUID()}`,
        provider: payload.provider,
        authMethod: "oauth",
        oauthProfileId: payload.oauthProfileId,
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
        estimatedUsageSampleCount: 0,
        estimatedUsageTotalUnits: 0,
        estimatedUsageUpdatedAt: null,
        planType: payload.planType ?? null,
        creditsBalance: payload.creditsBalance ?? null,
        quota: {
          fiveHour: {
            limit: payload.quota.fiveHourLimit,
            used: normalizedFiveHourUsed,
            mode: payload.quota.fiveHourMode ?? "units",
            label: payload.quota.fiveHourLabel ?? null,
            windowMinutes: payload.quota.fiveHourWindowMinutes ?? null,
            windowStartedAt: payload.quota.fiveHourWindowStartedAt ?? nowIso,
            resetsAt: payload.quota.fiveHourResetsAt ?? null,
          },
          weekly: {
            limit: payload.quota.weeklyLimit,
            used: normalizedWeeklyUsed,
            mode: payload.quota.weeklyMode ?? "units",
            label: payload.quota.weeklyLabel ?? null,
            windowMinutes: payload.quota.weeklyWindowMinutes ?? null,
            windowStartedAt: payload.quota.weeklyWindowStartedAt ?? nowIso,
            resetsAt: payload.quota.weeklyResetsAt ?? null,
          },
        },
      });
    });
  }

  public upsertApiAccount(payload: ApiLinkedAccountPayload, strictLiveQuota: boolean): void {
    const apiKey = payload.apiKey.trim();
    if (apiKey.length === 0) {
      throw new HttpError(400, "missing_api_key", "API key is required.");
    }

    const providerAccountId = normalizeApiProviderAccountId(payload.providerAccountId, apiKey);
    const fallbackLabel = `${payload.provider.toUpperCase()} API Key`;
    const displayName = payload.displayName.trim() || fallbackLabel;
    const manualFiveHourLimit =
      typeof payload.manualFiveHourLimit === "number"
        ? Math.max(0, Math.round(payload.manualFiveHourLimit))
        : null;
    const manualWeeklyLimit =
      typeof payload.manualWeeklyLimit === "number"
        ? Math.max(0, Math.round(payload.manualWeeklyLimit))
        : null;
    const effectiveFiveHourLimit =
      manualFiveHourLimit !== null && manualFiveHourLimit > 0
        ? manualFiveHourLimit
        : API_DEFAULT_FIVE_HOUR_LIMIT;
    const effectiveWeeklyLimit =
      manualWeeklyLimit !== null && manualWeeklyLimit > 0
        ? manualWeeklyLimit
        : API_DEFAULT_WEEKLY_LIMIT;
    const nowIso = new Date().toISOString();

    this.store.update((draft) => {
      const existingAccount = draft.accounts.find(
        (account) =>
          account.provider === payload.provider &&
          (account.authMethod ?? "oauth") === "api" &&
          account.providerAccountId === providerAccountId,
      );

      if (existingAccount) {
        existingAccount.authMethod = "api";
        existingAccount.displayName = displayName;
        existingAccount.accessToken = apiKey;
        existingAccount.refreshToken = null;
        existingAccount.tokenExpiresAt = API_DEFAULT_TOKEN_EXPIRES_AT;
        existingAccount.quotaSyncedAt = null;
        existingAccount.quotaSyncStatus = strictLiveQuota ? "unavailable" : "stale";
        existingAccount.quotaSyncError = null;
        existingAccount.planType = null;
        existingAccount.creditsBalance = null;
        existingAccount.quota.fiveHour.limit =
          manualFiveHourLimit !== null && manualFiveHourLimit > 0
            ? manualFiveHourLimit
            : existingAccount.quota.fiveHour.limit > 0
              ? existingAccount.quota.fiveHour.limit
              : API_DEFAULT_FIVE_HOUR_LIMIT;
        existingAccount.quota.weekly.limit =
          manualWeeklyLimit !== null && manualWeeklyLimit > 0
            ? manualWeeklyLimit
            : existingAccount.quota.weekly.limit > 0
              ? existingAccount.quota.weekly.limit
              : API_DEFAULT_WEEKLY_LIMIT;
        existingAccount.quota.fiveHour.used = Math.min(
          existingAccount.quota.fiveHour.used,
          existingAccount.quota.fiveHour.limit,
        );
        existingAccount.quota.weekly.used = Math.min(
          existingAccount.quota.weekly.used,
          existingAccount.quota.weekly.limit,
        );
        existingAccount.quota.fiveHour.mode = "units";
        existingAccount.quota.weekly.mode = "units";
        existingAccount.quota.fiveHour.label = null;
        existingAccount.quota.weekly.label = null;
        existingAccount.quota.fiveHour.windowMinutes = null;
        existingAccount.quota.weekly.windowMinutes = null;
        existingAccount.quota.fiveHour.windowStartedAt = nowIso;
        existingAccount.quota.weekly.windowStartedAt = nowIso;
        existingAccount.quota.fiveHour.resetsAt = null;
        existingAccount.quota.weekly.resetsAt = null;
        existingAccount.updatedAt = nowIso;
        return;
      }

      draft.accounts.push({
        id: `acc_${crypto.randomUUID()}`,
        provider: payload.provider,
        authMethod: "api",
        providerAccountId,
        chatgptAccountId: null,
        displayName,
        accessToken: apiKey,
        refreshToken: null,
        tokenExpiresAt: API_DEFAULT_TOKEN_EXPIRES_AT,
        createdAt: nowIso,
        updatedAt: nowIso,
        quotaSyncedAt: null,
        quotaSyncStatus: strictLiveQuota ? "unavailable" : "stale",
        quotaSyncError: null,
        planType: null,
        creditsBalance: null,
        quota: {
          fiveHour: {
            limit: effectiveFiveHourLimit,
            used: 0,
            mode: "units",
            label: null,
            windowMinutes: null,
            windowStartedAt: nowIso,
            resetsAt: null,
          },
          weekly: {
            limit: effectiveWeeklyLimit,
            used: 0,
            mode: "units",
            label: null,
            windowMinutes: null,
            windowStartedAt: nowIso,
            resetsAt: null,
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

  public updateAccountSettings(accountId: string, payload: AccountSettingsUpdatePayload): void {
    this.store.update((draft) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        throw new HttpError(404, "account_not_found", "Account could not be found.");
      }

      if (typeof payload.displayName === "string") {
        const trimmedDisplayName = payload.displayName.trim();
        if (!trimmedDisplayName) {
          throw new HttpError(400, "invalid_display_name", "Display name is required.");
        }

        account.displayName = trimmedDisplayName;
      }

      const hasManualFiveHourLimit =
        typeof payload.manualFiveHourLimit === "number" && Number.isFinite(payload.manualFiveHourLimit);
      const hasManualWeeklyLimit =
        typeof payload.manualWeeklyLimit === "number" && Number.isFinite(payload.manualWeeklyLimit);
      const requestedManualLimitChange = hasManualFiveHourLimit || hasManualWeeklyLimit;

      if (requestedManualLimitChange && (account.authMethod ?? "oauth") !== "api") {
        throw new HttpError(
          400,
          "manual_limits_not_supported",
          "Manual limits are only available for API-key accounts.",
        );
      }

      if (requestedManualLimitChange && (account.quotaSyncStatus ?? "unavailable") === "live") {
        throw new HttpError(
          409,
          "manual_limits_not_allowed",
          "Manual limits can only be changed when live quota sync is unavailable.",
        );
      }

      const manualFiveHourLimit = hasManualFiveHourLimit ? payload.manualFiveHourLimit : undefined;
      const manualWeeklyLimit = hasManualWeeklyLimit ? payload.manualWeeklyLimit : undefined;

      if (manualFiveHourLimit !== undefined) {
        account.quota.fiveHour.limit = Math.max(1, Math.round(manualFiveHourLimit));
      }

      if (manualWeeklyLimit !== undefined) {
        account.quota.weekly.limit = Math.max(1, Math.round(manualWeeklyLimit));
      }

      if (requestedManualLimitChange) {
        account.quota.fiveHour.used = Math.min(account.quota.fiveHour.used, account.quota.fiveHour.limit);
        account.quota.weekly.used = Math.min(account.quota.weekly.used, account.quota.weekly.limit);
        account.quota.fiveHour.mode = "units";
        account.quota.weekly.mode = "units";
        account.quota.fiveHour.label = null;
        account.quota.weekly.label = null;
        account.quota.fiveHour.windowMinutes = null;
        account.quota.weekly.windowMinutes = null;
      }

      account.updatedAt = new Date().toISOString();
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
}
