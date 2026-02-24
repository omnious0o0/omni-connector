import { Request, Response, Router } from "express";
import { HttpError } from "../errors";
import { ConnectorService } from "../services/connector";
import { OAuthProviderService } from "../services/oauth-provider";

interface OAuthRouterDependencies {
  connectorService: ConnectorService;
  oauthProviderService: OAuthProviderService;
}

export function createOAuthRouter(dependencies: OAuthRouterDependencies): Router {
  const router = Router();

  const handleOAuthStart = (req: Request, res: Response) => {
    dependencies.oauthProviderService.assertConfigured();

    const state = dependencies.oauthProviderService.createState();
    const codeVerifier = dependencies.oauthProviderService.createPkceVerifier();
    const codeChallenge = dependencies.oauthProviderService.createPkceChallenge(codeVerifier);
    const redirectUri = dependencies.oauthProviderService.redirectUri();

    req.session.oauthState = state;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthCodeVerifier = codeVerifier;

    const authorizationUrl = dependencies.oauthProviderService.authorizationUrl({
      state,
      redirectUri,
      codeChallenge,
    });

    res.redirect(authorizationUrl);
  };

  router.get("/auth/omni/start", handleOAuthStart);
  router.get("/auth/codex/start", handleOAuthStart);

  router.get("/auth/callback", async (req, res) => {
    const state = req.query.state;
    const code = req.query.code;
    const oauthError = req.query.error;

    if (typeof oauthError === "string") {
      const errorDescription =
        typeof req.query.error_description === "string" ? req.query.error_description : "OAuth provider returned an error.";
      throw new HttpError(400, "oauth_provider_error", `${oauthError}: ${errorDescription}`);
    }

    if (typeof state !== "string" || typeof code !== "string") {
      throw new HttpError(400, "invalid_oauth_callback", "OAuth callback is missing code or state.");
    }

    const expectedState = req.session.oauthState;
    const expectedRedirectUri = req.session.oauthRedirectUri;
    const codeVerifier = req.session.oauthCodeVerifier;
    req.session.oauthState = undefined;
    req.session.oauthRedirectUri = undefined;
    req.session.oauthCodeVerifier = undefined;

    if (!expectedState || expectedState !== state) {
      throw new HttpError(400, "oauth_state_mismatch", "OAuth state validation failed.");
    }

    if (!expectedRedirectUri) {
      throw new HttpError(400, "missing_redirect_uri", "OAuth redirect URI is missing in session.");
    }

    if (!codeVerifier) {
      throw new HttpError(400, "missing_code_verifier", "PKCE verifier is missing in session.");
    }

    const linkedAccount = await dependencies.oauthProviderService.exchangeCode({
      code,
      redirectUri: expectedRedirectUri,
      codeVerifier,
    });

    dependencies.connectorService.linkOAuthAccount(linkedAccount);
    req.session.dashboardAuthorized = true;
    res.redirect("/?connected=1");
  });

  return router;
}
