import { effectiveAccountAuthMethod } from "../account-auth";
import { HttpError } from "../errors";
import {
  AccountSettingsUpdatePayload,
  ConnectedProviderModelsPayload,
  ApiLinkedAccountPayload,
  ConnectedAccount,
  DashboardAccount,
  DashboardPayload,
  DashboardTotals,
  OAuthLinkedAccountPayload,
  QuotaSyncIssue,
  ProviderId,
  RoutingPreferences,
  RouteDecision,
  createDefaultRoutingPreferences,
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
import { ProviderModelsService } from "./provider-models";
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

function compareTrueFirst(a: boolean, b: boolean): number {
  if (a === b) {
    return 0;
  }

  return a ? -1 : 1;
}

function inferProviderFromModelReference(reference: string): ProviderId | null {
  const normalized = reference.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return null;
  }

  const providers: ProviderId[] = ["codex", "gemini", "claude", "openrouter"];
  for (const provider of providers) {
    if (
      normalized === provider ||
      normalized.startsWith(`${provider}/`) ||
      normalized.startsWith(`${provider}:`) ||
      normalized.startsWith(`${provider}-`)
    ) {
      return provider;
    }
  }

  return null;
}

function providerOrderFromPriorityModels(priorityModels: string[]): ProviderId[] {
  const order: ProviderId[] = [];
  for (const model of priorityModels) {
    const provider = inferProviderFromModelReference(model);
    if (!provider) {
      continue;
    }

    if (!order.includes(provider)) {
      order.push(provider);
    }
  }

  return order;
}

function orderCandidatesByRoutingPreferences(
  candidates: ConnectedAccount[],
  preferences: RoutingPreferences,
  modelHint: string | null,
): ConnectedAccount[] {
  const modelHintProvider = modelHint ? inferProviderFromModelReference(modelHint) : null;
  const preferredProvider = preferences.preferredProvider;
  const modelPriorityProviderOrder = providerOrderFromPriorityModels(preferences.priorityModels);
  const fallbackProviderOrder = preferences.fallbackProviders;

  const modelPriorityRank = new Map<ProviderId, number>();
  for (const [index, providerId] of modelPriorityProviderOrder.entries()) {
    modelPriorityRank.set(providerId, index);
  }

  const fallbackRank = new Map<ProviderId, number>();
  for (const [index, providerId] of fallbackProviderOrder.entries()) {
    fallbackRank.set(providerId, index);
  }

  return [...candidates].sort((a, b) => {
    if (modelHintProvider) {
      const modelHintCompare = compareTrueFirst(a.provider === modelHintProvider, b.provider === modelHintProvider);
      if (modelHintCompare !== 0) {
        return modelHintCompare;
      }
    }

    if (preferredProvider !== "auto") {
      const preferredCompare = compareTrueFirst(a.provider === preferredProvider, b.provider === preferredProvider);
      if (preferredCompare !== 0) {
        return preferredCompare;
      }
    }

    const aModelRank = modelPriorityRank.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
    const bModelRank = modelPriorityRank.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
    if (aModelRank !== bModelRank) {
      return aModelRank - bModelRank;
    }

    const aFallbackRank = fallbackRank.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
    const bFallbackRank = fallbackRank.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
    if (aFallbackRank !== bFallbackRank) {
      return aFallbackRank - bFallbackRank;
    }

    return compareByAvailability(a, b);
  });
}

const DASHBOARD_SYNC_WAIT_BUDGET_MS = 350;
const MODELS_TOKEN_REFRESH_WAIT_BUDGET_MS = 1_200;
const STRICT_LIVE_RETRY_COOLDOWN_MS = 25_000;
const LEGACY_GEMINI_PLACEHOLDER_FIVE_HOUR_LIMIT = 50_000;
const LEGACY_GEMINI_PLACEHOLDER_WEEKLY_LIMIT = 500_000;
const ESTIMATED_FIVE_HOUR_MIN_LIMIT = 120;
const ESTIMATED_WEEKLY_MIN_LIMIT = 1_200;
const ESTIMATE_INITIAL_MULTIPLIER = 24;
const ESTIMATE_SMOOTHING_ALPHA = 0.25;

function redactSensitiveLogText(input: string): string {
  return input
    .replace(
      /([?&](?:key|api_key|apikey|token|access_token|refresh_token)=)([^&\s]+)/gi,
      "$1[redacted]",
    )
    .replace(/(\bBearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]");
}

function syncErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return redactSensitiveLogText(error.message);
  }

  return redactSensitiveLogText(fallback);
}

function isQuotaSyncIssue(value: unknown): value is QuotaSyncIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<QuotaSyncIssue>;
  if (candidate.kind !== "account_verification_required") {
    return false;
  }

  if (typeof candidate.title !== "string" || candidate.title.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(candidate.steps) || candidate.steps.some((step) => typeof step !== "string" || step.trim().length === 0)) {
    return false;
  }

  if (typeof candidate.actionLabel !== "string" || candidate.actionLabel.trim().length === 0) {
    return false;
  }

  if (typeof candidate.actionUrl !== "string" || candidate.actionUrl.trim().length === 0) {
    return false;
  }

  return true;
}

function quotaSyncIssueFromError(error: unknown): QuotaSyncIssue | null {
  if (!(error instanceof HttpError) || !error.context || typeof error.context !== "object") {
    return null;
  }

  const issue = (error.context as Record<string, unknown>).quotaSyncIssue;
  if (!isQuotaSyncIssue(issue)) {
    return null;
  }

  return {
    kind: issue.kind,
    title: issue.title.trim(),
    steps: issue.steps.map((step) => step.trim()).filter((step) => step.length > 0),
    actionLabel: issue.actionLabel.trim(),
    actionUrl: issue.actionUrl.trim(),
  };
}

function isLegacyGeminiPlaceholderQuota(account: ConnectedAccount): boolean {
  if (account.provider !== "gemini" || effectiveAccountAuthMethod(account) !== "oauth") {
    return false;
  }

  return (
    account.quota.fiveHour.limit === LEGACY_GEMINI_PLACEHOLDER_FIVE_HOUR_LIMIT &&
    account.quota.weekly.limit === LEGACY_GEMINI_PLACEHOLDER_WEEKLY_LIMIT &&
    account.quota.fiveHour.used === 0 &&
    account.quota.weekly.used === 0
  );
}

function hasUnknownQuotaLimits(account: ConnectedAccount): boolean {
  return account.quota.fiveHour.limit <= 0 || account.quota.weekly.limit <= 0;
}

function applyEstimatedUsage(account: ConnectedAccount, units: number, nowIso: string): void {
  const nextSamples = Math.max(0, account.estimatedUsageSampleCount ?? 0) + 1;
  const nextTotalUnits = Math.max(0, account.estimatedUsageTotalUnits ?? 0) + units;
  const averageUnitsPerRequest = nextTotalUnits / nextSamples;

  const nextFiveHourUsed = account.quota.fiveHour.used + units;
  const nextWeeklyUsed = account.quota.weekly.used + units;

  const bootstrapFiveHourLimit = Math.max(ESTIMATED_FIVE_HOUR_MIN_LIMIT, units * ESTIMATE_INITIAL_MULTIPLIER);
  const bootstrapWeeklyLimit = Math.max(ESTIMATED_WEEKLY_MIN_LIMIT, bootstrapFiveHourLimit * 10);

  const projectedFiveHourLimit = Math.max(
    bootstrapFiveHourLimit,
    nextFiveHourUsed * 2,
    Math.ceil(averageUnitsPerRequest * Math.min(8 + nextSamples, 36)),
  );
  const projectedWeeklyLimit = Math.max(
    bootstrapWeeklyLimit,
    nextWeeklyUsed * 2,
    Math.ceil(projectedFiveHourLimit * 10),
  );

  const previousFiveHourLimit = account.quota.fiveHour.limit > 0 ? account.quota.fiveHour.limit : bootstrapFiveHourLimit;
  const previousWeeklyLimit = account.quota.weekly.limit > 0 ? account.quota.weekly.limit : bootstrapWeeklyLimit;

  const alpha = nextSamples === 1 ? 1 : nextSamples < 6 ? 0.5 : ESTIMATE_SMOOTHING_ALPHA;
  const estimatedFiveHourLimit = Math.max(
    nextFiveHourUsed,
    Math.round(previousFiveHourLimit * (1 - alpha) + projectedFiveHourLimit * alpha),
  );
  const estimatedWeeklyLimit = Math.max(
    nextWeeklyUsed,
    Math.round(previousWeeklyLimit * (1 - alpha) + projectedWeeklyLimit * alpha),
  );

  account.quota.fiveHour.limit = estimatedFiveHourLimit;
  account.quota.fiveHour.used = Math.min(nextFiveHourUsed, estimatedFiveHourLimit);
  account.quota.fiveHour.mode = "units";
  account.quota.fiveHour.label = null;
  account.quota.fiveHour.windowMinutes = null;
  account.quota.fiveHour.windowStartedAt = account.quota.fiveHour.windowStartedAt || nowIso;
  account.quota.fiveHour.resetsAt = null;

  account.quota.weekly.limit = estimatedWeeklyLimit;
  account.quota.weekly.used = Math.min(nextWeeklyUsed, estimatedWeeklyLimit);
  account.quota.weekly.mode = "units";
  account.quota.weekly.label = null;
  account.quota.weekly.windowMinutes = null;
  account.quota.weekly.windowStartedAt = account.quota.weekly.windowStartedAt || nowIso;
  account.quota.weekly.resetsAt = null;

  account.estimatedUsageSampleCount = nextSamples;
  account.estimatedUsageTotalUnits = nextTotalUnits;
  account.estimatedUsageUpdatedAt = nowIso;
  account.quotaSyncStatus = "stale";
  account.quotaSyncError = null;
  account.quotaSyncIssue = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ConnectorService {
  private syncInFlight: Promise<void> | null = null;
  private tokenRefreshInFlight: Promise<void> | null = null;

  public constructor(
    private readonly accounts: AccountRepository,
    private readonly oauthProviderService: OAuthProviderService,
    private readonly providerUsageService: ProviderUsageService,
    private readonly providerModelsService: ProviderModelsService,
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

  public async connectedProviderModels(): Promise<ConnectedProviderModelsPayload> {
    await this.syncAccountStateWithBudget(DASHBOARD_SYNC_WAIT_BUDGET_MS);
    const firstSnapshot = this.accounts.read();
    await Promise.race([
      this.refreshExpiringOauthTokens(firstSnapshot.accounts),
      sleep(MODELS_TOKEN_REFRESH_WAIT_BUDGET_MS),
    ]);
    const snapshot = this.accounts.read();
    return await this.providerModelsService.fetchConnectedProviderModels(snapshot.accounts);
  }

  public linkOAuthAccount(payload: OAuthLinkedAccountPayload): void {
    this.accounts.upsertOAuthAccount(payload);
    void this.syncAccountStateNow();
  }

  public linkApiAccount(payload: ApiLinkedAccountPayload): void {
    this.accounts.upsertApiAccount(payload, this.strictLiveQuota);
    void this.syncAccountStateNow();
  }

  public quotaSyncIssueForAccount(accountId: string): QuotaSyncIssue | null {
    const normalizedAccountId = accountId.trim();
    if (normalizedAccountId.length === 0) {
      throw new HttpError(400, "invalid_account_id", "Account ID is required.");
    }

    const account = this.accounts.read().accounts.find((candidate) => candidate.id === normalizedAccountId);
    if (!account) {
      throw new HttpError(404, "account_not_found", "Account could not be found.");
    }

    return account.quotaSyncIssue ?? null;
  }

  public async syncAccountStateNow(): Promise<void> {
    await this.syncAccountState();
  }

  public removeAccount(accountId: string): void {
    this.accounts.removeAccount(accountId);
  }

  public updateAccountSettings(accountId: string, payload: AccountSettingsUpdatePayload): void {
    this.accounts.updateAccountSettings(accountId, payload);
  }

  public rotateConnectorApiKey(): string {
    return this.accounts.rotateConnectorApiKey();
  }

  public routingPreferences(): RoutingPreferences {
    return this.accounts.routingPreferences();
  }

  public updateRoutingPreferences(preferences: RoutingPreferences): RoutingPreferences {
    return this.accounts.updateRoutingPreferences(preferences);
  }

  public async routeCandidates(apiKey: string, units: number, modelHint?: string): Promise<ConnectedAccount[]> {
    await this.syncAccountState();

    const safeUnits = assertPositiveUnits(units);
    const normalizedModelHint =
      typeof modelHint === "string" && modelHint.trim().length > 0 ? modelHint.trim() : null;

    const snapshot = this.accounts.read();
    if (snapshot.connector.apiKey !== apiKey) {
      throw new HttpError(401, "invalid_connector_key", "Connector API key is missing or invalid.");
    }

    for (const account of snapshot.accounts) {
      normalizeAccountQuota(account);
    }

    const candidates = snapshot.accounts.filter(
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

    const routingPreferences = snapshot.connector.routingPreferences ?? createDefaultRoutingPreferences();
    return orderCandidatesByRoutingPreferences(candidates, routingPreferences, normalizedModelHint);
  }

  public consumeRoutedUsage(accountId: string, units: number): void {
    const safeUnits = assertPositiveUnits(units);

    this.accounts.update((draft) => {
      const account = draft.accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        throw new HttpError(404, "route_target_not_found", "Selected route target no longer exists.");
      }

      normalizeAccountQuota(account);
      if (this.strictLiveQuota || account.quotaSyncStatus === "live") {
        return;
      }

      const nowIso = new Date().toISOString();
      if (hasUnknownQuotaLimits(account)) {
        applyEstimatedUsage(account, safeUnits, nowIso);
      } else {
        account.quota.fiveHour.used += safeUnits;
        account.quota.weekly.used += safeUnits;
      }

      account.updatedAt = nowIso;
    });
  }

  public async routeRequest(apiKey: string, units: number, modelHint?: string): Promise<RouteDecision> {
    await this.syncAccountState();

    const safeUnits = assertPositiveUnits(units);
    const normalizedModelHint =
      typeof modelHint === "string" && modelHint.trim().length > 0 ? modelHint.trim() : null;

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

      const routingPreferences = draft.connector.routingPreferences ?? createDefaultRoutingPreferences();
      const prioritizedCandidates = orderCandidatesByRoutingPreferences(candidates, routingPreferences, normalizedModelHint);
      const selected = prioritizedCandidates[0];
      if (!selected) {
        throw new HttpError(503, "no_route_target", "Unable to select an account.");
      }

      let quotaConsumed = false;
      if (!this.strictLiveQuota && selected.quotaSyncStatus !== "live") {
        const nowIso = new Date().toISOString();
        if (hasUnknownQuotaLimits(selected)) {
          applyEstimatedUsage(selected, safeUnits, nowIso);
        } else {
          selected.quota.fiveHour.used += safeUnits;
          selected.quota.weekly.used += safeUnits;
        }

        selected.updatedAt = nowIso;
        quotaConsumed = true;
      }

      decision = {
        routedTo: {
          provider: selected.provider,
          authMethod: effectiveAccountAuthMethod(selected),
          displayName: selected.displayName,
        },
        unitsConsumed: safeUnits,
        quotaConsumed,
        remaining: {
          fiveHour: remainingQuota(selected.quota.fiveHour),
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
      .catch((error) => {
        const message = syncErrorDetail(error, "unexpected sync failure");
        process.stderr.write(`Account sync failed: ${message}\n`);
        return;
      })
      .finally(() => {
        this.syncInFlight = null;
      });

    return this.syncInFlight;
  }

  private shouldSyncQuota(account: ConnectedAccount): boolean {
    if (isLegacyGeminiPlaceholderQuota(account)) {
      return true;
    }

    if (this.strictLiveQuota && (account.quotaSyncStatus ?? "unavailable") !== "live") {
      const syncError = account.quotaSyncError ?? null;

      if (syncError === null) {
        return true;
      }

      const syncedAtMs = account.quotaSyncedAt ? Date.parse(account.quotaSyncedAt) : Number.NaN;
      if (Number.isNaN(syncedAtMs)) {
        return true;
      }

      const ageMs = Date.now() - syncedAtMs;
      return ageMs >= STRICT_LIVE_RETRY_COOLDOWN_MS;
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

    await this.refreshExpiringOauthTokens(snapshot.accounts);

    for (const target of snapshot.accounts) {
      if (!this.shouldSyncQuota(target)) {
        continue;
      }

      const useCodexOAuthLiveSync =
        target.provider === "codex" && effectiveAccountAuthMethod(target) === "oauth";

      if (!useCodexOAuthLiveSync && !this.providerUsageService.isAccountConfigured(target)) {
        const nowIso = new Date().toISOString();
        this.accounts.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          const clearLegacyPlaceholderQuota = isLegacyGeminiPlaceholderQuota(account);
          if (clearLegacyPlaceholderQuota) {
            account.quota.fiveHour.limit = 0;
            account.quota.fiveHour.used = 0;
            account.quota.fiveHour.mode = "units";
            account.quota.fiveHour.label = null;
            account.quota.fiveHour.windowMinutes = null;
            account.quota.fiveHour.windowStartedAt = nowIso;
            account.quota.fiveHour.resetsAt = null;

            account.quota.weekly.limit = 0;
            account.quota.weekly.used = 0;
            account.quota.weekly.mode = "units";
            account.quota.weekly.label = null;
            account.quota.weekly.windowMinutes = null;
            account.quota.weekly.windowStartedAt = nowIso;
            account.quota.weekly.resetsAt = null;

            account.estimatedUsageSampleCount = 0;
            account.estimatedUsageTotalUnits = 0;
            account.estimatedUsageUpdatedAt = null;
            account.quotaSyncStatus = "unavailable";
            account.quotaSyncError = null;
            account.quotaSyncIssue = null;
            account.quotaSyncedAt = nowIso;
            account.updatedAt = nowIso;
            return;
          }

          const inferredAuthMethod = effectiveAccountAuthMethod(account);
          const missingUsageConfigError =
            inferredAuthMethod === "api"
              ? `Live usage data is currently unavailable for ${account.provider.toUpperCase()} API keys. Omni Connector keeps syncing automatically in the background.`
              : null;

          account.quotaSyncStatus = this.strictLiveQuota ? "unavailable" : "stale";
          account.quotaSyncError = missingUsageConfigError;
          account.quotaSyncIssue = null;
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

            const clearLegacyPlaceholderQuota = isLegacyGeminiPlaceholderQuota(account);
            if (clearLegacyPlaceholderQuota) {
              account.quota.fiveHour.limit = 0;
              account.quota.fiveHour.used = 0;
              account.quota.fiveHour.mode = "units";
              account.quota.fiveHour.label = null;
              account.quota.fiveHour.windowMinutes = null;
              account.quota.fiveHour.windowStartedAt = nowIso;
              account.quota.fiveHour.resetsAt = null;

              account.quota.weekly.limit = 0;
              account.quota.weekly.used = 0;
              account.quota.weekly.mode = "units";
              account.quota.weekly.label = null;
              account.quota.weekly.windowMinutes = null;
              account.quota.weekly.windowStartedAt = nowIso;
              account.quota.weekly.resetsAt = null;

              account.estimatedUsageSampleCount = 0;
              account.estimatedUsageTotalUnits = 0;
              account.estimatedUsageUpdatedAt = null;
              account.quotaSyncStatus = "unavailable";
              account.quotaSyncError = null;
              account.quotaSyncIssue = null;
              account.quotaSyncedAt = nowIso;
              account.updatedAt = nowIso;
              return;
            }

            account.quotaSyncStatus = this.strictLiveQuota ? "unavailable" : "stale";
            account.quotaSyncError = "Live usage endpoint returned no usable quota data.";
            account.quotaSyncIssue = null;
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
          account.quota.fiveHour.label = liveQuota.fiveHour.label;
          account.quota.fiveHour.windowMinutes = liveQuota.fiveHour.windowMinutes;
          account.quota.fiveHour.windowStartedAt = liveQuota.fiveHour.windowStartedAt;
          account.quota.fiveHour.resetsAt = liveQuota.fiveHour.resetsAt;

          account.quota.weekly.limit = liveQuota.weekly.limit;
          account.quota.weekly.used = liveQuota.weekly.used;
          account.quota.weekly.mode = liveQuota.weekly.mode;
          account.quota.weekly.label = liveQuota.weekly.label;
          account.quota.weekly.windowMinutes = liveQuota.weekly.windowMinutes;
          account.quota.weekly.windowStartedAt = liveQuota.weekly.windowStartedAt;
          account.quota.weekly.resetsAt = liveQuota.weekly.resetsAt;

          account.planType = liveQuota.planType;
          account.creditsBalance = liveQuota.creditsBalance;
          account.quotaSyncedAt = liveQuota.syncedAt;
          account.quotaSyncStatus = liveQuota.partial ? "stale" : "live";
          account.quotaSyncError = liveQuota.syncError;
          account.quotaSyncIssue = null;
          account.updatedAt = nowIso;
        });
      } catch (error) {
        const detail = syncErrorDetail(error, "unknown live quota sync failure");
        const syncIssue = quotaSyncIssueFromError(error);
        const message = `Live quota sync failed: ${detail}`;
        process.stderr.write(`Live quota sync failed for account ${target.id}: ${detail}\n`);
        const nowIso = new Date().toISOString();
        this.accounts.update((draft) => {
          const account = draft.accounts.find((candidate) => candidate.id === target.id);
          if (!account) {
            return;
          }

          const clearLegacyPlaceholderQuota = isLegacyGeminiPlaceholderQuota(account);
          if (clearLegacyPlaceholderQuota) {
            account.quota.fiveHour.limit = 0;
            account.quota.fiveHour.used = 0;
            account.quota.fiveHour.mode = "units";
            account.quota.fiveHour.label = null;
            account.quota.fiveHour.windowMinutes = null;
            account.quota.fiveHour.windowStartedAt = nowIso;
            account.quota.fiveHour.resetsAt = null;

            account.quota.weekly.limit = 0;
            account.quota.weekly.used = 0;
            account.quota.weekly.mode = "units";
            account.quota.weekly.label = null;
            account.quota.weekly.windowMinutes = null;
            account.quota.weekly.windowStartedAt = nowIso;
            account.quota.weekly.resetsAt = null;

            account.estimatedUsageSampleCount = 0;
            account.estimatedUsageTotalUnits = 0;
            account.estimatedUsageUpdatedAt = null;
            account.quotaSyncStatus = "unavailable";
            account.quotaSyncError = null;
            account.quotaSyncIssue = null;
            account.quotaSyncedAt = nowIso;
            account.updatedAt = nowIso;
            return;
          }

          account.quotaSyncStatus =
            this.strictLiveQuota || account.quota.fiveHour.limit <= 0 ? "unavailable" : "stale";
          account.quotaSyncError = message;
          account.quotaSyncIssue = syncIssue;
          account.quotaSyncedAt = nowIso;
          account.updatedAt = nowIso;
        });
      }
    }
  }

  private async refreshExpiringOauthTokens(accounts: ConnectedAccount[]): Promise<void> {
    if (this.tokenRefreshInFlight) {
      await this.tokenRefreshInFlight;
      return;
    }

    this.tokenRefreshInFlight = (async () => {
      for (const target of accounts) {
        if (effectiveAccountAuthMethod(target) !== "oauth" || !target.refreshToken) {
          continue;
        }

        if (!this.oauthProviderService.isTokenNearExpiry(target.tokenExpiresAt)) {
          continue;
        }

        try {
          const refreshedToken = await this.oauthProviderService.refreshAccessTokenFor(
            target.provider,
            target.oauthProfileId,
            target.refreshToken,
          );
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
          const detail = syncErrorDetail(error, "unknown token refresh failure");
          const message = "Failed to refresh access token.";
          process.stderr.write(`Access token refresh failed for account ${target.id}: ${detail}\n`);
          const nowIso = new Date().toISOString();
          this.accounts.update((draft) => {
            const account = draft.accounts.find((candidate) => candidate.id === target.id);
            if (!account) {
              return;
            }

            account.quotaSyncStatus =
              this.strictLiveQuota || account.quota.fiveHour.limit <= 0 ? "unavailable" : "stale";
            account.quotaSyncError = message;
            account.quotaSyncIssue = null;
            account.quotaSyncedAt = nowIso;
            account.updatedAt = nowIso;
          });
        }
      }
    })().finally(() => {
      this.tokenRefreshInFlight = null;
    });

    await this.tokenRefreshInFlight;
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
