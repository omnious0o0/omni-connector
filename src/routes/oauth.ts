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

interface VerificationPendingFlowState {
  accountId: string;
  createdAt: string;
}

const PENDING_FLOW_TTL_MS = 20 * 60 * 1000;
const MAX_PENDING_FLOWS = 24;
const VERIFICATION_FLOW_TTL_MS = 20 * 60 * 1000;
const MAX_VERIFICATION_FLOWS = 24;
const OAUTH_ERROR_CODE_MAX_LENGTH = 64;
const OAUTH_ERROR_DESCRIPTION_MAX_LENGTH = 180;

function readQueryString(value: unknown): string | null {
  const candidate =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : null;

  if (candidate === null) {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pruneVerificationFlows(
  input: Record<string, VerificationPendingFlowState> | undefined,
): Record<string, VerificationPendingFlowState> {
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

      if (nowMs - createdAtMs > VERIFICATION_FLOW_TTL_MS) {
        return null;
      }

      return [state, flow, createdAtMs] as const;
    })
    .filter((entry): entry is readonly [string, VerificationPendingFlowState, number] => entry !== null)
    .sort((a, b) => b[2] - a[2])
    .slice(0, MAX_VERIFICATION_FLOWS);

  const next: Record<string, VerificationPendingFlowState> = {};
  for (const [state, flow] of entries) {
    next[state] = flow;
  }

  return next;
}

function renderVerificationLaunchPage(verificationUrl: string, returnPath: string): string {
  const escapedVerificationUrl = escapeHtml(verificationUrl);
  const escapedReturnPath = escapeHtml(returnPath);
  const verificationUrlJson = JSON.stringify(verificationUrl);
  const returnPathJson = JSON.stringify(returnPath);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Verify Account</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #0f1115;
        color: #f8fafc;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      .panel {
        width: min(460px, calc(100vw - 32px));
        border: 1px solid #2a303b;
        border-radius: 14px;
        background: #171b23;
        padding: 20px;
        display: grid;
        gap: 12px;
      }

      h1 {
        margin: 0;
        font-size: 1.1rem;
      }

      p {
        margin: 0;
        color: #cbd5e1;
        line-height: 1.45;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .btn {
        border: 1px solid #3d4758;
        border-radius: 10px;
        color: #f8fafc;
        text-decoration: none;
        padding: 8px 12px;
        font-size: 0.9rem;
      }

      .btn:hover {
        border-color: #6b7b93;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>Finish account verification</h1>
      <p id="verification-status">Opening Google verification now.</p>
      <div class="actions">
        <a id="verification-open-link" class="btn" href="${escapedVerificationUrl}" target="_blank" rel="noopener noreferrer">Open verification page</a>
        <a id="verification-return-link" class="btn" href="${escapedReturnPath}">Return to omni-connector</a>
      </div>
    </main>
    <script>
      (() => {
        const verificationUrl = ${verificationUrlJson};
        const returnPath = ${returnPathJson};
        const statusNode = document.getElementById("verification-status");
        const popup = window.open(verificationUrl, "omni-connector-verification", "noopener,noreferrer");

        if (!popup) {
          if (statusNode) {
            statusNode.textContent = "Popup was blocked. Open the verification page, finish it, then return here.";
          }
          return;
        }

        const monitor = () => {
          if (popup.closed) {
            window.location.replace(returnPath);
            return;
          }

          window.setTimeout(monitor, 700);
        };

        monitor();
      })();
    </script>
  </body>
</html>`;
}

function sanitizeOAuthErrorCode(rawCode: string): string {
  const cleaned = rawCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (cleaned.length === 0) {
    return "provider_error";
  }

  return cleaned.slice(0, OAUTH_ERROR_CODE_MAX_LENGTH);
}

function sanitizeOAuthErrorDescription(rawDescription: string): string | null {
  const cleaned = rawDescription
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) {
    return null;
  }

  return cleaned.slice(0, OAUTH_ERROR_DESCRIPTION_MAX_LENGTH);
}

function safeErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "unknown error";

  const normalized = rawMessage.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "unknown error";
  }

  return normalized
    .replace(/([?&](?:key|api_key|apikey|token|access_token|refresh_token)=)([^&\s]+)/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .slice(0, 220);
}

function oauthProviderErrorMessage(req: Request): string {
  const rawCode = readQueryString(req.query.error);
  const code = rawCode ? sanitizeOAuthErrorCode(rawCode) : "provider_error";
  const rawDescription = readQueryString(req.query.error_description);
  if (!rawDescription) {
    return `OAuth provider returned an error (${code}).`;
  }

  const description = sanitizeOAuthErrorDescription(rawDescription);
  if (!description) {
    return `OAuth provider returned an error (${code}).`;
  }

  return `OAuth provider returned an error (${code}): ${description}`;
}

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
      throw new HttpError(400, "oauth_provider_error", oauthProviderErrorMessage(req));
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

  router.get("/verification/start", (req, res) => {
    const accountId = readQueryString(req.query.accountId);
    if (!accountId) {
      throw new HttpError(400, "missing_account_id", "Account ID is required.");
    }

    const issue = dependencies.connectorService.quotaSyncIssueForAccount(accountId);
    if (!issue || issue.kind !== "account_verification_required") {
      throw new HttpError(
        409,
        "verification_not_available",
        "Verification guidance is not available for this account.",
      );
    }

    let verificationUrl: URL;
    try {
      verificationUrl = new URL(issue.actionUrl);
    } catch {
      throw new HttpError(400, "invalid_verification_url", "Verification URL is invalid.");
    }

    if (verificationUrl.protocol !== "https:") {
      throw new HttpError(400, "invalid_verification_url", "Verification URL must use HTTPS.");
    }

    const state = dependencies.oauthProviderService.createState();
    const pendingFlows = pruneVerificationFlows(req.session.verificationPendingFlows);
    pendingFlows[state] = {
      accountId,
      createdAt: new Date().toISOString(),
    };
    req.session.verificationPendingFlows = pendingFlows;

    const returnPath = `/verification/complete?state=${encodeURIComponent(state)}`;
    res.status(200).type("html").send(renderVerificationLaunchPage(verificationUrl.toString(), returnPath));
  });

  router.get("/verification/complete", async (req, res) => {
    const state = readQueryString(req.query.state);
    if (!state) {
      throw new HttpError(400, "missing_verification_state", "Verification state is required.");
    }

    const pendingFlows = pruneVerificationFlows(req.session.verificationPendingFlows);
    const flow = pendingFlows[state];
    if (!flow) {
      if (req.session.verificationLastCompletedState === state) {
        res.redirect("/?verified=1");
        return;
      }

      throw new HttpError(400, "verification_state_mismatch", "Verification session expired. Start verification again.");
    }

    delete pendingFlows[state];
    req.session.verificationPendingFlows = pendingFlows;
    req.session.verificationLastCompletedState = state;
    req.session.dashboardAuthorized = true;

    try {
      await dependencies.connectorService.syncAccountStateNow();
    } catch (error) {
      const message = safeErrorMessage(error);
      process.stderr.write(`Verification sync failed for account ${flow.accountId}: ${message}\n`);
    }

    res.redirect("/?verified=1");
  });

  return router;
}
