import { effectiveAccountAuthMethod } from "../account-auth";
import { AppConfig, ProviderUsageConfig, isLoopbackHost } from "../config";
import { HttpError } from "../errors";
import { ConnectedAccount, ProviderId, QuotaSyncIssue, QuotaWindowMode } from "../types";
import { resilientFetch } from "./http-resilience";
import { fetchGeminiCliProjectId } from "./oauth-provider/gemini-cli";

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

interface ProviderMetadata {
  planType: string | null;
  creditsBalance: string | null;
}

const PLAN_TYPE_KEYS = new Set(["plan", "plan_type", "tier", "service_tier"]);
const CREDIT_BALANCE_KEYS = new Set([
  "credits_balance",
  "balance",
  "remaining_credits",
  "credits_remaining",
  "remaining_balance",
]);
const CREDIT_TOTAL_KEYS = new Set(["total_credits", "credits_total", "credit_limit", "credits_limit"]);
const CREDIT_USED_KEYS = new Set(["total_usage", "credits_used", "spent", "total_spent"]);
const JSON_TOTALS_FIELD_HINT =
  "expected usage fields like used/usage + limit/quota, or remaining_credits with configured limits";
const JSON_TOTALS_METADATA_ONLY_SYNC_MESSAGE =
  "Live balance synced, but provider responses did not include quota window fields.";

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

function asHttpsUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function quotaTokenTypeLabel(tokenType: string | null): string | null {
  if (!tokenType) {
    return null;
  }

  const normalized = tokenType.trim();
  if (normalized.length === 0) {
    return null;
  }

  const compact = normalized.replace(/[_\s-]+/g, "").toLowerCase();
  if (compact === "requests" || compact === "tokens" || compact === "calls") {
    return null;
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function inferWindowMinutesFromReset(resetMs: number | null, referenceMs: number): number | null {
  if (!Number.isFinite(resetMs) || resetMs === null || !Number.isFinite(referenceMs)) {
    return null;
  }

  const remainingMinutes = (resetMs - referenceMs) / 60_000;
  if (!Number.isFinite(remainingMinutes) || remainingMinutes <= 0) {
    return null;
  }

  const candidates = [60, 5 * 60, 24 * 60, 7 * 24 * 60];
  let winner: number | null = null;
  let bestRelativeDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const relativeDelta = Math.abs(remainingMinutes - candidate) / candidate;
    if (relativeDelta < bestRelativeDelta) {
      bestRelativeDelta = relativeDelta;
      winner = candidate;
    }
  }

  if (winner === null) {
    return null;
  }

  return bestRelativeDelta <= 0.35 ? winner : null;
}

function parseWindowMinutesFromText(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const text = value.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const asMinutes = (amount: number, multiplier: number): number | null => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return Math.max(1, Math.round(amount * multiplier));
  };

  if (text.includes("daily") || text.includes("per_day") || text.includes("per-day")) {
    return 24 * 60;
  }

  if (text.includes("weekly") || text.includes("per_week") || text.includes("per-week")) {
    return 7 * 24 * 60;
  }

  if (text.includes("hourly") || text.includes("per_hour") || text.includes("per-hour")) {
    return 60;
  }

  const tokenMatch = /(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)\b/i.exec(text);
  if (!tokenMatch) {
    return null;
  }

  const valueNumber = Number(tokenMatch[1]);
  const unit = (tokenMatch[2] ?? "").toLowerCase();
  if (unit.startsWith("m")) {
    return asMinutes(valueNumber, 1);
  }

  if (unit.startsWith("h")) {
    return asMinutes(valueNumber, 60);
  }

  if (unit.startsWith("d")) {
    return asMinutes(valueNumber, 24 * 60);
  }

  if (unit.startsWith("w")) {
    return asMinutes(valueNumber, 7 * 24 * 60);
  }

  return null;
}

function extractBucketWindowMinutes(bucket: Record<string, unknown>, tokenType: string | null): number | null {
  const directMinutes = [
    "windowMinutes",
    "window_minutes",
    "limitWindowMinutes",
    "limit_window_minutes",
    "windowDurationMinutes",
    "window_duration_minutes",
    "windowDurationMins",
    "window_duration_mins",
    "periodMinutes",
    "period_minutes",
    "intervalMinutes",
    "interval_minutes",
  ];

  for (const key of directMinutes) {
    const value = asNumber(bucket[key]);
    if (value !== null && value > 0) {
      return Math.max(1, Math.round(value));
    }
  }

  const secondKeys = [
    "windowSeconds",
    "window_seconds",
    "limitWindowSeconds",
    "limit_window_seconds",
    "periodSeconds",
    "period_seconds",
    "intervalSeconds",
    "interval_seconds",
  ];

  for (const key of secondKeys) {
    const seconds = asNumber(bucket[key]);
    if (seconds !== null && seconds > 0) {
      return Math.max(1, Math.round(seconds / 60));
    }
  }

  return parseWindowMinutesFromText(tokenType);
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
  if (parsed.protocol !== "https:" && !isLoopbackHost(parsed.hostname)) {
    throw new HttpError(500, "invalid_usage_url", "Usage URL must use HTTPS.");
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
      .replace(
        /(["']?(?:key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi,
        "$1[redacted]",
      )
      .replace(/(\bBearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
      .replace(/(\bBasic\s+)[A-Za-z0-9+/=._~-]+/gi, "$1[redacted]");

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
  let reason: string | null = null;

  for (const detail of asArray(errorRecord.details)) {
    const detailRecord = asRecord(detail);
    if (!detailRecord) {
      continue;
    }

    const detailReason = asString(detailRecord.reason);
    if (detailReason) {
      reason = detailReason;
      break;
    }

    const metadata = asRecord(detailRecord.metadata);
    const metadataReason = metadata ? asString(metadata.reason) : null;
    if (metadataReason) {
      reason = metadataReason;
      break;
    }
  }

  const summary = message ?? directMessage ?? status;
  if (!summary) {
    return reason;
  }

  if (reason && !summary.includes(reason)) {
    return `${summary} (${reason})`;
  }

  return summary;
}

function extractUpstreamValidationLink(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const errorRecord = asRecord(root.error);
  if (!errorRecord) {
    return null;
  }

  const directMetadata = asRecord(errorRecord.metadata);
  const directLink = asHttpsUrl(directMetadata?.validation_link ?? directMetadata?.validationUrl);
  if (directLink) {
    return directLink;
  }

  for (const detail of asArray(errorRecord.details)) {
    const detailRecord = asRecord(detail);
    if (!detailRecord) {
      continue;
    }

    for (const linkEntry of asArray(detailRecord.links)) {
      const linkRecord = asRecord(linkEntry);
      const link = asHttpsUrl(linkRecord?.url);
      if (link) {
        return link;
      }
    }

    const metadata = asRecord(detailRecord.metadata);
    const metadataLink = asHttpsUrl(metadata?.validation_link ?? metadata?.validationUrl);
    if (metadataLink) {
      return metadataLink;
    }
  }

  return null;
}

function geminiAccountVerificationIssue(validationUrl: string): QuotaSyncIssue {
  return {
    kind: "account_verification_required",
    title: "Account verification required",
    steps: [
      "Open the Google verification page.",
      "Finish verification with the same Google account you connected here.",
      "Return here and refresh your dashboard.",
    ],
    actionLabel: "Verify account",
    actionUrl: validationUrl,
  };
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

function extractProviderMetadata(payload: unknown): ProviderMetadata {
  const planType = deepFindFirstString(payload, PLAN_TYPE_KEYS);
  const explicitBalance = deepFindFirstString(payload, CREDIT_BALANCE_KEYS);
  if (explicitBalance !== null) {
    return {
      planType,
      creditsBalance: explicitBalance,
    };
  }

  const totalCredits = deepFindFirstNumber(payload, CREDIT_TOTAL_KEYS);
  if (totalCredits === null) {
    return {
      planType,
      creditsBalance: null,
    };
  }

  const totalUsage = deepFindFirstNumber(payload, CREDIT_USED_KEYS);
  const remaining = totalUsage === null ? totalCredits : Math.max(totalCredits - totalUsage, 0);
  return {
    planType,
    creditsBalance: remaining.toFixed(2),
  };
}

function combineProviderMetadata(payloads: Array<unknown | null>): ProviderMetadata {
  let planType: string | null = null;
  let creditsBalance: string | null = null;

  for (const payload of payloads) {
    if (payload === null) {
      continue;
    }

    const metadata = extractProviderMetadata(payload);
    if (planType === null && metadata.planType !== null) {
      planType = metadata.planType;
    }
    if (creditsBalance === null && metadata.creditsBalance !== null) {
      creditsBalance = metadata.creditsBalance;
    }

    if (planType !== null && creditsBalance !== null) {
      break;
    }
  }

  return {
    planType,
    creditsBalance,
  };
}

function usageEndpointAuthMismatchHint(
  status: number,
  detail: string | null,
  providerConfig: ProviderUsageConfig,
): string | null {
  if (status !== 401 && status !== 403) {
    return null;
  }

  const usingApiKeyMode = providerConfig.authMode === "query-api-key" || providerConfig.authMode === "x-api-key";
  if (!usingApiKeyMode) {
    return null;
  }

  const normalizedDetail = (detail ?? "").trim().toLowerCase();
  const indicatesOauthOnly =
    normalizedDetail.includes("api keys are not supported") ||
    normalizedDetail.includes("expected oauth") ||
    normalizedDetail.includes("oauth2 access token") ||
    normalizedDetail.includes("credentials_missing");

  if (!indicatesOauthOnly) {
    return null;
  }

  return "Configured usage endpoint requires OAuth credentials. Use an API-key-compatible usage endpoint or connect this account with OAuth.";
}

export class ProviderUsageService {
  public constructor(private readonly config: AppConfig) {}

  private isGeminiOauthAccount(account: ConnectedAccount): boolean {
    return account.provider === "gemini" && effectiveAccountAuthMethod(account) === "oauth";
  }

  private geminiCodeAssistQuotaEndpoint(): string {
    const baseUrl = asString(process.env.CODE_ASSIST_ENDPOINT) ?? GEMINI_CODE_ASSIST_BASE_URL;
    const apiVersion = asString(process.env.CODE_ASSIST_API_VERSION) ?? GEMINI_CODE_ASSIST_API_VERSION;
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedVersion = apiVersion.replace(/^\/+|\/+$/g, "");
    return `${normalizedBase}/${normalizedVersion}:retrieveUserQuota`;
  }

  private buildGeminiQuotaRequestBodies(projectIds: Array<string | null | undefined>): Record<string, string>[] {
    const result: Record<string, string>[] = [];
    const seen = new Set<string>();

    for (const rawProjectId of projectIds) {
      const projectId = typeof rawProjectId === "string" ? rawProjectId.trim() : "";
      if (projectId.length > 0) {
        const key = `project:${projectId}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        result.push({ project: projectId });
        continue;
      }

      if (!seen.has("empty")) {
        seen.add("empty");
        result.push({});
      }
    }

    if (!seen.has("empty")) {
      result.push({});
    }

    return result;
  }

  private isGeminiBootstrapRetryCandidate(message: string): boolean {
    const normalizedMessage = message.trim().toLowerCase();
    return (
      normalizedMessage.includes("validation_required") ||
      normalizedMessage.includes("verify your account") ||
      normalizedMessage.includes("permission denied") ||
      normalizedMessage.includes("missing project")
    );
  }

  private shouldRetryGeminiQuotaWithBootstrap(error: HttpError): boolean {
    const normalizedMessage = error.message.trim().toLowerCase();
    const is403 = normalizedMessage.includes("status 403");
    const is400 = normalizedMessage.includes("status 400");
    if (!is403 && !is400) {
      return false;
    }

    return this.isGeminiBootstrapRetryCandidate(normalizedMessage);
  }

  private withGeminiValidationHint(error: HttpError): HttpError {
    const normalizedMessage = error.message.trim().toLowerCase();
    const hasStatus403 = normalizedMessage.includes("status 403");
    if (!hasStatus403 || !this.isGeminiBootstrapRetryCandidate(normalizedMessage)) {
      return error;
    }

    const hint = "Complete account verification in Google Gemini Code Assist and retry.";
    if (normalizedMessage.includes("complete account verification in google gemini code assist")) {
      return error;
    }

    return new HttpError(error.status, error.code, `${error.message} ${hint}`, error.context);
  }

  private async fetchGeminiCodeAssistProjectId(
    accessToken: string,
    preferredProjectId: string | null,
  ): Promise<string | null> {
    return await fetchGeminiCliProjectId(accessToken, {
      preferredProjectId,
    });
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
      throw new HttpError(
        502,
        "provider_usage_fetch_failed",
        errorMessage(error, "Could not fetch live usage from provider."),
      );
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
      const validationLink = extractUpstreamValidationLink(payload);
      const quotaSyncIssue = validationLink ? geminiAccountVerificationIssue(validationLink) : null;
      throw new HttpError(
        502,
        "provider_usage_fetch_failed",
        detail
          ? `Usage endpoint returned status ${response.status}. ${detail}`
          : `Usage endpoint returned status ${response.status}.`,
        quotaSyncIssue ? { quotaSyncIssue } : null,
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
    const configuredProjectId = account.providerAccountId.trim();
    const projectId = configuredProjectId.length > 0 ? configuredProjectId : null;
    const requestBodies = this.buildGeminiQuotaRequestBodies([projectId, null]);
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
          lastError = new HttpError(
            502,
            "provider_usage_fetch_failed",
            errorMessage(error, "Could not fetch live usage from provider."),
          );
        }
      }
    }

    if (payload === null && lastError && this.shouldRetryGeminiQuotaWithBootstrap(lastError)) {
      const discoveredProjectId = await this.fetchGeminiCodeAssistProjectId(accessToken, projectId);
      const retryRequestBodies = this.buildGeminiQuotaRequestBodies([discoveredProjectId, projectId, null]);

      for (const requestBody of retryRequestBodies) {
        try {
          payload = await this.postGeminiQuotaRequest(endpoint, accessToken, requestBody);
          lastError = null;
          break;
        } catch (error) {
          if (error instanceof HttpError) {
            lastError = error;
          } else {
            lastError = new HttpError(
              502,
              "provider_usage_fetch_failed",
              errorMessage(error, "Could not fetch live usage from provider."),
            );
          }
        }
      }
    }

    if (payload === null) {
      if (lastError) {
        throw this.withGeminiValidationHint(lastError);
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
      resetKeyMs: number | null;
      tokenType: string | null;
      windowMinutes: number | null;
    }> = [];

    const syncedAtMs = Date.now();

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
      const extractedWindowMinutes = extractBucketWindowMinutes(bucket, tokenType);
      const windowMinutes =
        extractedWindowMinutes ?? inferWindowMinutesFromReset(resetMs, syncedAtMs);
      const resetKeyMs = resetMs === null ? null : Math.round(resetMs / 60_000) * 60_000;

      bucketWindows.push({
        remainingFraction: normalizedRemaining,
        resetMs,
        resetKeyMs,
        tokenType,
        windowMinutes,
      });
    }

    if (bucketWindows.length === 0) {
      return null;
    }

    const syncedAt = new Date(syncedAtMs).toISOString();
    const groupedWindows = new Map<
      string,
      {
        remainingFractions: number[];
        resetMs: number | null;
        resetKeyMs: number | null;
        tokenType: string | null;
        windowMinutes: number | null;
      }
    >();

    for (const bucketWindow of bucketWindows) {
      const key = `${bucketWindow.tokenType ?? "unknown"}|${bucketWindow.resetKeyMs ?? "na"}|${bucketWindow.windowMinutes ?? "na"}`;
      const existing = groupedWindows.get(key);
      if (existing) {
        existing.remainingFractions.push(bucketWindow.remainingFraction);
        if (existing.windowMinutes === null && bucketWindow.windowMinutes !== null) {
          existing.windowMinutes = bucketWindow.windowMinutes;
        }
        continue;
      }

      groupedWindows.set(key, {
        remainingFractions: [bucketWindow.remainingFraction],
        resetMs: bucketWindow.resetMs,
        resetKeyMs: bucketWindow.resetKeyMs,
        tokenType: bucketWindow.tokenType,
        windowMinutes: bucketWindow.windowMinutes,
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
          windowMinutes: windowGroup.windowMinutes,
          windowStartedAt: syncedAt,
          resetsAt: windowGroup.resetMs === null ? null : new Date(windowGroup.resetMs).toISOString(),
          resetMs: windowGroup.resetKeyMs,
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

      const authMethod = effectiveAccountAuthMethod(account);
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

      const authMethod = effectiveAccountAuthMethod(account);
      return authMethod === "api" || authMethod === "oauth";
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
      errors.push(`Could not refresh 5h usage (${errorMessage(fiveHourResult.reason, "provider request failed")}).`);
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
      errors.push(`Could not refresh 7d usage (${errorMessage(weeklyResult.reason, "provider request failed")}).`);
            return fallbackWindowFromAccount(account, "weekly", weeklyLimit);
          })();

    const metadata = combineProviderMetadata([
      fiveHourResult.status === "fulfilled" ? fiveHourResult.value : null,
      weeklyResult.status === "fulfilled" ? weeklyResult.value : null,
    ]);

    if (errors.length >= 2) {
      const hasBalanceMetadata = metadata.planType !== null || metadata.creditsBalance !== null;
      if (!hasBalanceMetadata) {
        throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
      }

      return {
        fiveHour: {
          ...fiveHourWindow,
        },
        weekly: {
          ...weeklyWindow,
        },
        planType: metadata.planType,
        creditsBalance: metadata.creditsBalance,
        syncedAt,
        partial: true,
        syncError: JSON_TOTALS_METADATA_ONLY_SYNC_MESSAGE,
      };
    }

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadata.planType,
      creditsBalance: metadata.creditsBalance,
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
      errors.push(`Could not refresh 5h usage (${errorMessage(fiveHourResult.reason, "provider request failed")}).`);
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
      errors.push(`Could not refresh 7d usage (${errorMessage(weeklyResult.reason, "provider request failed")}).`);
            return fallbackWindowFromAccount(account, "weekly", weeklyLimit);
          })();

    const metadata = combineProviderMetadata([
      fiveHourResult.status === "fulfilled" ? fiveHourResult.value : null,
      weeklyResult.status === "fulfilled" ? weeklyResult.value : null,
    ]);

    if (errors.length >= 2) {
      const hasBalanceMetadata = metadata.planType !== null || metadata.creditsBalance !== null;
      if (!hasBalanceMetadata) {
        throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
      }

      return {
        fiveHour: {
          ...fiveHourWindow,
        },
        weekly: {
          ...weeklyWindow,
        },
        planType: metadata.planType,
        creditsBalance: metadata.creditsBalance,
        syncedAt,
        partial: true,
        syncError: JSON_TOTALS_METADATA_ONLY_SYNC_MESSAGE,
      };
    }

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadata.planType,
      creditsBalance: metadata.creditsBalance,
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
        ? errorMessage(fiveHourResult.reason, "provider request failed")
                : `response had no usable quota fields (${JSON_TOTALS_FIELD_HINT})`;
            errors.push(`Could not refresh 5h usage (${reason}).`);
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
        ? errorMessage(weeklyResult.reason, "provider request failed")
                : `response had no usable quota fields (${JSON_TOTALS_FIELD_HINT})`;
            errors.push(`Could not refresh 7d usage (${reason}).`);
            return fallbackWindowFromAccount(account, "weekly", normalizeLimit(providerConfig.weeklyLimit));
          })();

    const metadata = combineProviderMetadata([
      fiveHourResult.status === "fulfilled" ? fiveHourResult.value : null,
      weeklyResult.status === "fulfilled" ? weeklyResult.value : null,
    ]);

    if (errors.length >= 2) {
      const hasBalanceMetadata = metadata.planType !== null || metadata.creditsBalance !== null;
      if (!hasBalanceMetadata) {
        throw new HttpError(502, "provider_usage_fetch_failed", errors.join(" "));
      }

      return {
        fiveHour: {
          ...fiveHourWindow,
        },
        weekly: {
          ...weeklyWindow,
        },
        planType: metadata.planType,
        creditsBalance: metadata.creditsBalance,
        syncedAt,
        partial: true,
        syncError: JSON_TOTALS_METADATA_ONLY_SYNC_MESSAGE,
      };
    }

    return {
      fiveHour: {
        ...fiveHourWindow,
      },
      weekly: {
        ...weeklyWindow,
      },
      planType: metadata.planType,
      creditsBalance: metadata.creditsBalance,
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
    const message = errorMessage(error, "Could not fetch live usage from provider.");
      throw new HttpError(502, "provider_usage_fetch_failed", message);
    }

    if (!response.ok) {
      const rawBody = await response.text();
      let parsedPayload: unknown = null;
      if (rawBody.trim().length > 0) {
        try {
          parsedPayload = JSON.parse(rawBody) as unknown;
        } catch {
          parsedPayload = null;
        }
      }

      const detail =
        extractUpstreamError(parsedPayload) ??
        (() => {
          if (rawBody.trim().length === 0) {
            return null;
          }

          const compact = rawBody.replace(/\s+/g, " ").trim();
          if (compact.length === 0) {
            return null;
          }

          return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
        })();

      const sanitizedDetail = detail ? errorMessage(new Error(detail), detail) : null;
      const authHint = usageEndpointAuthMismatchHint(response.status, sanitizedDetail, providerConfig);
      const baseMessage = sanitizedDetail
        ? `Usage endpoint returned status ${response.status}. ${sanitizedDetail}`
        : `Usage endpoint returned status ${response.status}.`;

      throw new HttpError(502, "provider_usage_fetch_failed", authHint ? `${baseMessage} ${authHint}` : baseMessage);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new HttpError(502, "provider_usage_parse_failed", "Usage endpoint returned invalid JSON.");
    }
  }
}
