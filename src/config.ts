import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

export interface AppConfig {
  host: string;
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
  oauthRequireQuota: boolean;
  defaultFiveHourLimit: number;
  defaultWeeklyLimit: number;
  defaultFiveHourUsed: number;
  defaultWeeklyUsed: number;
}

function parseHost(rawValue: string | undefined): string {
  const value = rawValue?.trim();
  if (!value) {
    return "127.0.0.1";
  }

  return value;
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
  } catch {}

  return generatedSecret;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataFilePath = env.DATA_FILE ?? path.join(process.cwd(), "data", "store.json");
  const publicDir = env.PUBLIC_DIR ?? path.join(process.cwd(), "public");
  const sessionSecretFilePath = resolveSessionSecretFilePath(env.SESSION_SECRET_FILE, dataFilePath);

  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    dataFilePath,
    publicDir,
    sessionSecret: resolveSessionSecret(env.SESSION_SECRET, sessionSecretFilePath),
    oauthRedirectUri: parseRequiredUrl(env.OAUTH_REDIRECT_URI, "http://localhost:1455/auth/callback"),
    oauthProviderName: env.OAUTH_PROVIDER_NAME ?? "OpenAI",
    oauthAuthorizationUrl: parseRequiredUrl(
      env.OAUTH_AUTHORIZATION_URL,
      "https://auth.openai.com/oauth/authorize",
    ),
    oauthTokenUrl: parseRequiredUrl(
      env.OAUTH_TOKEN_URL,
      "https://auth.openai.com/oauth/token",
    ),
    oauthUserInfoUrl: parseOptionalUrl(env.OAUTH_USERINFO_URL),
    oauthQuotaUrl: parseOptionalUrl(env.OAUTH_QUOTA_URL),
    oauthClientId: env.OAUTH_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann",
    oauthClientSecret: env.OAUTH_CLIENT_SECRET ?? "",
    oauthScopes: parseScopes(env.OAUTH_SCOPES),
    oauthOriginator: env.OAUTH_ORIGINATOR ?? "pi",
    oauthRequireQuota: parseBoolean(env.OAUTH_REQUIRE_QUOTA, true),
    defaultFiveHourLimit: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_LIMIT, 0),
    defaultWeeklyLimit: parseNonNegativeInt(env.DEFAULT_WEEKLY_LIMIT, 0),
    defaultFiveHourUsed: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_USED, 0),
    defaultWeeklyUsed: parseNonNegativeInt(env.DEFAULT_WEEKLY_USED, 0),
  };
}
