import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { PROVIDER_CATALOG, providerOAuthProfileDefinitions, providerUsageDefinition } from "./providers";
import { ProviderId } from "./types";

export type ProviderUsageParser = "openai_usage" | "anthropic_usage" | "json_totals";
export type ProviderUsageAuthMode = "bearer" | "x-api-key" | "query-api-key";
export type SessionStoreMode = "memory" | "memorystore";
export const DEFAULT_PORT = 38471;
const MIN_SESSION_SECRET_BYTES = 16;

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
  trustProxyHops: number;
  strictLiveQuota: boolean;
  port: number;
  dataFilePath: string;
  publicDir: string;
  sessionSecret: string;
  sessionStore: SessionStoreMode;
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
  codexChatgptBaseUrl: string;
  oauthRequireQuota: boolean;
  defaultFiveHourLimit: number;
  defaultWeeklyLimit: number;
  defaultFiveHourUsed: number;
  defaultWeeklyUsed: number;
  providerInferenceBaseUrls: Record<ProviderId, string>;
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

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const unwrapped = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;

  if (unwrapped === "localhost" || unwrapped === "::1") {
    return true;
  }

  const mappedV4 = unwrapped.startsWith("::ffff:") ? unwrapped.slice("::ffff:".length) : unwrapped;
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mappedV4);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 127;
}

function parsePort(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_PORT;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return DEFAULT_PORT;
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

function enforceOAuthRedirectUriPolicy(rawValue: string, allowRemoteDashboard: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("OAUTH_REDIRECT_URI must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OAUTH_REDIRECT_URI must use http:// or https://.");
  }

  const isLoopbackRedirect = isLoopbackHost(parsed.hostname);
  if (!allowRemoteDashboard && !isLoopbackRedirect) {
    throw new Error(
      `OAUTH_REDIRECT_URI must use a loopback host unless ALLOW_REMOTE_DASHBOARD=true. Received ${parsed.hostname}.`,
    );
  }

  if (allowRemoteDashboard && !isLoopbackRedirect && parsed.protocol !== "https:") {
    throw new Error("OAUTH_REDIRECT_URI must use HTTPS for non-loopback hosts.");
  }

  return parsed.toString();
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

function assertSecretFilePermissions(filePath: string, label: string): void {
  if (process.platform === "win32") {
    return;
  }

  const stats = fs.statSync(filePath);
  const mode = stats.mode & 0o777;
  const ownerReadable = (mode & 0o400) !== 0;
  const groupOrWorldAccessible = (mode & 0o077) !== 0;
  if (!ownerReadable || groupOrWorldAccessible) {
    throw new Error(`${label} at ${filePath} must be owner-readable and not accessible by group or others.`);
  }
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

interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

let cachedGeminiCliOAuthDiscoveryPath: string | null = null;
let cachedGeminiCliOAuthCredentials: OAuthClientCredentials | null = null;
let cachedAntigravityOAuthDiscoveryPath: string | null = null;
let cachedAntigravityOAuthCredentials: OAuthClientCredentials | null = null;

function isGoogleOAuthClientId(value: string): boolean {
  return /^\d{8,}-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(value.trim());
}

function isGoogleOAuthClientSecret(value: string): boolean {
  return /^GOCSPX-[A-Za-z0-9_-]+$/.test(value.trim());
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parsePlainGoogleOAuthClientCredentials(source: string): OAuthClientCredentials | null {
  const firstClientId = source.match(/\d{8,}-[a-z0-9]+\.apps\.googleusercontent\.com/i)?.[0] ?? null;
  const firstClientSecret = source.match(/GOCSPX-[A-Za-z0-9_-]+/)?.[0] ?? null;
  if (!firstClientId || !firstClientSecret) {
    return null;
  }

  if (!isGoogleOAuthClientId(firstClientId) || !isGoogleOAuthClientSecret(firstClientSecret)) {
    return null;
  }

  return {
    clientId: firstClientId,
    clientSecret: firstClientSecret,
  };
}

function parseOpenClawAntigravityCredentials(source: string): OAuthClientCredentials | null {
  const encodedClientId = source.match(/CLIENT_ID\s*=\s*decode\("([A-Za-z0-9+/=]+)"\)/)?.[1] ?? null;
  const encodedClientSecret = source.match(/CLIENT_SECRET\s*=\s*decode\("([A-Za-z0-9+/=]+)"\)/)?.[1] ?? null;
  if (!encodedClientId || !encodedClientSecret) {
    return parsePlainGoogleOAuthClientCredentials(source);
  }

  const decodedClientId = decodeBase64Utf8(encodedClientId);
  const decodedClientSecret = decodeBase64Utf8(encodedClientSecret);
  if (!decodedClientId || !decodedClientSecret) {
    return parsePlainGoogleOAuthClientCredentials(source);
  }

  if (!isGoogleOAuthClientId(decodedClientId) || !isGoogleOAuthClientSecret(decodedClientSecret)) {
    return parsePlainGoogleOAuthClientCredentials(source);
  }

  return {
    clientId: decodedClientId,
    clientSecret: decodedClientSecret,
  };
}

function parseDesktopAntigravityCredentials(source: string): OAuthClientCredentials | null {
  const mappedClientId = source.match(/L6t="(\d{8,}-[a-z0-9]+\.apps\.googleusercontent\.com)"/i)?.[1] ?? null;
  const mappedClientSecret = source.match(/B6t="(GOCSPX-[A-Za-z0-9_-]+)"/)?.[1] ?? null;
  if (mappedClientId && mappedClientSecret) {
    return {
      clientId: mappedClientId,
      clientSecret: mappedClientSecret,
    };
  }

  return parsePlainGoogleOAuthClientCredentials(source);
}

function discoverAntigravityOAuthCredentials(pathValue: string | undefined): OAuthClientCredentials | null {
  const normalizedPathValue = pathValue ?? "";
  if (cachedAntigravityOAuthDiscoveryPath === normalizedPathValue) {
    return cachedAntigravityOAuthCredentials;
  }

  type Candidate = {
    sourcePath: string;
    parser: "openclaw" | "desktop" | "plain";
  };

  const candidates: Candidate[] = [];

  const openclawExecutablePath = findExecutableInPath(pathValue, ["openclaw"]);
  if (openclawExecutablePath) {
    try {
      const resolvedOpenclawPath = fs.realpathSync(openclawExecutablePath);
      const openclawRootPath = path.dirname(resolvedOpenclawPath);
      candidates.push({
        sourcePath: path.join(
          openclawRootPath,
          "node_modules",
          "@mariozechner",
          "pi-ai",
          "dist",
          "utils",
          "oauth",
          "google-antigravity.js",
        ),
        parser: "openclaw",
      });
      const discoveredOpenclawSourcePath = findFileByName(openclawRootPath, "google-antigravity.js", 10);
      if (discoveredOpenclawSourcePath) {
        candidates.push({
          sourcePath: discoveredOpenclawSourcePath,
          parser: "openclaw",
        });
      }
    } catch {
    }
  }

  const antigravityExecutablePath = findExecutableInPath(pathValue, ["antigravity", "gemini-antigravity"]);
  if (antigravityExecutablePath) {
    try {
      const resolvedAntigravityPath = fs.realpathSync(antigravityExecutablePath);
      const antigravityRootPath = path.dirname(path.dirname(resolvedAntigravityPath));
      candidates.push({
        sourcePath: path.join(antigravityRootPath, "resources", "app", "out", "main.js"),
        parser: "desktop",
      });
    } catch {
    }
  }

  const triedPaths = new Set<string>();
  for (const candidate of candidates) {
    if (triedPaths.has(candidate.sourcePath)) {
      continue;
    }
    triedPaths.add(candidate.sourcePath);

    if (!fs.existsSync(candidate.sourcePath)) {
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(candidate.sourcePath, "utf8");
    } catch {
      continue;
    }

    const parsedCredentials =
      candidate.parser === "openclaw"
        ? parseOpenClawAntigravityCredentials(source)
        : candidate.parser === "desktop"
          ? parseDesktopAntigravityCredentials(source)
          : parsePlainGoogleOAuthClientCredentials(source);
    if (!parsedCredentials) {
      continue;
    }

    cachedAntigravityOAuthDiscoveryPath = normalizedPathValue;
    cachedAntigravityOAuthCredentials = parsedCredentials;
    return parsedCredentials;
  }

  cachedAntigravityOAuthDiscoveryPath = normalizedPathValue;
  cachedAntigravityOAuthCredentials = null;
  return null;
}

function findExecutableInPath(pathValue: string | undefined, commandNames: string[]): string | null {
  const searchDirectories = (pathValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (searchDirectories.length === 0) {
    return null;
  }

  const executableSuffixes = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];

  for (const commandName of commandNames) {
    for (const directory of searchDirectories) {
      for (const suffix of executableSuffixes) {
        const candidatePath = path.join(directory, `${commandName}${suffix}`);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    }
  }

  return null;
}

function findFileByName(directoryPath: string, fileName: string, maxDepth: number): string | null {
  if (maxDepth < 0) {
    return null;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }

    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const nestedResult = findFileByName(entryPath, fileName, maxDepth - 1);
      if (nestedResult) {
        return nestedResult;
      }
    }
  }

  return null;
}

function discoverGeminiCliOAuthCredentials(pathValue: string | undefined): OAuthClientCredentials | null {
  const normalizedPathValue = pathValue ?? "";
  if (cachedGeminiCliOAuthDiscoveryPath === normalizedPathValue) {
    return cachedGeminiCliOAuthCredentials;
  }

  try {
    const geminiExecutablePath = findExecutableInPath(pathValue, ["gemini", "gemini-cli"]);
    if (!geminiExecutablePath) {
      cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
      cachedGeminiCliOAuthCredentials = null;
      return null;
    }

    const resolvedExecutablePath = fs.realpathSync(geminiExecutablePath);
    const geminiRootPath = path.dirname(path.dirname(resolvedExecutablePath));
    const candidateOauthPaths = [
      path.join(
        geminiRootPath,
        "node_modules",
        "@google",
        "gemini-cli-core",
        "dist",
        "src",
        "code_assist",
        "oauth2.js",
      ),
      path.join(geminiRootPath, "node_modules", "@google", "gemini-cli-core", "dist", "code_assist", "oauth2.js"),
    ];

    let oauthSource: string | null = null;
    for (const candidateOauthPath of candidateOauthPaths) {
      if (fs.existsSync(candidateOauthPath)) {
        oauthSource = fs.readFileSync(candidateOauthPath, "utf8");
        break;
      }
    }

    if (!oauthSource) {
      const discoveredOauthPath = findFileByName(geminiRootPath, "oauth2.js", 9);
      if (discoveredOauthPath) {
        oauthSource = fs.readFileSync(discoveredOauthPath, "utf8");
      }
    }

    if (!oauthSource) {
      cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
      cachedGeminiCliOAuthCredentials = null;
      return null;
    }

    const clientIdMatch = oauthSource.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/i);
    const clientSecretMatch = oauthSource.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
    if (!clientIdMatch || !clientSecretMatch) {
      cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
      cachedGeminiCliOAuthCredentials = null;
      return null;
    }

    const matchedClientId = clientIdMatch[1];
    const matchedClientSecret = clientSecretMatch[1];
    if (!matchedClientId || !matchedClientSecret) {
      cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
      cachedGeminiCliOAuthCredentials = null;
      return null;
    }

    cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
    cachedGeminiCliOAuthCredentials = {
      clientId: matchedClientId,
      clientSecret: matchedClientSecret,
    };

    return {
      clientId: matchedClientId,
      clientSecret: matchedClientSecret,
    };
  } catch {
    cachedGeminiCliOAuthDiscoveryPath = normalizedPathValue;
    cachedGeminiCliOAuthCredentials = null;
    return null;
  }
}

function resolveFirstNonEmptyEnv(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = nonEmptyEnvValue(env[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function resolveOAuthClientCredentials(
  env: NodeJS.ProcessEnv,
  prefix: string,
  defaults: OAuthProfileDefaults,
): OAuthClientCredentials {
  const prefixedClientId = nonEmptyEnvValue(env[`${prefix}_OAUTH_CLIENT_ID`]);
  const prefixedClientSecret = nonEmptyEnvValue(env[`${prefix}_OAUTH_CLIENT_SECRET`]);

  let defaultClientId = defaults.clientId ?? "";
  let defaultClientSecret = defaults.clientSecret ?? "";
  const autoDiscoverGeminiOAuth = parseBoolean(env.GEMINI_OAUTH_AUTO_DISCOVER, true);

  if (prefix === "GEMINI_CLI") {
    const sharedGeminiClientId = resolveFirstNonEmptyEnv(env, [
      "OPENCLAW_GEMINI_OAUTH_CLIENT_ID",
      "GEMINI_CLI_OAUTH_CLIENT_ID",
    ]);
    const sharedGeminiClientSecret = resolveFirstNonEmptyEnv(env, [
      "OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET",
      "GEMINI_CLI_OAUTH_CLIENT_SECRET",
    ]);

    if (!defaultClientId && sharedGeminiClientId) {
      defaultClientId = sharedGeminiClientId;
    }
    if (!defaultClientSecret && sharedGeminiClientSecret) {
      defaultClientSecret = sharedGeminiClientSecret;
    }

    if (autoDiscoverGeminiOAuth && !defaultClientId) {
      const discoveredGeminiCredentials = discoverGeminiCliOAuthCredentials(env.PATH);
      if (discoveredGeminiCredentials) {
        defaultClientId = discoveredGeminiCredentials.clientId;
        if (!defaultClientSecret) {
          defaultClientSecret = discoveredGeminiCredentials.clientSecret;
        }
      }
    }
  } else if (prefix === "GEMINI_ANTIGRAVITY") {
    const sharedAntigravityClientId = resolveFirstNonEmptyEnv(env, [
      "OPENCLAW_ANTIGRAVITY_OAUTH_CLIENT_ID",
      "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_ID",
    ]);
    const sharedAntigravityClientSecret = resolveFirstNonEmptyEnv(env, [
      "OPENCLAW_ANTIGRAVITY_OAUTH_CLIENT_SECRET",
      "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_SECRET",
    ]);

    if (!defaultClientId && sharedAntigravityClientId) {
      defaultClientId = sharedAntigravityClientId;
    }
    if (!defaultClientSecret && sharedAntigravityClientSecret) {
      defaultClientSecret = sharedAntigravityClientSecret;
    }

    if (autoDiscoverGeminiOAuth && !defaultClientId) {
      const discoveredAntigravityCredentials = discoverAntigravityOAuthCredentials(env.PATH);
      if (discoveredAntigravityCredentials) {
        defaultClientId = discoveredAntigravityCredentials.clientId;
        if (!defaultClientSecret) {
          defaultClientSecret = discoveredAntigravityCredentials.clientSecret;
        }
      }
    }
  }

  return {
    clientId: prefixedClientId ?? defaultClientId,
    clientSecret: prefixedClientSecret ?? defaultClientSecret,
  };
}

function parseOAuthProfileConfig(
  env: NodeJS.ProcessEnv,
  prefix: string,
  id: string,
  defaults: OAuthProfileDefaults,
): OAuthProviderProfileConfig {
  const clientCredentials = resolveOAuthClientCredentials(env, prefix, defaults);
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
    clientId: clientCredentials.clientId,
    clientSecret: clientCredentials.clientSecret,
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

function parseProviderInferenceBaseUrls(env: NodeJS.ProcessEnv): Record<ProviderId, string> {
  return {
    codex: parseRequiredUrl(env.CODEX_INFERENCE_BASE_URL, "https://api.openai.com/v1"),
    gemini: parseRequiredUrl(
      env.GEMINI_INFERENCE_BASE_URL,
      "https://generativelanguage.googleapis.com/v1beta/openai",
    ),
    claude: parseRequiredUrl(env.CLAUDE_INFERENCE_BASE_URL, "https://api.anthropic.com/v1"),
    openrouter: parseRequiredUrl(env.OPENROUTER_INFERENCE_BASE_URL, "https://openrouter.ai/api/v1"),
  };
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

function assertSessionSecretStrength(secret: string, source: string): string {
  if (Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) {
    throw new Error(`${source} must be at least ${MIN_SESSION_SECRET_BYTES} bytes long.`);
  }

  return secret;
}

function resolveSessionSecret(rawValue: string | undefined, sessionSecretFilePath: string): string {
  const secret = rawValue?.trim();
  if (secret) {
    return assertSessionSecretStrength(secret, "SESSION_SECRET");
  }

  if (fs.existsSync(sessionSecretFilePath)) {
    assertSecretFilePermissions(sessionSecretFilePath, "SESSION_SECRET file");
    const storedSecret = fs.readFileSync(sessionSecretFilePath, "utf8").trim();
    if (!storedSecret) {
      throw new Error(`SESSION_SECRET file is empty at ${sessionSecretFilePath}.`);
    }

    return assertSessionSecretStrength(storedSecret, `SESSION_SECRET file at ${sessionSecretFilePath}`);
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

  return assertSessionSecretStrength(generatedSecret, "generated session secret");
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = parsePort(env.PORT);
  const dataFilePath = env.DATA_FILE ?? path.join(os.homedir(), ".omni-connector", "data", "store.json");
  const publicDir = env.PUBLIC_DIR ?? path.join(process.cwd(), "public");
  const sessionSecretFilePath = resolveSessionSecretFilePath(env.SESSION_SECRET_FILE, dataFilePath);
  const host = parseHost(env.HOST);
  const allowRemoteDashboard = parseBoolean(env.ALLOW_REMOTE_DASHBOARD, false);
  const trustProxyHops = parseNonNegativeInt(env.TRUST_PROXY_HOPS, 0);
  const strictLiveQuota = parseBoolean(env.STRICT_LIVE_QUOTA, false);
  const providerInferenceBaseUrls = parseProviderInferenceBaseUrls(env);
  const codexChatgptBaseUrl = parseRequiredUrl(
    env.CODEX_CHATGPT_BASE_URL,
    "https://chatgpt.com/backend-api/codex",
  );
  const providerUsage = parseProviderUsageConfigMap(env);
  const oauthProfiles = parseOAuthProfiles(env);
  const defaultRedirectUri = `http://localhost:${port}/auth/callback`;
  const oauthRedirectUri = enforceOAuthRedirectUriPolicy(
    parseRequiredUrl(env.OAUTH_REDIRECT_URI, defaultRedirectUri),
    allowRemoteDashboard,
  );

  if (!allowRemoteDashboard && !isLoopbackHost(host)) {
    throw new Error(
      `HOST must be loopback unless ALLOW_REMOTE_DASHBOARD=true. Received HOST=${host}.`,
    );
  }

  return {
    host,
    allowRemoteDashboard,
    trustProxyHops,
    strictLiveQuota,
    port,
    dataFilePath,
    publicDir,
    sessionSecret: resolveSessionSecret(env.SESSION_SECRET, sessionSecretFilePath),
    sessionStore: parseEnumValue<SessionStoreMode>(
      env.SESSION_STORE,
      ["memory", "memorystore"],
      "memorystore",
    ),
    oauthRedirectUri,
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
    oauthOriginator: nonEmptyEnvValue(env.OAUTH_ORIGINATOR) ?? "codex_cli_rs",
    codexAppServerEnabled: parseBoolean(env.CODEX_APP_SERVER_ENABLED, true),
    codexAppServerCommand: nonEmptyEnvValue(env.CODEX_APP_SERVER_COMMAND) ?? "codex",
    codexAppServerArgs: parseCommandArgs(env.CODEX_APP_SERVER_ARGS, ["app-server"]),
    codexAppServerTimeoutMs: parsePositiveInt(env.CODEX_APP_SERVER_TIMEOUT_MS, 3500),
    codexChatgptBaseUrl,
    oauthRequireQuota: parseBoolean(env.OAUTH_REQUIRE_QUOTA, true),
    defaultFiveHourLimit: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_LIMIT, 0),
    defaultWeeklyLimit: parseNonNegativeInt(env.DEFAULT_WEEKLY_LIMIT, 0),
    defaultFiveHourUsed: parseNonNegativeInt(env.DEFAULT_FIVE_HOUR_USED, 0),
    defaultWeeklyUsed: parseNonNegativeInt(env.DEFAULT_WEEKLY_USED, 0),
    providerInferenceBaseUrls,
    providerUsage,
    oauthProfiles,
  };
}
