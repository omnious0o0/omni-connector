import { AppConfig, ProviderUsageConfig } from "../config";
import { HttpError } from "../errors";
import { ConnectedAccount, ProviderId, QuotaWindowMode } from "../types";
import { resilientFetch } from "./http-resilience";

const GEMINI_CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com";
const GEMINI_CODE_ASSIST_API_VERSION = "v1internal";

interface LiveQuotaWindowSnapshot {
  limit: number;
  used: number;
  mode: QuotaWindowMode;
  label: string | null;
  windowMinutes: number | null;
  windowStartedAt: string;
  resetsAt: string | null;
}

export interface ProviderLiveQuotaSnapshot {
  fiveHour: LiveQuotaWindowSnapshot;
  weekly: LiveQuotaWindowSnapshot;
  planType: string | null;
  creditsBalance: string | null;
  syncedAt: string;
  partial: boolean;
  syncError: string | null;
}

interface ParsedWindowTotals {
  used: number;
  limit: number;
  mode: QuotaWindowMode;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function quotaTokenTypeLabel(tokenType: string | null): string | null {
  if (!tokenType) {
    return null;
  }

  const normalized = tokenType.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function clampUsed(used: number, limit: number): number {
  if (!Number.isFinite(used) || used < 0) {
    return 0;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.min(Math.round(used), Math.round(limit));
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.round(limit);
}

function ensureHttpsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new HttpError(500, "invalid_usage_url", `Usage URL must use HTTPS: ${rawUrl}`);
  }

  return parsed.toString();
}

function errorMessage(error: unknown, fallback: string): string {
  const redact = (input: string): string =>
    input
      .replace(
        /([?&](?:key|api_key|apikey|token|access_token|refresh_token)=)([^&\s]+)/gi,
        "$1[redacted]",
      )
      .replace(/(\bBearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]");

  if (error instanceof HttpError) {
    return redact(error.message);
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return redact(error.message);
  }

  return redact(fallback);
}

function extractUpstreamError(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const directMessage = asString(root.message);
  const errorValue = root.error;
  if (typeof errorValue === "string") {
    return asString(errorValue);
  }

  const errorRecord = asRecord(errorValue);
  if (!errorRecord) {
    return directMessage;
  }

  const message = asString(errorRecord.message);
  const status = asString(errorRecord.status);
  return message ?? directMessage ?? status;
}

function fallbackWindowFromAccount(
  account: ConnectedAccount,
  window: "fiveHour" | "weekly",
  fallbackLimit: number,
): LiveQuotaWindowSnapshot {
  const source = window === "fiveHour" ? account.quota.fiveHour : account.quota.weekly;
  const limit = normalizeLimit(source.limit > 0 ? source.limit : fallbackLimit);
  const used = clampUsed(source.used, limit);
  const mode = source.mode ?? "units";
  const label = source.label ?? null;
  const windowMinutes =
    typeof source.windowMinutes === "number" && Number.isFinite(source.windowMinutes)
      ? Math.max(0, Math.round(source.windowMinutes))
      : null;
  const windowStartedAt = source.windowStartedAt || new Date().toISOString();
  const resetsAt = source.resetsAt ?? null;

  return {
    limit,
    used,
    mode,
    label,
    windowMinutes,
    windowStartedAt,
    resetsAt,
  };
}

function unitWindow(limit: number, used: number, syncedAt: string, windowMinutes: number | null): LiveQuotaWindowSnapshot {
  return {
    limit,
    used,
    mode: "units",
    label: null,
    windowMinutes,
    windowStartedAt: syncedAt,
    resetsAt: null,
  };
}

function deepFindNumbers(payload: unknown, keySet: Set<string>, result: number[] = []): number[] {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      deepFindNumbers(item, keySet, result);
    }
    return result;
  }

  const record = asRecord(payload);
  if (!record) {
    return result;
  }

  for (const [key, value] of Object.entries(record)) {
    const normalized = key.trim().toLowerCase();
    if (keySet.has(normalized)) {
      const numeric = asNumber(value);
      if (numeric !== null) {
        result.push(numeric);
      }
    }

    if (typeof value === "object" && value !== null) {
      deepFindNumbers(value, keySet, result);
    }
  }

  return result;
}

function deepFindFirstString(payload: unknown, keySet: Set<string>): string | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = deepFindFirstString(item, keySet);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  for (const [key, value] of Object.entries(record)) {
    const normalized = key.trim().toLowerCase();
    if (keySet.has(normalized)) {
      const asText = asString(value);
      if (asText !== null) {
        return asText;
      }
    }

    if (typeof value === "object" && value !== null) {
      const nested = deepFindFirstString(value, keySet);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function deepFindFirstNumber(payload: unknown, keySet: Set<string>): number | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = deepFindFirstNumber(item, keySet);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  for (const [key, value] of Object.entries(record)) {
    const normalized = key.trim().toLowerCase();
    if (keySet.has(normalized)) {
      const numeric = asNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }

    if (typeof value === "object" && value !== null) {
      const nested = deepFindFirstNumber(value, keySet);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function parseOpenAiBucketUsage(payload: unknown): number {
  const root = asRecord(payload);
  if (!root) {
    return 0;
  }

  let total = 0;
  const buckets = asArray(root.data);
  for (const bucket of buckets) {
    const bucketRecord = asRecord(bucket);
    if (!bucketRecord) {
      continue;
    }

    const results = asArray(bucketRecord.results);
    for (const result of results) {
      const resultRecord = asRecord(result);
      if (!resultRecord) {
        continue;
      }

      const tokenKeys = [
        "input_tokens",
        "output_tokens",
        "input_cached_tokens",
        "input_audio_tokens",
        "output_audio_tokens",
      ] as const;

      for (const key of tokenKeys) {
        const value = asNumber(resultRecord[key]);
        if (value !== null && value > 0) {
          total += value;
        }
      }
    }
  }

  return Math.max(Math.round(total), 0);
}

function parseAnthropicUsage(payload: unknown): number {
  const root = asRecord(payload);
  if (!root) {
    return 0;
  }

  let total = 0;
  const records = asArray(root.data);
  for (const recordItem of records) {
    const record = asRecord(recordItem);
    if (!record) {
      continue;
    }

    const tokenKeys = [
      "input_tokens",
      "output_tokens",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
    ] as const;

    for (const key of tokenKeys) {
      const numeric = asNumber(record[key]);
      if (numeric !== null && numeric > 0) {
        total += numeric;
      }
    }
  }

  return Math.max(Math.round(total), 0);
}

function parseJsonTotals(payload: unknown, fallbackLimit: number): ParsedWindowTotals | null {
  const percentValues = deepFindNumbers(payload, new Set(["used_percent", "usage_percent", "percent_used"]));
  const usedPercent = percentValues.find((value) => value >= 0 && value <= 100) ?? null;
  if (usedPercent !== null) {
    return {
      used: Math.round(Math.max(0, Math.min(usedPercent, 100))),
      limit: 100,
      mode: "percent",
    };
  }

  const usedCandidates = deepFindNumbers(
    payload,
    new Set([
      "used",
      "usage",
      "total_usage",
      "total_tokens",
      "tokens_used",
      "consumed",
      "current",
      "count",
      "spent",
    ]),
  );
  const limitCandidates = deepFindNumbers(
    payload,
    new Set([
      "limit",
      "quota",
      "max",
      "total",
      "total_credits",
      "allowed",
      "capacity",
      "budget",
    ]),
  );

  const remainingCandidates = deepFindNumbers(
    payload,
    new Set(["remaining", "remaining_credits", "credits_remaining", "balance"]),
  );

  if (remainingCandidates.length > 0 && limitCandidates.length === 0 && usedCandidates.length === 0) {
    const remaining = Math.max(...remainingCandidates);
    const inferredLimit = normalizeLimit(fallbackLimit);
    if (inferredLimit > 0) {
      return {
        used: clampUsed(Math.max(inferredLimit - remaining, 0), inferredLimit),
        limit: inferredLimit,
        mode: "units",
      };
    }
  }

  const used = usedCandidates.length > 0 ? Math.max(...usedCandidates) : null;
  const discoveredLimit = limitCandidates.length > 0 ? Math.max(...limitCandidates) : null;
  const limit = normalizeLimit(discoveredLimit ?? fallbackLimit);

  if (used === null || limit <= 0) {
    return null;
  }

  return {
    used: clampUsed(used, limit),
    limit,
    mode: "units",
  };
}

export class ProviderUsageService {
  public constructor(private readonly config: AppConfig) {}

  private isGeminiOauthAccount(account: ConnectedAccount): boolean {
    return account.provider === "gemini" && (account.authMethod ?? "oauth") === "oauth";
  }

  private geminiCodeAssistQuotaEndpoint(): string {
    const baseUrl = asString(process.env.CODE_ASSIST_ENDPOINT) ?? GEMINI_CODE_ASSIST_BASE_URL;
    const apiVersion = asString(process.env.CODE_ASSIST_API_VERSION) ?? GEMINI_CODE_ASSIST_API_VERSION;
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedVersion = apiVersion.replace(/^\/+|\/+$/g, "");
    return `${normalizedBase}/${normalizedVersion}:retrieveUserQuota`;
  }

  private async postGeminiQuotaRequest(
    endpoint: string,
    accessToken: string,
    requestBody: Record<string, string>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await resilientFetch(
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "omni-connector/1.0",
          },
          body: JSON.stringify(requestBody),
        },
        {
          timeoutMs: 15_000,
          maxAttempts: 2,
          baseDelayMs: 120,
          maxDelayMs: 360,
        },
      );
    } catch (error) {
      throw new HttpError(502, "provider_usage_fetch_failed", errorMessage(error, "Usage fetch failed."));
    }

    const rawBody = await response.text();
    let payload: unknown = null;
    if (rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail = extractUpstreamError(payload);
      throw new HttpError(
        502,
        "provider_usage_fetch_failed",
        detail
          ? `Usage endpoint returned status ${response.status}. ${detail}`
          : `Usage endpoint returned status ${response.status}.`,
      );
    }

    if (payload === null) {
      throw new HttpError(502, "provider_usage_parse_failed", "Usage endpoint returned invalid JSON.");
    }

    return payload;
  }

  private async fetchGeminiOauthQuotaSnapshot(account: ConnectedAccount): Promise<ProviderLiveQuotaSnapshot | null> {
    const accessToken = account.accessToken.trim();
    if (!accessToken) {
      return null;
    }

    const endpoint = this.geminiCodeAssistQuotaEndpoint();
    const projectId = account.providerAccountId.trim();
    const requestBodies: Record<string, string>[] = projectId.length > 0 ? [{ project: projectId }, {}] : [{}];
    let payload: unknown = null;
    let lastError: HttpError | null = null;

    for (const requestBody of requestBodies) {
      try {
        payload = await this.postGeminiQuotaRequest(endpoint, accessToken, requestBody);
        lastError = null;
        break;
      } catch (error) {
        if (error instanceof HttpError) {
          lastError = error;
        } else {
          lastError = new HttpError(502, "provider_usage_fetch_failed", errorMessage(error, "Usage fetch failed."));
        }
      }
    }

    if (payload === null) {
      if (lastError) {
        throw lastError;
      }

      return null;
    }

    const root = asRecord(payload);
    if (!root) {
      return null;
    }

    const bucketWindows: Array<{
      remainingFraction: number;
      resetMs: number | null;
      tokenType: string | null;
    }> = [];

    for (const bucketEntry of asArray(root.buckets)) {
      const bucket = asRecord(bucketEntry);
      if (!bucket) {
        continue;
      }

      const remainingFraction = asNumber(bucket.remainingFraction ?? bucket.remaining_fraction);
      if (remainingFraction === null) {
        continue;
      }

      const normalizedRemaining = Math.max(0, Math.min(remainingFraction, 1));

      const resetTime = asString(bucket.resetTime ?? bucket.reset_time);
      const resetMsRaw = resetTime ? Date.parse(resetTime) : Number.NaN;
      const resetMs = Number.isNaN(resetMsRaw) ? null : resetMsRaw;
      const tokenType = asString(bucket.tokenType ?? bucket.token_type);

      bucketWindows.push({
        remainingFraction: normalizedRemaining,
        resetMs,
        tokenType,
      });
    }

    if (bucketWindows.length === 0) {
      return null;
    }

    const syncedAt = new Date().toISOString();
    const groupedWindows = new Map<
      string,
      {
        remainingFractions: number[];
        resetMs: number | null;
        tokenType: string | null;
      }
    >();

    for (const bucketWindow of bucketWindows) {
      const key = `${bucketWindow.tokenType ?? "unknown"}|${bucketWindow.resetMs ?? "na"}`;
      const existing = groupedWindows.get(key);
      if (existing) {
        existing.remainingFractions.push(bucketWindow.remainingFraction);
        continue;
      }

      groupedWindows.set(key, {
        remainingFractions: [bucketWindow.remainingFraction],
        resetMs: bucketWindow.resetMs,
        tokenType: bucketWindow.tokenType,
      });
    }

    const normalizedWindows = [...groupedWindows.values()]
      .map((windowGroup) => {
        const remainingFraction = Math.min(...windowGroup.remainingFractions);
        const usedPercent = Number(((1 - remainingFraction) * 100).toFixed(2));
        return {
          limit: 100,
          used: usedPercent,
          mode: "percent" as const,
          label: quotaTokenTypeLabel(windowGroup.tokenType),
          windowMinutes: null,
          windowStartedAt: syncedAt,
          resetsAt: windowGroup.resetMs === null ? null : new Date(windowGroup.resetMs).toISOString(),
          resetMs: windowGroup.resetMs,
        };
      })
      .sort((left, right) => {
        const leftReset = left.resetMs ?? Number.MAX_SAFE_INTEGER;
        const rightReset = right.resetMs ?? Number.MAX_SAFE_INTEGER;
        if (leftReset !== rightReset) {
          return leftReset - rightReset;
        }

        return left.used - right.used;
      });

    const firstWindow = normalizedWindows[0] ?? null;
    if (!firstWindow) {
      return null;
    }
    const secondWindow = normalizedWindows[1] ?? firstWindow;

    return {
      fiveHour: {
        limit: firstWindow.limit,
        used: firstWindow.used,
        mode: firstWindow.mode,
        label: firstWindow.label,
        windowMinutes: firstWindow.windowMinutes,
        windowStartedAt: firstWindow.windowStartedAt,
        resetsAt: firstWindow.resetsAt,
      },
      weekly: {
        limit: secondWindow.limit,
        used: secondWindow.used,
        mode: secondWindow.mode,
        label: secondWindow.label,
        windowMinutes: secondWindow.windowMinutes,
        windowStartedAt: secondWindow.windowStartedAt,
        resetsAt: secondWindow.resetsAt,
      },
      planType: null,
      creditsBalance: null,
      syncedAt,
      partial: false,
      syncError: null,
    };
  }

  private hasConfiguredWindowLimits(providerConfig: ProviderUsageConfig): boolean {
    return normalizeLimit(providerConfig.fiveHourLimit) > 0 && normalizeLimit(providerConfig.weeklyLimit) > 0;
  }

  public isConfigured(providerId: ProviderId): boolean {
    const providerConfig = this.config.providerUsage[providerId];
    if (!providerConfig) {
      return false;
    }

    if (providerConfig.parser === "openai_usage") {
      return providerConfig.baseUrl !== null;
    }

    if (providerConfig.parser === "anthropic_usage") {
      return providerConfig.baseUrl !== null && this.hasConfiguredWindowLimits(providerConfig);
    }

    return providerConfig.fiveHourUrl !== null || providerConfig.weeklyUrl !== null;
  }

  public isAccountConfigured(account: ConnectedAccount): boolean {
    if (this.isGeminiOauthAccount(account)) {
      return true;
    }

    const providerConfig = this.config.providerUsage[account.provider];
    if (!providerConfig) {
      return false;
    }

    if (providerConfig.parser === "openai_usage") {
      if (!providerConfig.baseUrl) {
        return false;
      }

      const authMethod = account.authMethod ?? "oauth";
      const isCodexOAuth = account.provider === "codex" && authMethod === "oauth";
      if (!isCodexOAuth && !this.hasConfiguredWindowLimits(providerConfig)) {
        return false;
      }

      if (providerConfig.apiKeyOverride) {
        return true;
      }

      return authMethod === "api";
    }

    if (providerConfig.parser === "anthropic_usage") {
      if (!providerConfig.baseUrl) {
        return false;
      }

      if (!this.hasConfiguredWindowLimits(providerConfig)) {
        return false;
      }

      if (providerConfig.apiKeyOverride) {
        return true;
      }

      return (account.authMethod ?? "oauth") === "api" || (account.authMethod ?? "oauth") === "oauth";
    }

    return providerConfig.fiveHourUrl !== null || providerConfig.weeklyUrl !== null;
  }

  public async fetchLiveQuotaSnapshot(
    account: ConnectedAccount,
  ): Promise<ProviderLiveQuotaSnapshot | null> {
    if (this.isGeminiOauthAccount(account)) {
      return await this.fetchGeminiOauthQuotaSnapshot(account);
    }

    const providerConfig = this.config.providerUsage[account.provider];
    if (!this.isAccountConfigured(account)) {
      return null;
    }

    const credential = providerConfig.apiKeyOverride ?? account.accessToken;
    if (!credential) {
      return null;
    }

    if (providerConfig.parser === "openai_usage") {
      return this.fetchOpenAiUsageSnapshot(account, providerConfig, credential);
    }

    if (providerConfig.parser === "anthropic_usage") {
      return this.fetchAnthropicUsageSnapshot(account, providerConfig, credential);
    }

    return this.fetchJsonTotalsSnapshot(account, providerConfig, credential);
  }

  private async fetchOpenAiUsageSnapshot(
    account: ConnectedAccount,
    providerConfig: ProviderUsageConfig,
    credential: string,
  ): Promise<ProviderLiveQuotaSnapshot | null> {
    if (!providerConfig.baseUrl) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const fiveHourStart = nowSeconds - 5 * 60 * 60;
    const weeklyStart = nowSeconds - 7 * 24 * 60 * 60;

    const fiveHourUrl = new URL(`${providerConfig.baseUrl.replace(/\/$/, "")}/organization/usage/completions`);
    fiveHourUrl.searchParams.set("start_time", String(fiveHourStart));
    fiveHourUrl.searchParams.set("end_time", String(nowSeconds));

    const weeklyUrl = new URL(`${providerConfig.baseUrl.replace(/\/$/, "")}/organization/usage/completions`);
    weeklyUrl.searchParams.set("start_time", String(weeklyStart));
    weeklyUrl.searchParams.set("end_time", String(nowSeconds));

    const [fiveHourResult, weeklyResult] = await Promise.allSettled([
      this.fetchJson(fiveHourUrl.toString(), providerConfig, credential),
      this.fetchJson(weeklyUrl.toString(), providerConfig, credential),
    ]);

    const fiveHourLimit = normalizeLimit(providerConfig.fiveHourLimit);
    const weeklyLimit = normalizeLimit(providerConfig.weeklyLimit);
    if (fiveHourLimit <= 0 || weeklyLimit <= 0) {
      return null;
    }

    const syncedAt = new Date().toISOString();
    const errors: string[] = [];

    const fiveHourWindow =
      fiveHourResult.status === "fulfilled"
        ? unitWindow(
            fiveHourLimit,
            clampUsed(parseOpenAiBucketUsage(fiveHourResult.value), fiveHourLimit),
            syncedAt,
            5 * 60,
          )
        : (() => {
            errors.push(`5h usage fetch failed (${errorMessage(fiveHourResult.reason, "request failed")}).`);
            return fallbackWindowFromAccount(account, "fiveHour", fiveHourLimit);
          })();

    const weeklyWindow =
      weeklyResult.status === "fulfilled"
        ? unitWindow(
            weeklyLimit,
            clampUsed(parseOpenAiBucketUsage(weeklyResult.value), weeklyLimit),
            syncedAt,
            7 * 24 * 60,
          )
        : (() => {
            errors.push(`7d usage fetch failed (${errorMessage(weeklyResult.reason, "request failed")}).`);
            return fallbackWindowFromAccount(account, "weekly", weeklyLimit);
          })();

    if (errors.length >= 2) {
      throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
    }

    const metadataPayload =
      fiveHourResult.status === "fulfilled"
        ? fiveHourResult.value
        : weeklyResult.status === "fulfilled"
          ? weeklyResult.value
          : null;

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadataPayload
        ? deepFindFirstString(metadataPayload, new Set(["plan", "plan_type", "tier"]))
        : null,
      creditsBalance:
        (metadataPayload
          ? deepFindFirstString(metadataPayload, new Set(["credits_balance", "balance"]))
          : null) ??
        (() => {
          if (!metadataPayload) {
            return null;
          }

          const totalCredits = deepFindFirstNumber(
            metadataPayload,
            new Set(["total_credits", "credits_total", "credit_limit"]),
          );
          const totalUsage = deepFindFirstNumber(
            metadataPayload,
            new Set(["total_usage", "credits_used", "spent"]),
          );
          if (totalCredits === null) {
            return null;
          }

          const remaining = totalUsage === null ? totalCredits : Math.max(totalCredits - totalUsage, 0);
          return remaining.toFixed(2);
        })(),
      syncedAt,
      partial: errors.length > 0,
      syncError: errors.length > 0 ? errors.join(" ") : null,
    };
  }

  private async fetchAnthropicUsageSnapshot(
    account: ConnectedAccount,
    providerConfig: ProviderUsageConfig,
    credential: string,
  ): Promise<ProviderLiveQuotaSnapshot | null> {
    if (!providerConfig.baseUrl) {
      return null;
    }

    const nowMs = Date.now();
    const fiveHourStartMs = nowMs - 5 * 60 * 60 * 1000;
    const weeklyStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;

    const endpointBase = `${providerConfig.baseUrl.replace(/\/$/, "")}/organizations/usage_report/messages`;
    const fiveHourUrl = new URL(endpointBase);
    fiveHourUrl.searchParams.set("starting_at", new Date(fiveHourStartMs).toISOString());
    fiveHourUrl.searchParams.set("ending_at", new Date(nowMs).toISOString());
    fiveHourUrl.searchParams.set("bucket_width", "1h");

    const weeklyUrl = new URL(endpointBase);
    weeklyUrl.searchParams.set("starting_at", new Date(weeklyStartMs).toISOString());
    weeklyUrl.searchParams.set("ending_at", new Date(nowMs).toISOString());
    weeklyUrl.searchParams.set("bucket_width", "1d");

    const [fiveHourResult, weeklyResult] = await Promise.allSettled([
      this.fetchJson(fiveHourUrl.toString(), providerConfig, credential),
      this.fetchJson(weeklyUrl.toString(), providerConfig, credential),
    ]);

    const fiveHourLimit = normalizeLimit(providerConfig.fiveHourLimit);
    const weeklyLimit = normalizeLimit(providerConfig.weeklyLimit);
    if (fiveHourLimit <= 0 || weeklyLimit <= 0) {
      return null;
    }

    const syncedAt = new Date().toISOString();
    const errors: string[] = [];

    const fiveHourWindow =
      fiveHourResult.status === "fulfilled"
        ? unitWindow(
            fiveHourLimit,
            clampUsed(parseAnthropicUsage(fiveHourResult.value), fiveHourLimit),
            syncedAt,
            5 * 60,
          )
        : (() => {
            errors.push(`5h usage fetch failed (${errorMessage(fiveHourResult.reason, "request failed")}).`);
            return fallbackWindowFromAccount(account, "fiveHour", fiveHourLimit);
          })();

    const weeklyWindow =
      weeklyResult.status === "fulfilled"
        ? unitWindow(
            weeklyLimit,
            clampUsed(parseAnthropicUsage(weeklyResult.value), weeklyLimit),
            syncedAt,
            7 * 24 * 60,
          )
        : (() => {
            errors.push(`7d usage fetch failed (${errorMessage(weeklyResult.reason, "request failed")}).`);
            return fallbackWindowFromAccount(account, "weekly", weeklyLimit);
          })();

    if (errors.length >= 2) {
      throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
    }

    const metadataPayload =
      fiveHourResult.status === "fulfilled"
        ? fiveHourResult.value
        : weeklyResult.status === "fulfilled"
          ? weeklyResult.value
          : null;

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadataPayload
        ? deepFindFirstString(metadataPayload, new Set(["service_tier", "plan", "plan_type"]))
        : null,
      creditsBalance: metadataPayload
        ? deepFindFirstString(metadataPayload, new Set(["credits_balance", "balance"]))
        : null,
      syncedAt,
      partial: errors.length > 0,
      syncError: errors.length > 0 ? errors.join(" ") : null,
    };
  }

  private async fetchJsonTotalsSnapshot(
    account: ConnectedAccount,
    providerConfig: ProviderUsageConfig,
    credential: string,
  ): Promise<ProviderLiveQuotaSnapshot | null> {
    const fiveHourUrl = providerConfig.fiveHourUrl ?? providerConfig.weeklyUrl;
    const weeklyUrl = providerConfig.weeklyUrl ?? providerConfig.fiveHourUrl;
    if (!fiveHourUrl || !weeklyUrl) {
      return null;
    }

    const [fiveHourResult, weeklyResult] = await Promise.allSettled([
      this.fetchJson(fiveHourUrl, providerConfig, credential),
      this.fetchJson(weeklyUrl, providerConfig, credential),
    ]);

    const syncedAt = new Date().toISOString();
    const errors: string[] = [];

    const fiveHourParsed =
      fiveHourResult.status === "fulfilled"
        ? parseJsonTotals(fiveHourResult.value, providerConfig.fiveHourLimit)
        : null;
    const weeklyParsed =
      weeklyResult.status === "fulfilled"
        ? parseJsonTotals(weeklyResult.value, providerConfig.weeklyLimit)
        : null;

    const fiveHourWindow =
      fiveHourParsed !== null
        ? {
            limit: fiveHourParsed.limit,
            used: clampUsed(fiveHourParsed.used, fiveHourParsed.limit),
            mode: fiveHourParsed.mode,
            label: null,
            windowMinutes: null,
            windowStartedAt: syncedAt,
            resetsAt: null,
          }
        : (() => {
            const reason =
              fiveHourResult.status === "rejected"
                ? errorMessage(fiveHourResult.reason, "request failed")
                : "response had no usable quota fields";
            errors.push(`5h usage fetch failed (${reason}).`);
            return fallbackWindowFromAccount(account, "fiveHour", normalizeLimit(providerConfig.fiveHourLimit));
          })();

    const weeklyWindow =
      weeklyParsed !== null
        ? {
            limit: weeklyParsed.limit,
            used: clampUsed(weeklyParsed.used, weeklyParsed.limit),
            mode: weeklyParsed.mode,
            label: null,
            windowMinutes: null,
            windowStartedAt: syncedAt,
            resetsAt: null,
          }
        : (() => {
            const reason =
              weeklyResult.status === "rejected"
                ? errorMessage(weeklyResult.reason, "request failed")
                : "response had no usable quota fields";
            errors.push(`7d usage fetch failed (${reason}).`);
            return fallbackWindowFromAccount(account, "weekly", normalizeLimit(providerConfig.weeklyLimit));
          })();

    if (errors.length >= 2) {
      throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
    }

    const metadataPayload =
      fiveHourResult.status === "fulfilled"
        ? fiveHourResult.value
        : weeklyResult.status === "fulfilled"
          ? weeklyResult.value
          : null;

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadataPayload
        ? deepFindFirstString(metadataPayload, new Set(["plan", "plan_type", "tier", "service_tier"]))
        : null,
      creditsBalance:
        (metadataPayload
          ? deepFindFirstString(metadataPayload, new Set(["credits_balance", "balance", "remaining_credits"]))
          : null) ??
        (() => {
          if (!metadataPayload) {
            return null;
          }

          const totalCredits = deepFindFirstNumber(
            metadataPayload,
            new Set(["total_credits", "credits_total", "credit_limit"]),
          );
          const totalUsage = deepFindFirstNumber(
            metadataPayload,
            new Set(["total_usage", "credits_used", "spent"]),
          );
          if (totalCredits === null) {
            return null;
          }

          const remaining = totalUsage === null ? totalCredits : Math.max(totalCredits - totalUsage, 0);
          return remaining.toFixed(2);
        })(),
      syncedAt,
      partial: errors.length > 0,
      syncError: errors.length > 0 ? errors.join(" ") : null,
    };
  }

  private async fetchJson(
    rawUrl: string,
    providerConfig: ProviderUsageConfig,
    credential: string,
  ): Promise<unknown> {
    const url = new URL(ensureHttpsUrl(rawUrl));
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "omni-connector/1.0",
      ...providerConfig.headers,
    };

    if (providerConfig.authMode === "bearer") {
      headers.Authorization = `Bearer ${credential}`;
    } else if (providerConfig.authMode === "x-api-key") {
      headers["x-api-key"] = credential;
    } else {
      url.searchParams.set(providerConfig.authQueryParam || "key", credential);
    }

    let response: Response;
    try {
      response = await resilientFetch(
        url.toString(),
        {
          method: "GET",
          headers,
        },
        {
          timeoutMs: 15_000,
          maxAttempts: 2,
          baseDelayMs: 100,
          maxDelayMs: 300,
        },
      );
    } catch (error) {
      const message = errorMessage(error, "Usage fetch failed.");
      throw new HttpError(502, "provider_usage_fetch_failed", message);
    }

    if (!response.ok) {
      throw new HttpError(
        502,
        "provider_usage_fetch_failed",
        `Usage endpoint returned status ${response.status}.`,
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new HttpError(502, "provider_usage_parse_failed", "Usage endpoint returned invalid JSON.");
    }
  }
}
