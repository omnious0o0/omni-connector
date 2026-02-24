import crypto from "node:crypto";
import { AppConfig } from "../config";
import { HttpError } from "../errors";
import { OAuthLinkedAccountPayload, QuotaWindowMode } from "../types";

interface AuthorizationParamsInput {
  state: string;
  redirectUri: string;
  codeChallenge: string;
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
  const usedPercent = asNumber(record.used_percent);
  if (usedPercent === undefined) {
    return null;
  }

  const limitWindowSeconds = asNumber(record.limit_window_seconds);
  const limitWindowMinutes = asNumber(record.limit_window_minutes);
  const windowMinutes =
    limitWindowMinutes !== undefined
      ? Math.round(limitWindowMinutes)
      : limitWindowSeconds !== undefined
        ? Math.round(limitWindowSeconds / 60)
        : null;

  const explicitResetAt = asNumber(record.reset_at);
  const resetAfterSeconds = asNumber(record.reset_after_seconds);
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

export class OAuthProviderService {
  public constructor(private readonly config: AppConfig) {}

  public redirectUri(): string {
    return this.config.oauthRedirectUri;
  }

  public isConfigured(): boolean {
    return Boolean(
      this.config.oauthClientId &&
        this.config.oauthAuthorizationUrl &&
        this.config.oauthTokenUrl,
    );
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
    this.assertConfigured();

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.oauthClientId,
      redirect_uri: input.redirectUri,
      scope: this.config.oauthScopes.join(" "),
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      codex_cli_simplified_flow: "true",
      id_token_add_organizations: "true",
      originator: this.config.oauthOriginator,
    });

    const url = new URL(ensureHttpsUrl(this.config.oauthAuthorizationUrl));
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  public async exchangeCode(input: {
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

    const fiveHourWindow = pickWindow(windows, 300, 120);
    const remainingAfterFiveHour = windows.filter((window) => window !== fiveHourWindow);
    const weeklyWindow = pickWindow(remainingAfterFiveHour, 10_080, 3_000);

    if (!fiveHourWindow || !weeklyWindow) {
      return null;
    }

    const credits = asRecord(payload.credits);
    const creditsBalance = credits ? asString(credits.balance) ?? null : null;
    const planType = asString(payload.plan_type) ?? null;
    const syncedAt = new Date().toISOString();

    return {
      fiveHour: toLiveQuotaWindow(fiveHourWindow),
      weekly: toLiveQuotaWindow(weeklyWindow),
      planType,
      creditsBalance,
      syncedAt,
    };
  }

  private async fetchUsagePayload(
    accessToken: string,
    chatgptAccountId?: string | null,
  ): Promise<Record<string, unknown> | null> {
    const candidateUrls = [
      "https://chatgpt.com/backend-api/wham/usage",
      "https://chatgpt.com/backend-api/codex/wham/usage",
    ];

    if (this.config.oauthQuotaUrl) {
      candidateUrls.unshift(this.config.oauthQuotaUrl);
    }

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

        const response = await fetch(endpoint, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(12_000),
        });

        if (!response.ok) {
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

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth token request failed.";
      throw new HttpError(502, "oauth_token_request_failed", message);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new HttpError(502, "oauth_token_parse_error", "OAuth token endpoint returned non-JSON response.");
    }

    const record = asRecord(parsed);
    if (!response.ok || !record) {
      throw new HttpError(
        502,
        "oauth_token_exchange_failed",
        `OAuth token exchange failed with status ${response.status}.`,
      );
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

  private async fetchUserInfo(accessToken: string): Promise<Record<string, unknown> | null> {
    if (!this.config.oauthUserInfoUrl) {
      return null;
    }

    let response: Response;
    try {
      response = await fetch(ensureHttpsUrl(this.config.oauthUserInfoUrl), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
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
