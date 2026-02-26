import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { AppConfig, OAuthProviderProfileConfig } from "../config";
import { HttpError } from "../errors";
import { OAuthLinkedAccountPayload, ProviderId, QuotaWindowMode } from "../types";
import {
  buildClaudeAuthorizationCodeTokenPayload,
  buildCodexOAuthProfile,
  CODEX_OAUTH_PROFILE_ID,
  codexUsageCandidateUrls,
  extractCodexRateLimitPayload,
  fetchGeminiCliProjectId,
} from "./oauth-provider/index";
import { resilientFetch } from "./http-resilience";

export { extractGeminiCliProjectId } from "./oauth-provider/index";

interface AuthorizationParamsInput {
  state: string;
  redirectUri: string;
  codeChallenge: string;
}

interface OAuthProfileMetadata {
  id: string;
  label: string;
  configured: boolean;
}

interface TokenPayload {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
  idToken: string | null;
  rawResponse: Record<string, unknown>;
}

interface ParsedQuota {
  fiveHourLimit?: number;
  fiveHourUsed?: number;
  weeklyLimit?: number;
  weeklyUsed?: number;
}

interface OpenAiClaims {
  sub?: string;
  name?: string;
  email?: string;
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

interface RateLimitWindowCandidate {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAtEpochSeconds: number | null;
}

interface LiveQuotaWindow {
  limit: number;
  used: number;
  mode: QuotaWindowMode;
  windowStartedAt: string;
  resetsAt: string | null;
}

interface LiveQuotaSnapshot {
  fiveHour: LiveQuotaWindow;
  weekly: LiveQuotaWindow;
  planType: string | null;
  creditsBalance: string | null;
  syncedAt: string;
  partial: boolean;
  syncError: string | null;
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

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = asString(record[key]);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function oauthErrorSummary(record: Record<string, unknown>): string | null {
  const errorRecord = asRecord(record.error);
  const errorCode =
    asString(record.error) ?? asString(record.code) ?? asString(errorRecord?.type ?? errorRecord?.code) ?? null;

  const errorDescription =
    asString(record.error_description) ??
    asString(record.errorDescription) ??
    asString(record.message) ??
    asString(errorRecord?.message) ??
    null;

  if (errorCode && errorDescription) {
    return `${errorCode}: ${errorDescription}`;
  }

  if (errorDescription) {
    return errorDescription;
  }

  return errorCode;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = asNumber(record[key]);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function padBase64(base64Url: string): string {
  const remainder = base64Url.length % 4;
  if (remainder === 0) {
    return base64Url;
  }

  return `${base64Url}${"=".repeat(4 - remainder)}`;
}

function decodeJwtClaims(jwtToken: string | null): OpenAiClaims | null {
  if (!jwtToken) {
    return null;
  }

  const segments = jwtToken.split(".");
  if (segments.length < 2) {
    return null;
  }

  const payload = segments[1];
  if (!payload) {
    return null;
  }

  try {
    const base64 = padBase64(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return (asRecord(parsed) as OpenAiClaims | null) ?? null;
  } catch {
    return null;
  }
}

function extractOpenAiAccountId(claims: OpenAiClaims | null): string | null {
  if (!claims) {
    return null;
  }

  const nestedClaim = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof nestedClaim === "string" && nestedClaim.length > 0) {
    return nestedClaim;
  }

  if (typeof claims.chatgpt_account_id === "string" && claims.chatgpt_account_id.length > 0) {
    return claims.chatgpt_account_id;
  }

  const organizationId = claims.organizations?.[0]?.id;
  if (typeof organizationId === "string" && organizationId.length > 0) {
    return organizationId;
  }

  return null;
}

function inferQuotaFromPayload(payload: Record<string, unknown>): ParsedQuota {
  const direct: ParsedQuota = {
    fiveHourLimit: pickNumber(payload, [
      "fiveHourLimit",
      "five_hour_limit",
      "fiveHourQuotaLimit",
      "rolling5hLimit",
      "quota5hLimit",
    ]),
    fiveHourUsed: pickNumber(payload, [
      "fiveHourUsed",
      "five_hour_used",
      "fiveHourQuotaUsed",
      "rolling5hUsed",
      "quota5hUsed",
    ]),
    weeklyLimit: pickNumber(payload, ["weeklyLimit", "weekly_limit", "weekLimit", "weeklyQuotaLimit"]),
    weeklyUsed: pickNumber(payload, ["weeklyUsed", "weekly_used", "weekUsed", "weeklyQuotaUsed"]),
  };

  const fiveHourContainer = asRecord(
    payload.fiveHour ?? payload.five_hour ?? payload.rolling5h ?? payload.quota5h,
  );
  if (fiveHourContainer) {
    direct.fiveHourLimit ??= pickNumber(fiveHourContainer, ["limit", "max", "total"]);
    direct.fiveHourUsed ??= pickNumber(fiveHourContainer, ["used", "consumed", "current"]);
  }

  const weeklyContainer = asRecord(
    payload.weekly ?? payload.week ?? payload.quotaWeekly ?? payload.quota_weekly,
  );
  if (weeklyContainer) {
    direct.weeklyLimit ??= pickNumber(weeklyContainer, ["limit", "max", "total"]);
    direct.weeklyUsed ??= pickNumber(weeklyContainer, ["used", "consumed", "current"]);
  }

  return direct;
}

function clampQuotaValue(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }

  return rounded;
}

function toTokenExpiresAt(expiresInSeconds: unknown): string {
  const seconds = asNumber(expiresInSeconds) ?? 3600;
  const safeSeconds = seconds > 0 ? seconds : 3600;
  return new Date(Date.now() + safeSeconds * 1000).toISOString();
}

function ensureHttpsUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    ) {
      throw new Error("OAuth endpoints must use HTTPS.");
    }

    return parsed.toString();
  } catch {
    throw new HttpError(500, "invalid_oauth_configuration", "OAuth endpoint URL configuration is invalid.");
  }
}

function parseRateLimitWindowCandidate(record: Record<string, unknown>): RateLimitWindowCandidate | null {
  const usedPercent = asNumber(record.used_percent ?? record.usedPercent);
  if (usedPercent === undefined) {
    return null;
  }

  const limitWindowSeconds = asNumber(record.limit_window_seconds ?? record.limitWindowSeconds);
  const limitWindowMinutes = asNumber(
    record.limit_window_minutes ??
      record.limitWindowMinutes ??
      record.windowDurationMins ??
      record.window_duration_mins,
  );
  const windowMinutes =
    limitWindowMinutes !== undefined
      ? Math.round(limitWindowMinutes)
      : limitWindowSeconds !== undefined
        ? Math.round(limitWindowSeconds / 60)
        : null;

  const explicitResetAt = asNumber(record.reset_at ?? record.resetAt ?? record.resetsAt ?? record.resets_at);
  const resetAfterSeconds = asNumber(record.reset_after_seconds ?? record.resetAfterSeconds);
  const resetsAtEpochSeconds =
    explicitResetAt !== undefined
      ? Math.round(explicitResetAt)
      : resetAfterSeconds !== undefined
        ? Math.round(Date.now() / 1000 + resetAfterSeconds)
        : null;

  return {
    usedPercent: Math.max(0, Math.min(usedPercent, 100)),
    windowMinutes,
    resetsAtEpochSeconds,
  };
}

function pickWindow(
  windows: RateLimitWindowCandidate[],
  targetMinutes: number,
  toleranceMinutes: number,
): RateLimitWindowCandidate | null {
  if (windows.length === 0) {
    return null;
  }

  const windowsWithSize = windows.filter((window) => window.windowMinutes !== null);
  if (windowsWithSize.length === 0) {
    return windows[0] ?? null;
  }

  const inTolerance = windowsWithSize.filter((window) => {
    const minutes = window.windowMinutes;
    return minutes !== null && Math.abs(minutes - targetMinutes) <= toleranceMinutes;
  });

  const candidates = inTolerance.length > 0 ? inTolerance : windowsWithSize;
  const sorted = [...candidates].sort((a, b) => {
    const aDelta = Math.abs((a.windowMinutes ?? targetMinutes) - targetMinutes);
    const bDelta = Math.abs((b.windowMinutes ?? targetMinutes) - targetMinutes);
    if (aDelta !== bDelta) {
      return aDelta - bDelta;
    }

    const aReset = a.resetsAtEpochSeconds ?? Number.MAX_SAFE_INTEGER;
    const bReset = b.resetsAtEpochSeconds ?? Number.MAX_SAFE_INTEGER;
    return aReset - bReset;
  });

  return sorted[0] ?? null;
}

function toIsoFromEpochSeconds(epochSeconds: number | null): string | null {
  if (epochSeconds === null) {
    return null;
  }

  const ms = Math.round(epochSeconds * 1000);
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }

  return new Date(ms).toISOString();
}

function windowStartedAtIso(windowMinutes: number | null, resetsAtEpochSeconds: number | null): string {
  if (windowMinutes !== null && resetsAtEpochSeconds !== null) {
    const startMs = resetsAtEpochSeconds * 1000 - windowMinutes * 60 * 1000;
    if (Number.isFinite(startMs) && startMs > 0) {
      return new Date(startMs).toISOString();
    }
  }

  return new Date().toISOString();
}

function toLiveQuotaWindow(window: RateLimitWindowCandidate): LiveQuotaWindow {
  return {
    limit: 100,
    used: Number(window.usedPercent.toFixed(2)),
    mode: "percent",
    windowStartedAt: windowStartedAtIso(window.windowMinutes, window.resetsAtEpochSeconds),
    resetsAt: toIsoFromEpochSeconds(window.resetsAtEpochSeconds),
  };
}

function parseRetryAfterSecondsFromRateLimitError(rawMessage: string): number | null {
  if (!rawMessage.trim()) {
    return null;
  }

  const match = /try again in\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i.exec(rawMessage);
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  const retryAfterSeconds =
    Math.max(Number.isNaN(hours) ? 0 : hours, 0) * 60 * 60 +
    Math.max(Number.isNaN(minutes) ? 0 : minutes, 0) * 60 +
    Math.max(Number.isNaN(seconds) ? 0 : seconds, 0);

  return retryAfterSeconds > 0 ? retryAfterSeconds : null;
}

function buildRateLimitPayloadFromRetryAfter(retryAfterSeconds: number): Record<string, unknown> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const resetsAt = nowEpochSeconds + retryAfterSeconds;

  return {
    rate_limit: {
      primary_window: {
        used_percent: 100,
        limit_window_minutes: 300,
        reset_after_seconds: retryAfterSeconds,
        reset_at: resetsAt,
      },
      secondary_window: {
        used_percent: 100,
        limit_window_minutes: 10_080,
        reset_after_seconds: retryAfterSeconds,
        reset_at: resetsAt,
      },
    },
    additional_rate_limits: [],
  };
}

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export class OAuthProviderService {
  public constructor(private readonly config: AppConfig) {}

  private providerRedirectPort(): string {
    try {
      const parsed = new URL(this.config.oauthRedirectUri);
      if (parsed.port) {
        return parsed.port;
      }
    } catch {
    }

    return String(this.config.port || 1455);
  }

  private geminiRedirectUri(): string {
    const port = this.providerRedirectPort();
    return `http://127.0.0.1:${port}/oauth2callback`;
  }

  private profileConfigured(profile: OAuthProviderProfileConfig): boolean {
    return Boolean(profile.clientId && profile.authorizationUrl && profile.tokenUrl);
  }

  private profilesFor(providerId: ProviderId): OAuthProviderProfileConfig[] {
    if (providerId === "codex") {
      return [buildCodexOAuthProfile(this.config)];
    }

    return this.config.oauthProfiles[providerId] ?? [];
  }

  private resolveProfile(providerId: ProviderId, profileId: string): OAuthProviderProfileConfig {
    const profiles = this.profilesFor(providerId);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new HttpError(404, "oauth_profile_not_found", `OAuth profile not found: ${providerId}/${profileId}`);
    }

    return profile;
  }

  public redirectUri(): string {
    return this.config.oauthRedirectUri;
  }

  public redirectUriFor(providerId: ProviderId, _profileId: string): string {
    if (providerId === "gemini") {
      return this.geminiRedirectUri();
    }

    return this.redirectUri();
  }

  public isConfigured(): boolean {
    const codexProfile = this.profilesFor("codex").find((profile) => profile.id === CODEX_OAUTH_PROFILE_ID);
    return codexProfile ? this.profileConfigured(codexProfile) : false;
  }

  public oauthProfiles(providerId: ProviderId): OAuthProfileMetadata[] {
    return this.profilesFor(providerId).map((profile) => ({
      id: profile.id,
      label: profile.label,
      configured: this.profileConfigured(profile),
    }));
  }

  public isOAuthProfileConfigured(providerId: ProviderId, profileId: string): boolean {
    const profile = this.resolveProfile(providerId, profileId);
    return this.profileConfigured(profile);
  }

  public assertOAuthProfileConfigured(providerId: ProviderId, profileId: string): void {
    const profile = this.resolveProfile(providerId, profileId);
    if (!this.profileConfigured(profile)) {
      throw new HttpError(
        503,
        "oauth_not_configured",
        `OAuth profile is not configured for ${providerId}/${profileId}.`,
      );
    }
  }

  public publicMetadata(): {
    providerName: string;
    configured: boolean;
    authorizationUrl: string;
    scopes: string[];
  } {
    return {
      providerName: this.config.oauthProviderName,
      configured: this.isConfigured(),
      authorizationUrl: this.config.oauthAuthorizationUrl,
      scopes: [...this.config.oauthScopes],
    };
  }

  public assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new HttpError(
        503,
        "oauth_not_configured",
        "OAuth defaults are unavailable. Verify OpenAI OAuth endpoint configuration.",
      );
    }
  }

  public createState(): string {
    return `st_${crypto.randomBytes(20).toString("hex")}`;
  }

  public createPkceVerifier(): string {
    return crypto.randomBytes(48).toString("base64url");
  }

  public createPkceChallenge(verifier: string): string {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }

  public isTokenNearExpiry(tokenExpiresAt: string): boolean {
    const expiresAtMs = Date.parse(tokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return true;
    }

    const refreshBufferMs = 5 * 60 * 1000;
    return Date.now() >= expiresAtMs - refreshBufferMs;
  }

  public authorizationUrl(input: AuthorizationParamsInput): string {
    return this.authorizationUrlFor("codex", CODEX_OAUTH_PROFILE_ID, input);
  }

  public authorizationUrlFor(
    providerId: ProviderId,
    profileId: string,
    input: AuthorizationParamsInput,
  ): string {
    const profile = this.resolveProfile(providerId, profileId);
    this.assertOAuthProfileConfigured(providerId, profileId);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: profile.clientId,
      redirect_uri: input.redirectUri,
      scope: profile.scopes.join(" "),
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    });

    if (profile.originator) {
      params.set("originator", profile.originator);
    }

    for (const [key, value] of Object.entries(profile.extraParams)) {
      params.set(key, value);
    }

    const url = new URL(ensureHttpsUrl(profile.authorizationUrl));
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  public async exchangeCode(input: {
    code: string;
    state?: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthLinkedAccountPayload> {
    return this.exchangeCodeFor("codex", CODEX_OAUTH_PROFILE_ID, input);
  }

  public async exchangeCodeFor(
    providerId: ProviderId,
    profileId: string,
    input: {
      code: string;
      state?: string;
      redirectUri: string;
      codeVerifier: string;
    },
  ): Promise<OAuthLinkedAccountPayload> {
    if (providerId === "codex" && profileId === CODEX_OAUTH_PROFILE_ID) {
      return this.exchangeCodeCodex(input);
    }

    const profile = this.resolveProfile(providerId, profileId);
    this.assertOAuthProfileConfigured(providerId, profileId);

    const tokenPayload = await this.fetchAuthorizationCodeTokenForProvider(providerId, profile, input);
    const idClaims = decodeJwtClaims(tokenPayload.idToken ?? tokenPayload.accessToken);
    const userInfoPayload = await this.fetchUserInfoWithUrl(profile.userInfoUrl, tokenPayload.accessToken);
    const idSource = (userInfoPayload ?? idClaims ?? tokenPayload.rawResponse) as Record<string, unknown>;

    let providerAccountId =
      pickString(idSource, ["sub", "id", "user_id", "account_id", "uid", "email"]) ??
      `oauth_${crypto.createHash("sha256").update(tokenPayload.accessToken).digest("hex").slice(0, 16)}`;

    if (
      providerId === "gemini" &&
      profileId === "gemini-cli" &&
      profile.authorizationUrl.includes("accounts.google.com")
    ) {
      const geminiProjectId = await fetchGeminiCliProjectId(tokenPayload.accessToken);
      if (geminiProjectId) {
        providerAccountId = geminiProjectId;
      }
    }

    const displayName =
      pickString(idSource, ["name", "preferred_username", "username", "email", "login"]) ??
      `${providerId.toUpperCase()} OAuth ${providerAccountId.slice(0, 8).toUpperCase()}`;

    const usageDefaults = this.config.providerUsage[providerId];
    const fiveHourLimit =
      usageDefaults && usageDefaults.fiveHourLimit > 0
        ? usageDefaults.fiveHourLimit
        : this.config.defaultFiveHourLimit > 0
          ? this.config.defaultFiveHourLimit
          : 0;
    const weeklyLimit =
      usageDefaults && usageDefaults.weeklyLimit > 0
        ? usageDefaults.weeklyLimit
        : this.config.defaultWeeklyLimit > 0
          ? this.config.defaultWeeklyLimit
          : 0;
    const nowIso = new Date().toISOString();

    return {
      provider: providerId,
      oauthProfileId: profileId,
      providerAccountId,
      chatgptAccountId: null,
      displayName,
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      tokenExpiresAt: tokenPayload.tokenExpiresAt,
      quotaSyncedAt: nowIso,
      quotaSyncStatus: fiveHourLimit > 0 && weeklyLimit > 0 ? "stale" : "unavailable",
      quotaSyncError: null,
      planType: null,
      creditsBalance: null,
      quota: {
        fiveHourLimit,
        fiveHourUsed: 0,
        fiveHourMode: "units",
        fiveHourWindowStartedAt: nowIso,
        fiveHourResetsAt: null,
        weeklyLimit,
        weeklyUsed: 0,
        weeklyMode: "units",
        weeklyWindowStartedAt: nowIso,
        weeklyResetsAt: null,
      },
    };
  }

  private async exchangeCodeCodex(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthLinkedAccountPayload> {
    this.assertConfigured();
    const tokenPayload = await this.fetchAuthorizationCodeToken(input);

    const idClaims = decodeJwtClaims(tokenPayload.idToken ?? tokenPayload.accessToken);
    const chatgptAccountId = extractOpenAiAccountId(idClaims);

    const userInfoPayload = await this.fetchUserInfo(tokenPayload.accessToken);
    const idSource = (userInfoPayload ?? idClaims ?? tokenPayload.rawResponse) as Record<string, unknown>;

    const providerAccountId =
      pickString(idSource, ["sub", "id", "user_id", "account_id", "uid", "email"]) ??
      chatgptAccountId ??
      `oauth_${crypto.createHash("sha256").update(tokenPayload.accessToken).digest("hex").slice(0, 16)}`;

    const displayName =
      pickString(idSource, ["name", "preferred_username", "username", "email", "login"]) ??
      `Connected Account ${providerAccountId.slice(0, 8).toUpperCase()}`;

    let quotaSyncStatus: "live" | "stale" | "unavailable" = "unavailable";
    let quotaSyncError: string | null = null;
    let quotaSyncedAt: string | null = null;
    let planType: string | null = null;
    let creditsBalance: string | null = null;

    let fiveHourLimit = 0;
    let fiveHourUsed = 0;
    let fiveHourWindowStartedAt = new Date().toISOString();
    let fiveHourResetsAt: string | null = null;
    let fiveHourMode: QuotaWindowMode = "units";

    let weeklyLimit = 0;
    let weeklyUsed = 0;
    let weeklyWindowStartedAt = new Date().toISOString();
    let weeklyResetsAt: string | null = null;
    let weeklyMode: QuotaWindowMode = "units";

    try {
      const liveQuotaSnapshot = await this.fetchLiveQuotaSnapshot(
        tokenPayload.accessToken,
        chatgptAccountId,
      );

      if (liveQuotaSnapshot) {
        quotaSyncStatus = "live";
        quotaSyncedAt = liveQuotaSnapshot.syncedAt;
        planType = liveQuotaSnapshot.planType;
        creditsBalance = liveQuotaSnapshot.creditsBalance;

        fiveHourLimit = liveQuotaSnapshot.fiveHour.limit;
        fiveHourUsed = liveQuotaSnapshot.fiveHour.used;
        fiveHourMode = liveQuotaSnapshot.fiveHour.mode;
        fiveHourWindowStartedAt = liveQuotaSnapshot.fiveHour.windowStartedAt;
        fiveHourResetsAt = liveQuotaSnapshot.fiveHour.resetsAt;

        weeklyLimit = liveQuotaSnapshot.weekly.limit;
        weeklyUsed = liveQuotaSnapshot.weekly.used;
        weeklyMode = liveQuotaSnapshot.weekly.mode;
        weeklyWindowStartedAt = liveQuotaSnapshot.weekly.windowStartedAt;
        weeklyResetsAt = liveQuotaSnapshot.weekly.resetsAt;
      }
    } catch (error) {
      quotaSyncError = error instanceof Error ? error.message : "Live usage sync failed.";
    }

    if (quotaSyncStatus !== "live") {
      const rawQuota = tokenPayload.rawResponse
        ? inferQuotaFromPayload(tokenPayload.rawResponse)
        : {};

      if (rawQuota.fiveHourLimit !== undefined && rawQuota.weeklyLimit !== undefined) {
        quotaSyncStatus = "stale";
        quotaSyncedAt = new Date().toISOString();

        fiveHourLimit = clampQuotaValue(rawQuota.fiveHourLimit, this.config.defaultFiveHourLimit);
        fiveHourUsed = clampQuotaValue(rawQuota.fiveHourUsed, this.config.defaultFiveHourUsed);
        weeklyLimit = clampQuotaValue(rawQuota.weeklyLimit, this.config.defaultWeeklyLimit);
        weeklyUsed = clampQuotaValue(rawQuota.weeklyUsed, this.config.defaultWeeklyUsed);
      }
    }

    if (quotaSyncStatus === "unavailable" && this.config.oauthRequireQuota) {
      throw new HttpError(
        502,
        "quota_unavailable",
        quotaSyncError ??
          "OAuth succeeded but live OpenAI quota data is unavailable. Please retry in a moment.",
      );
    }

    return {
      provider: "codex",
      oauthProfileId: CODEX_OAUTH_PROFILE_ID,
      providerAccountId,
      chatgptAccountId,
      displayName,
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      tokenExpiresAt: tokenPayload.tokenExpiresAt,
      quotaSyncedAt,
      quotaSyncStatus,
      quotaSyncError,
      planType,
      creditsBalance,
      quota: {
        fiveHourLimit,
        fiveHourUsed,
        fiveHourMode,
        fiveHourWindowStartedAt,
        fiveHourResetsAt,
        weeklyLimit,
        weeklyUsed,
        weeklyMode,
        weeklyWindowStartedAt,
        weeklyResetsAt,
      },
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: string;
  }> {
    const tokenPayload = await this.fetchRefreshToken(refreshToken);
    return {
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      tokenExpiresAt: tokenPayload.tokenExpiresAt,
    };
  }

  public async fetchLiveQuotaSnapshot(
    accessToken: string,
    chatgptAccountId?: string | null,
  ): Promise<LiveQuotaSnapshot | null> {
    const payload = await this.fetchUsagePayload(accessToken, chatgptAccountId);
    if (!payload) {
      return null;
    }

    return this.parseLiveQuotaSnapshot(payload);
  }

  private parseLiveQuotaSnapshot(payload: Record<string, unknown>): LiveQuotaSnapshot | null {
    const windows = this.collectRateLimitWindows(payload);
    const fiveHourWindow = pickWindow(windows, 300, 120);
    const remainingAfterFiveHour = windows.filter((window) => window !== fiveHourWindow);
    const weeklyWindow = pickWindow(remainingAfterFiveHour, 10_080, 3_000);

    if (!fiveHourWindow || !weeklyWindow) {
      return null;
    }

    const root = asRecord(payload.result) ?? payload;
    const credits = asRecord(payload.credits ?? root.credits);
    const creditsBalance = credits ? asString(credits.balance) ?? null : null;
    const planType = asString(payload.plan_type ?? root.plan_type ?? root.planType) ?? null;
    const syncedAt = new Date().toISOString();

    return {
      fiveHour: toLiveQuotaWindow(fiveHourWindow),
      weekly: toLiveQuotaWindow(weeklyWindow),
      planType,
      creditsBalance,
      syncedAt,
      partial: false,
      syncError: null,
    };
  }

  private collectRateLimitWindows(payload: Record<string, unknown>): RateLimitWindowCandidate[] {
    const windows: RateLimitWindowCandidate[] = [];

    const mainRateLimit = asRecord(payload.rate_limit);
    if (mainRateLimit) {
      const primary = asRecord(mainRateLimit.primary_window);
      const secondary = asRecord(mainRateLimit.secondary_window);
      if (primary) {
        const parsed = parseRateLimitWindowCandidate(primary);
        if (parsed) {
          windows.push(parsed);
        }
      }

      if (secondary) {
        const parsed = parseRateLimitWindowCandidate(secondary);
        if (parsed) {
          windows.push(parsed);
        }
      }
    }

    for (const additional of asArray(payload.additional_rate_limits)) {
      const additionalRecord = asRecord(additional);
      if (!additionalRecord) {
        continue;
      }

      const additionalRateLimit = asRecord(additionalRecord.rate_limit);
      if (!additionalRateLimit) {
        continue;
      }

      const primary = asRecord(additionalRateLimit.primary_window);
      const secondary = asRecord(additionalRateLimit.secondary_window);

      if (primary) {
        const parsed = parseRateLimitWindowCandidate(primary);
        if (parsed) {
          windows.push(parsed);
        }
      }

      if (secondary) {
        const parsed = parseRateLimitWindowCandidate(secondary);
        if (parsed) {
          windows.push(parsed);
        }
      }
    }

    const root = asRecord(payload.result) ?? payload;
    const codexRateLimits = asRecord(root.rateLimits ?? root.rate_limits);
    if (codexRateLimits) {
      const primary = asRecord(codexRateLimits.primary ?? codexRateLimits.primary_window);
      const secondary = asRecord(codexRateLimits.secondary ?? codexRateLimits.secondary_window);

      if (primary) {
        const parsed = parseRateLimitWindowCandidate(primary);
        if (parsed) {
          windows.push(parsed);
        }
      }

      if (secondary) {
        const parsed = parseRateLimitWindowCandidate(secondary);
        if (parsed) {
          windows.push(parsed);
        }
      }
    }

    return windows;
  }

  private async fetchCodexRateLimitsViaAppServer(): Promise<Record<string, unknown> | null> {
    if (!this.config.codexAppServerEnabled) {
      return null;
    }

    const command = this.config.codexAppServerCommand.trim();
    if (!command) {
      return null;
    }

    const timeoutMs = Math.max(500, this.config.codexAppServerTimeoutMs);

    return await new Promise<Record<string, unknown> | null>((resolve) => {
      let settled = false;
      const finish = (value: Record<string, unknown> | null): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        if (child.stdout) {
          child.stdout.off("data", handleStdout);
        }

        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.destroy();
        }

        if (!child.killed) {
          child.kill();
        }

        resolve(value);
      };

      let stdoutBuffer = "";
      const handleStdout = (chunk: Buffer | string): void => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdoutBuffer += text;

        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

          if (rawLine.length > 0) {
            try {
              const parsed = JSON.parse(rawLine) as unknown;
              const record = asRecord(parsed);
              if (record) {
                const extracted = extractCodexRateLimitPayload(record);
                if (extracted) {
                  finish(extracted);
                  return;
                }
              }
            } catch {
              continue;
            }
          }

          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      };

      const child = spawn(command, this.config.codexAppServerArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        finish(null);
      }, timeoutMs);

      child.once("error", (error) => {
        if (errnoCode(error) === "ENOENT") {
          finish(null);
          return;
        }

        finish(null);
      });

      child.once("close", () => {
        if (settled) {
          return;
        }

        const remaining = stdoutBuffer.trim();
        if (remaining.length > 0) {
          try {
            const parsed = JSON.parse(remaining) as unknown;
            const record = asRecord(parsed);
            if (record) {
              finish(extractCodexRateLimitPayload(record));
              return;
            }
          } catch {
            finish(null);
            return;
          }
        }

        finish(null);
      });

      if (child.stdout) {
        child.stdout.on("data", handleStdout);
      }

      if (!child.stdin) {
        finish(null);
        return;
      }

      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: "omni-connector-rate-limits",
        method: "account/rateLimits/read",
      });

      child.stdin.write(`${payload}\n`, "utf8", () => {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        }
      });
    });
  }

  private async fetchUsagePayload(
    accessToken: string,
    chatgptAccountId?: string | null,
  ): Promise<Record<string, unknown> | null> {
    if (!this.config.oauthQuotaUrl) {
      const appServerPayload = await this.fetchCodexRateLimitsViaAppServer();
      if (appServerPayload) {
        return appServerPayload;
      }
    }

    const candidateUrls = codexUsageCandidateUrls(this.config.oauthQuotaUrl);

    let lastError: string | null = null;

    for (const candidateUrl of candidateUrls) {
      try {
        const endpoint = ensureHttpsUrl(candidateUrl);
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "omni-connector/1.0",
        };
        if (chatgptAccountId) {
          headers["ChatGPT-Account-Id"] = chatgptAccountId;
        }

        const response = await resilientFetch(
          endpoint,
          {
            method: "GET",
            headers,
          },
          {
            timeoutMs: 12_000,
            maxAttempts: 3,
            baseDelayMs: 400,
            maxDelayMs: 2_000,
            retryableStatusCodes: new Set([408, 425, 500, 502, 503, 504]),
          },
        );

        if (!response.ok) {
          if (response.status === 429) {
            const rateLimitBody = await response.text().catch(() => "");
            const retryAfterSeconds = parseRetryAfterSecondsFromRateLimitError(rateLimitBody);
            if (retryAfterSeconds !== null) {
              return buildRateLimitPayloadFromRetryAfter(retryAfterSeconds);
            }
          }

          lastError = `status ${response.status}`;
          continue;
        }

        const parsed = (await response.json().catch(() => null)) as unknown;
        const payload = asRecord(parsed);
        if (!payload) {
          lastError = "non-object payload";
          continue;
        }

        return payload;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Usage endpoint request failed.";
      }
    }

    if (lastError !== null) {
      throw new HttpError(502, "oauth_quota_fetch_failed", `Live usage sync failed (${lastError}).`);
    }

    return null;
  }

  private async fetchAuthorizationCodeToken(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenPayload> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.config.oauthClientId,
      code_verifier: input.codeVerifier,
    });

    if (this.config.oauthClientSecret) {
      form.set("client_secret", this.config.oauthClientSecret);
    }

    return this.postTokenRequest(form);
  }

  private async fetchAuthorizationCodeTokenForProfile(
    profile: OAuthProviderProfileConfig,
    input: {
      code: string;
      state?: string;
      redirectUri: string;
      codeVerifier: string;
    },
  ): Promise<TokenPayload> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: profile.clientId,
      code_verifier: input.codeVerifier,
    });

    if (profile.clientSecret) {
      form.set("client_secret", profile.clientSecret);
    }

    return this.postTokenRequestWithUrl(profile.tokenUrl, form);
  }

  private async fetchAuthorizationCodeTokenForProvider(
    providerId: ProviderId,
    profile: OAuthProviderProfileConfig,
    input: {
      code: string;
      state?: string;
      redirectUri: string;
      codeVerifier: string;
    },
  ): Promise<TokenPayload> {
    if (providerId === "claude") {
      const payload = buildClaudeAuthorizationCodeTokenPayload(profile, input);
      return this.postJsonTokenRequestWithUrl(profile.tokenUrl, payload);
    }

    return this.fetchAuthorizationCodeTokenForProfile(profile, input);
  }

  private async fetchRefreshToken(refreshToken: string): Promise<TokenPayload> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.oauthClientId,
    });

    if (this.config.oauthClientSecret) {
      form.set("client_secret", this.config.oauthClientSecret);
    }

    return this.postTokenRequest(form);
  }

  private async postTokenRequest(form: URLSearchParams): Promise<TokenPayload> {
    const tokenUrl = ensureHttpsUrl(this.config.oauthTokenUrl);
    return this.postTokenRequestWithUrl(tokenUrl, form);
  }

  private async parseTokenResponse(response: Response): Promise<TokenPayload> {
    const rawBody = await response.text();
    let parsed: unknown = null;

    if (rawBody.trim().length > 0) {
      try {
        parsed = JSON.parse(rawBody) as unknown;
      } catch {
        parsed = null;
      }
    }

    const record = asRecord(parsed);
    if (!response.ok || !record) {
      if (!response.ok) {
        const baseMessage = `OAuth token exchange failed with status ${response.status}.`;
        const details = record ? oauthErrorSummary(record) : "OAuth token endpoint returned non-JSON response.";
        throw new HttpError(
          502,
          "oauth_token_exchange_failed",
          details ? `${baseMessage} ${details}` : baseMessage,
        );
      }

      throw new HttpError(502, "oauth_token_parse_error", "OAuth token endpoint returned non-JSON response.");
    }

    const accessToken = pickString(record, ["access_token"]);
    if (!accessToken) {
      throw new HttpError(502, "oauth_token_missing", "OAuth token response is missing access_token.");
    }

    return {
      accessToken,
      refreshToken: pickString(record, ["refresh_token"]) ?? null,
      tokenExpiresAt: toTokenExpiresAt(record.expires_in),
      idToken: pickString(record, ["id_token"]) ?? null,
      rawResponse: record,
    };
  }

  private async postTokenRequestWithUrl(tokenUrl: string, form: URLSearchParams): Promise<TokenPayload> {
    const safeTokenUrl = ensureHttpsUrl(tokenUrl);

    let response: Response;
    try {
      response = await resilientFetch(
        safeTokenUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: form,
        },
        {
          timeoutMs: 12_000,
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 2_000,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth token request failed.";
      throw new HttpError(502, "oauth_token_request_failed", message);
    }

    return this.parseTokenResponse(response);
  }

  private async postJsonTokenRequestWithUrl(
    tokenUrl: string,
    payload: Record<string, string>,
  ): Promise<TokenPayload> {
    const safeTokenUrl = ensureHttpsUrl(tokenUrl);

    let response: Response;
    try {
      response = await resilientFetch(
        safeTokenUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
        {
          timeoutMs: 12_000,
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 2_000,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth token request failed.";
      throw new HttpError(502, "oauth_token_request_failed", message);
    }

    return this.parseTokenResponse(response);
  }

  private async fetchUserInfo(accessToken: string): Promise<Record<string, unknown> | null> {
    return this.fetchUserInfoWithUrl(this.config.oauthUserInfoUrl, accessToken);
  }

  private async fetchUserInfoWithUrl(
    userInfoUrl: string | null,
    accessToken: string,
  ): Promise<Record<string, unknown> | null> {
    if (!userInfoUrl) {
      return null;
    }

    let response: Response;
    try {
      response = await resilientFetch(
        ensureHttpsUrl(userInfoUrl),
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
        {
          timeoutMs: 10_000,
          maxAttempts: 2,
          baseDelayMs: 350,
          maxDelayMs: 1_500,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth user info request failed.";
      throw new HttpError(502, "oauth_userinfo_failed", message);
    }

    if (!response.ok) {
      throw new HttpError(
        502,
        "oauth_userinfo_failed",
        `OAuth user info endpoint failed with status ${response.status}.`,
      );
    }

    const parsed = (await response.json().catch(() => null)) as unknown;
    return asRecord(parsed);
  }
}
