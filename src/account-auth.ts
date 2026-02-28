import { AccountAuthMethod, ConnectedAccount } from "./types";

const API_SENTINEL_TOKEN_EXPIRES_AT = "2999-01-01T00:00:00.000Z";

export function inferLegacyApiAccount(account: ConnectedAccount): boolean {
  const oauthProfileId = typeof account.oauthProfileId === "string" ? account.oauthProfileId.trim() : "";
  if (oauthProfileId.length > 0) {
    return false;
  }

  const providerAccountId = account.providerAccountId.trim().toLowerCase();
  const hasApiStyleAccountId = providerAccountId.startsWith("api_");
  const hasSentinelTokenExpiry = account.tokenExpiresAt.trim() === API_SENTINEL_TOKEN_EXPIRES_AT;
  const hasRefreshToken = typeof account.refreshToken === "string" && account.refreshToken.trim().length > 0;

  return !hasRefreshToken && (hasSentinelTokenExpiry || hasApiStyleAccountId);
}

export function effectiveAccountAuthMethod(account: ConnectedAccount): AccountAuthMethod {
  if (account.authMethod === "api") {
    return "api";
  }

  if (account.authMethod === "oauth") {
    return inferLegacyApiAccount(account) ? "api" : "oauth";
  }

  return inferLegacyApiAccount(account) ? "api" : "oauth";
}
