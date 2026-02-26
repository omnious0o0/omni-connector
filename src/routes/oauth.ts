import { Request, Response, Router } from "express";
import { HttpError } from "../errors";
import { isProviderId, providerOAuthProfileDefinitions } from "../providers";
import { ConnectorService } from "../services/connector";
import { OAuthProviderService } from "../services/oauth-provider";
import { ProviderId } from "../types";

interface OAuthRouterDependencies {
  connectorService: ConnectorService;
  oauthProviderService: OAuthProviderService;
}

interface OAuthPendingFlowState {
  redirectUri: string;
  codeVerifier: string;
  providerId: ProviderId;
  profileId: string;
  createdAt: string;
}

const PENDING_FLOW_TTL_MS = 20 * 60 * 1000;
const MAX_PENDING_FLOWS = 24;

function prunePendingFlows(input: Record<string, OAuthPendingFlowState> | undefined): Record<string, OAuthPendingFlowState> {
  if (!input) {
    return {};
  }

  const nowMs = Date.now();
  const entries = Object.entries(input)
    .map(([state, flow]) => {
      const createdAtMs = Date.parse(flow.createdAt);
      if (Number.isNaN(createdAtMs)) {
        return null;
      }

      if (nowMs - createdAtMs > PENDING_FLOW_TTL_MS) {
        return null;
      }

      return [state, flow, createdAtMs] as const;
    })
    .filter((entry): entry is readonly [string, OAuthPendingFlowState, number] => entry !== null)
    .sort((a, b) => b[2] - a[2])
    .slice(0, MAX_PENDING_FLOWS);

  const next: Record<string, OAuthPendingFlowState> = {};
  for (const [state, flow] of entries) {
    next[state] = flow;
  }

  return next;
}

function clearLegacyOAuthSessionState(req: Request): void {
  req.session.oauthState = undefined;
  req.session.oauthRedirectUri = undefined;
  req.session.oauthCodeVerifier = undefined;
  req.session.oauthProviderId = undefined;
  req.session.oauthProfileId = undefined;
}

export function createOAuthRouter(dependencies: OAuthRouterDependencies): Router {
  const router = Router();

  const resolveRequestedProfileId = (providerId: ProviderId, req: Request): string => {
    const requested = typeof req.query.profile === "string" ? req.query.profile.trim() : "";
    if (requested.length > 0) {
      return requested;
    }

    const profiles = dependencies.oauthProviderService.oauthProfiles(providerId);
    if (profiles.length > 0) {
      return profiles[0]?.id ?? "oauth";
    }

    return "oauth";
  };

  const resolveOAuthClientIdEnv = (providerId: ProviderId, profileId: string): string | null => {
    if (providerId === "codex" && profileId === "oauth") {
      return "OAUTH_CLIENT_ID";
    }

    const definition = providerOAuthProfileDefinitions(providerId).find((candidate) => candidate.id === profileId);
    if (!definition) {
      return null;
    }

    return `${definition.envPrefix}_OAUTH_CLIENT_ID`;
  };

  const handleOAuthStart = (providerId: ProviderId, profileId: string, req: Request, res: Response) => {
    if (!dependencies.oauthProviderService.isOAuthProfileConfigured(providerId, profileId)) {
      const requiredClientIdEnv = resolveOAuthClientIdEnv(providerId, profileId);
      const message = requiredClientIdEnv
        ? providerId === "gemini" && profileId === "gemini-cli"
          ? `OAuth profile is not configured for ${providerId}/${profileId}. Install @google/gemini-cli for auto-discovery, or set ${requiredClientIdEnv} in .env and restart omni-connector.`
          : providerId === "gemini" && profileId === "antigravity"
            ? `OAuth profile is not configured for ${providerId}/${profileId}. Install Antigravity or OpenClaw for auto-discovery, or set ${requiredClientIdEnv} in .env and restart omni-connector.`
            : `OAuth profile is not configured for ${providerId}/${profileId}. Set ${requiredClientIdEnv} in .env and restart omni-connector.`
        : `OAuth profile is not configured for ${providerId}/${profileId}.`;
      throw new HttpError(503, "oauth_not_configured", message);
    }

    const state = dependencies.oauthProviderService.createState();
    const codeVerifier = dependencies.oauthProviderService.createPkceVerifier();
    const codeChallenge = dependencies.oauthProviderService.createPkceChallenge(codeVerifier);
    const redirectUri = dependencies.oauthProviderService.redirectUriFor(providerId, profileId);

    const pendingFlows = prunePendingFlows(req.session.oauthPendingFlows);
    const flow: OAuthPendingFlowState = {
      redirectUri,
      codeVerifier,
      providerId,
      profileId,
      createdAt: new Date().toISOString(),
    };

    pendingFlows[state] = flow;

    req.session.oauthPendingFlows = pendingFlows;
    req.session.oauthState = state;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthCodeVerifier = codeVerifier;
    req.session.oauthProviderId = providerId;
    req.session.oauthProfileId = profileId;

    const authorizationUrl = dependencies.oauthProviderService.authorizationUrlFor(providerId, profileId, {
      state,
      redirectUri,
      codeChallenge,
    });

    res.redirect(authorizationUrl);
  };

  router.get("/auth/omni/start", (req, res) => {
    handleOAuthStart("codex", "oauth", req, res);
  });
  router.get("/auth/codex/start", (req, res) => {
    handleOAuthStart("codex", "oauth", req, res);
  });
  router.get("/auth/:provider/start", (req, res) => {
    const providerParam = req.params.provider;
    if (!providerParam || !isProviderId(providerParam)) {
      throw new HttpError(404, "provider_not_found", "Provider not found.");
    }

    const oauthProfiles = dependencies.oauthProviderService.oauthProfiles(providerParam);
    if (oauthProfiles.length === 0) {
      throw new HttpError(
        400,
        "oauth_not_supported",
        `OAuth is not supported for ${providerParam} in this connector. Use API key link instead.`,
      );
    }

    const profileId = resolveRequestedProfileId(providerParam, req);
    handleOAuthStart(providerParam, profileId, req, res);
  });

  const handleOAuthCallback = async (req: Request, res: Response) => {
    const state = req.query.state;
    const code = req.query.code;
    const oauthError = req.query.error;

    if (typeof oauthError === "string") {
      throw new HttpError(400, "oauth_provider_error", "OAuth provider returned an error.");
    }

    if (typeof state !== "string" || typeof code !== "string") {
      throw new HttpError(400, "invalid_oauth_callback", "OAuth callback is missing code or state.");
    }

    const pendingFlows = prunePendingFlows(req.session.oauthPendingFlows);
    const flow = pendingFlows[state];

    if (!flow) {
      if (req.session.oauthLastCompletedState === state) {
        res.redirect("/?connected=1");
        return;
      }

      throw new HttpError(400, "oauth_state_mismatch", "OAuth state validation failed.");
    }

    if (!flow.redirectUri) {
      throw new HttpError(400, "missing_redirect_uri", "OAuth redirect URI is missing in session.");
    }

    if (!flow.codeVerifier) {
      throw new HttpError(400, "missing_code_verifier", "PKCE verifier is missing in session.");
    }

    if (!flow.providerId || !flow.profileId) {
      throw new HttpError(
        400,
        "missing_oauth_provider",
        "OAuth provider is missing in session. Restart the OAuth flow.",
      );
    }

    const linkedAccount = await dependencies.oauthProviderService.exchangeCodeFor(flow.providerId, flow.profileId, {
      code,
      state,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.codeVerifier,
    });

    dependencies.connectorService.linkOAuthAccount(linkedAccount);
    delete pendingFlows[state];
    req.session.oauthPendingFlows = pendingFlows;
    req.session.oauthLastCompletedState = state;
    clearLegacyOAuthSessionState(req);
    req.session.dashboardAuthorized = true;
    res.redirect("/?connected=1");
  };

  router.get("/auth/callback", handleOAuthCallback);
  router.get("/oauth2callback", handleOAuthCallback);

  return router;
}
