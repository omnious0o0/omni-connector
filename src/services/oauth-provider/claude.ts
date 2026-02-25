import { OAuthProviderProfileConfig } from "../../config";
import { HttpError } from "../../errors";

export interface ClaudeAuthorizationCodeTokenInput {
  code: string;
  state?: string;
  redirectUri: string;
  codeVerifier: string;
}

export function buildClaudeAuthorizationCodeTokenPayload(
  profile: OAuthProviderProfileConfig,
  input: ClaudeAuthorizationCodeTokenInput,
): Record<string, string> {
  if (!input.state) {
    throw new HttpError(400, "missing_oauth_state", "OAuth callback is missing state.");
  }

  const payload: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: profile.clientId,
    code: input.code,
    state: input.state,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  };

  if (profile.clientSecret) {
    payload.client_secret = profile.clientSecret;
  }

  return payload;
}
