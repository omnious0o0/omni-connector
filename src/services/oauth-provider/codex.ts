import { AppConfig, OAuthProviderProfileConfig } from "../../config";

export const CODEX_OAUTH_PROFILE_ID = "oauth";
export const CODEX_DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

const CODEX_USAGE_CANDIDATE_URLS = [
  "https://chatgpt.com/backend-api/wham/usage",
  "https://chatgpt.com/backend-api/codex/wham/usage",
];

const CODEX_DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function usesDefaultCodexClientId(clientId: string): boolean {
  return clientId.trim() === CODEX_DEFAULT_CLIENT_ID;
}

export function buildCodexOAuthProfile(config: AppConfig): OAuthProviderProfileConfig {
  const scopes = usesDefaultCodexClientId(config.oauthClientId) ? CODEX_DEFAULT_SCOPES : config.oauthScopes;

  return {
    id: CODEX_OAUTH_PROFILE_ID,
    label: config.oauthProviderName,
    authorizationUrl: config.oauthAuthorizationUrl,
    tokenUrl: config.oauthTokenUrl,
    userInfoUrl: config.oauthUserInfoUrl,
    clientId: config.oauthClientId,
    clientSecret: config.oauthClientSecret,
    scopes,
    originator: config.oauthOriginator,
    extraParams: {
      codex_cli_simplified_flow: "true",
      id_token_add_organizations: "true",
    },
  };
}

export function codexUsageCandidateUrls(configuredQuotaUrl: string | null): string[] {
  const candidates = [...CODEX_USAGE_CANDIDATE_URLS];
  if (configuredQuotaUrl) {
    candidates.unshift(configuredQuotaUrl);
  }

  return candidates;
}

export function extractCodexRateLimitPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const root = asRecord(payload.result);
  const rateLimits = asRecord(
    root?.rateLimits ?? root?.rate_limits ?? payload.rateLimits ?? payload.rate_limits,
  );
  if (!rateLimits) {
    return null;
  }

  return {
    result: {
      rateLimits,
    },
  };
}
