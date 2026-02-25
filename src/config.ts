import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { PROVIDER_CATALOG, providerOAuthProfileDefinitions, providerUsageDefinition } from "./providers";
import { ProviderId } from "./types";

export type ProviderUsageParser = "openai_usage" | "anthropic_usage" | "json_totals";
export type ProviderUsageAuthMode = "bearer" | "x-api-key" | "query-api-key";

export interface ProviderUsageConfig {
  parser: ProviderUsageParser;
  authMode: ProviderUsageAuthMode;
  authQueryParam: string;
  baseUrl: string | null;
  fiveHourUrl: string | null;
  weeklyUrl: string | null;
  headers: Record<string, string>;
  fiveHourLimit: number;
  weeklyLimit: number;
  apiKeyOverride: string | null;
}

export interface OAuthProviderProfileConfig {
  id: string;
  label: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string | null;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  originator: string | null;
  extraParams: Record<string, string>;
}

export interface AppConfig {
  host: string;
  allowRemoteDashboard: boolean;
  strictLiveQuota: boolean;
  port: number;
  dataFilePath: string;
  publicDir: string;
  sessionSecret: string;
  oauthRedirectUri: string;
  oauthProviderName: string;
  oauthAuthorizationUrl: string;
  oauthTokenUrl: string;
  oauthUserInfoUrl: string | null;
  oauthQuotaUrl: string | null;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScopes: string[];
  oauthOriginator: string;
  codexAppServerEnabled: boolean;
  codexAppServerCommand: string;
  codexAppServerArgs: string[];
  codexAppServerTimeoutMs: number;
  oauthRequireQuota: boolean;
  defaultFiveHourLimit: number;
  defaultWeeklyLimit: number;
  defaultFiveHourUsed: number;
  defaultWeeklyUsed: number;
  providerUsage: Record<ProviderId, ProviderUsageConfig>;
  oauthProfiles: Record<ProviderId, OAuthProviderProfileConfig[]>;
}

function parseHost(rawValue: string | undefined): string {
  const value = rawValue?.trim();
  if (!value) {
    return "127.0.0.1";
  }

  return value;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }

  if (/^127\.(\d{1,3}\.){2}\d{1,3}$/.test(normalized)) {
    return true;
  }

  return normalized === "127.0.0.1";
}

function parsePort(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return 1455;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return 1455;
  }

  return parsedValue;
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

function parseOptionalUrl(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseRequiredUrl(rawValue: string | undefined, fallback: string): string {
  return parseOptionalUrl(rawValue) ?? fallback;
}

function parseCommandArgs(rawValue: string | undefined, fallback: string[]): string[] {
  const value = rawValue?.trim();
  if (!value) {
    return [...fallback];
  }

  const args = value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return args.length > 0 ? args : [...fallback];
}

function parseScopes(rawValue: string | undefined): string[] {
  const source = rawValue ?? "openid profile email offline_access";
  return source
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNonNegativeInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value < 0) {
    return fallback;
  }

  return value;
}

function parseEnumValue<T extends string>(
  rawValue: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!rawValue) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return allowed.includes(normalized as T) ? (normalized as T) : fallback;
}

function parseJsonRecord(rawValue: string | undefined): Record<string, string> {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
}

function nonEmptyEnvValue(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function shouldIgnoreChmodError(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "EPERM" || code === "ENOSYS" || code === "EINVAL";
}

interface ProviderUsageDefaults {
  parser: ProviderUsageParser;
  authMode: ProviderUsageAuthMode;
  authQueryParam?: string;
  baseUrl?: string | null;
  fiveHourUrl?: string | null;
  weeklyUrl?: string | null;
  fiveHourLimit?: number;
  weeklyLimit?: number;
  headers?: Record<string, string>;
}

interface OAuthProfileDefaults {
  label: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string | null;
  scopes: string;
  originator?: string | null;
  extraParams?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
}

function parseOAuthProfileConfig(
  env: NodeJS.ProcessEnv,
  prefix: string,
  id: string,
  defaults: OAuthProfileDefaults,
): OAuthProviderProfileConfig {
  const authorizationUrl = parseRequiredUrl(
    env[`${prefix}_OAUTH_AUTHORIZATION_URL`],
    defaults.authorizationUrl,
  );
  const tokenUrl = parseRequiredUrl(env[`${prefix}_OAUTH_TOKEN_URL`], defaults.tokenUrl);

  return {
    id,
    label: nonEmptyEnvValue(env[`${prefix}_OAUTH_LABEL`]) ?? defaults.label,
    authorizationUrl,
    tokenUrl,
    userInfoUrl:
      parseOptionalUrl(env[`${prefix}_OAUTH_USERINFO_URL`]) ??
      parseOptionalUrl(defaults.userInfoUrl ?? "") ??
      null,
    clientId: nonEmptyEnvValue(env[`${prefix}_OAUTH_CLIENT_ID`]) ?? defaults.clientId ?? "",
    clientSecret:
      nonEmptyEnvValue(env[`${prefix}_OAUTH_CLIENT_SECRET`]) ?? defaults.clientSecret ?? "",
    scopes: parseScopes(nonEmptyEnvValue(env[`${prefix}_OAUTH_SCOPES`]) ?? defaults.scopes),
    originator:
      nonEmptyEnvValue(env[`${prefix}_OAUTH_ORIGINATOR`]) ?? defaults.originator ?? null,
    extraParams: defaults.extraParams ?? {},
  };
}

function parseOAuthProfiles(env: NodeJS.ProcessEnv): Record<ProviderId, OAuthProviderProfileConfig[]> {
  const profilesByProvider = {} as Record<ProviderId, OAuthProviderProfileConfig[]>;

  for (const provider of PROVIDER_CATALOG) {
    const profileDefinitions = providerOAuthProfileDefinitions(provider.id);
    profilesByProvider[provider.id] = profileDefinitions.map((definition) =>
      parseOAuthProfileConfig(env, definition.envPrefix, definition.id, definition.defaults),
    );
  }

  return profilesByProvider;
}

function parseProviderUsageConfig(
  env: NodeJS.ProcessEnv,
  prefix: string,
  defaults: ProviderUsageDefaults,
): ProviderUsageConfig {
  const parser = parseEnumValue<ProviderUsageParser>(
    env[`${prefix}_USAGE_PARSER`],
    ["openai_usage", "anthropic_usage", "json_totals"],
    defaults.parser,
  );

  const authMode = parseEnumValue<ProviderUsageAuthMode>(
    env[`${prefix}_USAGE_AUTH_MODE`],
    ["bearer", "x-api-key", "query-api-key"],
    defaults.authMode,
  );

  const authQueryParam = env[`${prefix}_USAGE_AUTH_QUERY_PARAM`] ?? defaults.authQueryParam ?? "key";
  const baseUrl = parseOptionalUrl(env[`${prefix}_USAGE_BASE_URL`]) ?? defaults.baseUrl ?? null;
  const fiveHourUrl = parseOptionalUrl(env[`${prefix}_USAGE_5H_URL`]) ?? defaults.fiveHourUrl ?? null;
  const weeklyUrl = parseOptionalUrl(env[`${prefix}_USAGE_7D_URL`]) ?? defaults.weeklyUrl ?? null;
  const headers = {
    ...(defaults.headers ?? {}),
    ...parseJsonRecord(env[`${prefix}_USAGE_HEADERS_JSON`]),
  };

  return {
    parser,
    authMode,
    authQueryParam,
    baseUrl,
    fiveHourUrl,
    weeklyUrl,
    headers,
    fiveHourLimit: parseNonNegativeInt(env[`${prefix}_FIVE_HOUR_LIMIT`], defaults.fiveHourLimit ?? 0),
    weeklyLimit: parseNonNegativeInt(env[`${prefix}_WEEKLY_LIMIT`], defaults.weeklyLimit ?? 0),
    apiKeyOverride: env[`${prefix}_USAGE_API_KEY`]?.trim() || null,
  };
}

function parseProviderUsageConfigMap(env: NodeJS.ProcessEnv): Record<ProviderId, ProviderUsageConfig> {
  const usageByProvider = {} as Record<ProviderId, ProviderUsageConfig>;

  for (const provider of PROVIDER_CATALOG) {
    const usageDefinition = providerUsageDefinition(provider.id);
    usageByProvider[provider.id] = parseProviderUsageConfig(
      env,
      usageDefinition.envPrefix,
      usageDefinition.defaults,
    );
  }

  return usageByProvider;
}

function resolveSessionSecretFilePath(rawValue: string | undefined, dataFilePath: string): string {
  const configuredPath = rawValue?.trim();
  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    return path.resolve(process.cwd(), configuredPath);
  }

  return `${dataFilePath}.session`;
}

function resolveSessionSecret(rawValue: string | undefined, sessionSecretFilePath: string): string {
  const secret = rawValue?.trim();
  if (secret) {
    return secret;
  }

  if (fs.existsSync(sessionSecretFilePath)) {
    const storedSecret = fs.readFileSync(sessionSecretFilePath, "utf8").trim();
    if (!storedSecret) {
      throw new Error(`SESSION_SECRET file is empty at ${sessionSecretFilePath}.`);
    }

    return storedSecret;
  }

  const generatedSecret = crypto.randomBytes(32).toString("base64url");
  const secretDirectoryPath = path.dirname(sessionSecretFilePath);
  fs.mkdirSync(secretDirectoryPath, { recursive: true });
  fs.writeFileSync(sessionSecretFilePath, generatedSecret, {
    encoding: "utf8",
    mode: 0o600,
  });

  try {
    fs.chmodSync(sessionSecretFilePath, 0o600);
  } catch (error) {
    if (!shouldIgnoreChmodError(error)) {
      throw error;
    }
  }

  return generatedSecret;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = parsePort(env.PORT);
  const dataFilePath = env.DATA_FILE ?? path.join(process.cwd(), "data", "store.json");
  const publicDir = env.PUBLIC_DIR ?? path.join(process.cwd(), "public");
  const sessionSecretFilePath = resolveSessionSecretFilePath(env.SESSION_SECRET_FILE, dataFilePath);
  const host = parseHost(env.HOST);
  const allowRemoteDashboard = parseBoolean(env.ALLOW_REMOTE_DASHBOARD, false);
  const strictLiveQuota = parseBoolean(env.STRICT_LIVE_QUOTA, false);
  const providerUsage = parseProviderUsageConfigMap(env);
  const oauthProfiles = parseOAuthProfiles(env);
  const defaultRedirectUri = "http://localhost:1455/auth/callback";

  if (!allowRemoteDashboard && !isLoopbackHost(host)) {
    throw new Error(
      `HOST must be loopback unless ALLOW_REMOTE_DASHBOARD=true. Received HOST=${host}.`,
    );
  }

  return {
    host,
    allowRemoteDashboard,
    strictLiveQuota,
    port,
    dataFilePath,
    publicDir,
    sessionSecret: resolveSessionSecret(env.SESSION_SECRET, sessionSecretFilePath),
    oauthRedirectUri: parseRequiredUrl(env.OAUTH_REDIRECT_URI, defaultRedirectUri),
    oauthProviderName: nonEmptyEnvValue(env.OAUTH_PROVIDER_NAME) ?? "OpenAI",
    oauthAuthorizationUrl: parseRequiredUrl(
      nonEmptyEnvValue(env.OAUTH_AUTHORIZATION_URL) ?? undefined,
      "https://auth.openai.com/oauth/authorize",
    ),
    oauthTokenUrl: parseRequiredUrl(
      nonEmptyEnvValue(env.OAUTH_TOKEN_URL) ?? undefined,
      "https://auth.openai.com/oauth/token",
    ),
    oauthUserInfoUrl: parseOptionalUrl(env.OAUTH_USERINFO_URL),
    oauthQuotaUrl: parseOptionalUrl(env.OAUTH_QUOTA_URL),
    oauthClientId: nonEmptyEnvValue(env.OAUTH_CLIENT_ID) ?? "app_EMoamEEZ73f0CkXaXp7hrann",
    oauthClientSecret: nonEmptyEnvValue(env.OAUTH_CLIENT_SECRET) ?? "",
    oauthScopes: parseScopes(nonEmptyEnvValue(env.OAUTH_SCOPES) ?? undefined),
    oauthOriginator: nonEmptyEnvValue(env.OAUTH_ORIGINATOR) ?? "pi",
    codexAppServerEnabled: parseBoolean(env.CODEX_APP_SERVER_ENABLED, true),
    codexAppServerCommand: nonEmptyEnvValue(env.CODEX_APP_SERVER_COMMAND) ?? "codex",
    codexAppServerArgs: parseCommandArgs(env.CODEX_APP_SERVER_ARGS, ["app-server"]),
    codexAppServerTimeoutMs: parsePositiveInt(env.CODEX_APP_SERVER_TIMEOUT_MS, 3500),
    oauthRequireQuota: parseBoolean(env.OAUTH_REQUIRE_QUOTA, true),
    defaultFiveHourLimit: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_LIMIT, 0),
    defaultWeeklyLimit: parseNonNegativeInt(env.DEFAULT_WEEKLY_LIMIT, 0),
    defaultFiveHourUsed: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_USED, 0),
    defaultWeeklyUsed: parseNonNegativeInt(env.DEFAULT_WEEKLY_USED, 0),
    providerUsage,
    oauthProfiles,
  };
}
