import { Request, Router } from "express";
import { HttpError } from "../errors";
import { PROVIDER_CATALOG, isProviderId, providerOAuthProfileDefinitions } from "../providers";
import { ConnectorService } from "../services/connector";
import { OAuthProviderService } from "../services/oauth-provider";
import { ProviderUsageService } from "../services/provider-usage";

interface ApiRouterDependencies {
  connectorService: ConnectorService;
  oauthProviderService: OAuthProviderService;
  providerUsageService: ProviderUsageService;
  strictLiveQuota: boolean;
  allowRemoteDashboard: boolean;
}

const DASHBOARD_CLIENT_HEADER = "x-omni-client";

function parseBearerToken(rawHeader: string | undefined): string {
  if (!rawHeader) {
    throw new HttpError(401, "missing_authorization", "Missing Authorization header.");
  }

  const match = /^Bearer\s+(.+)$/i.exec(rawHeader.trim());
  if (!match || !match[1]) {
    throw new HttpError(401, "invalid_authorization", "Authorization header must use Bearer token format.");
  }

  return match[1].trim();
}

function parseUnits(rawUnits: unknown): number {
  if (rawUnits === undefined) {
    return 1;
  }

  const numeric = Number(rawUnits);
  if (!Number.isInteger(numeric)) {
    throw new HttpError(400, "invalid_units", "Units must be an integer.");
  }

  return numeric;
}

function parseApiLinkBody(rawBody: unknown): {
  provider: ReturnType<typeof parseProviderId>;
  apiKey: string;
  displayName: string;
  providerAccountId: string;
  manualFiveHourLimit?: number;
  manualWeeklyLimit?: number;
} {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as {
    provider?: unknown;
    apiKey?: unknown;
    displayName?: unknown;
    providerAccountId?: unknown;
    manualFiveHourLimit?: unknown;
    manualWeeklyLimit?: unknown;
  };

  const provider = parseProviderId(body.provider);
  const providerConfig = PROVIDER_CATALOG.find((item) => item.id === provider);
  if (!providerConfig || !providerConfig.methods.includes("api")) {
    throw new HttpError(400, "api_link_not_supported", "API key link is not supported for this provider.");
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const providerAccountId = typeof body.providerAccountId === "string" ? body.providerAccountId : "";
  const manualFiveHourLimit =
    typeof body.manualFiveHourLimit === "number" && Number.isFinite(body.manualFiveHourLimit)
      ? Math.max(0, Math.round(body.manualFiveHourLimit))
      : undefined;
  const manualWeeklyLimit =
    typeof body.manualWeeklyLimit === "number" && Number.isFinite(body.manualWeeklyLimit)
      ? Math.max(0, Math.round(body.manualWeeklyLimit))
      : undefined;

  if (!apiKey) {
    throw new HttpError(400, "missing_api_key", "API key is required.");
  }

  return {
    provider,
    apiKey,
    displayName,
    providerAccountId,
    manualFiveHourLimit,
    manualWeeklyLimit,
  };
}

function parseProviderId(rawProvider: unknown) {
  if (typeof rawProvider !== "string") {
    throw new HttpError(400, "invalid_provider", "Provider is required.");
  }

  const normalized = rawProvider.trim().toLowerCase();
  if (!isProviderId(normalized)) {
    throw new HttpError(400, "invalid_provider", "Unsupported provider.");
  }

  return normalized;
}

function assertDashboardClientRequest(req: Request, allowRemoteDashboard: boolean): void {
  const clientHeader = req.header(DASHBOARD_CLIENT_HEADER)?.trim().toLowerCase();
  if (clientHeader === "dashboard") {
    if (!allowRemoteDashboard || req.session.dashboardAuthorized === true) {
      return;
    }

    throw new HttpError(
      401,
      "dashboard_auth_required",
      "Dashboard session authorization is required when ALLOW_REMOTE_DASHBOARD=true.",
    );
  }

  throw new HttpError(403, "dashboard_client_required", "Dashboard client header is required.");
}

export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const router = Router();

  router.get("/auth/provider", (_req, res) => {
    res.json(dependencies.oauthProviderService.publicMetadata());
  });

  router.get("/auth/providers", (_req, res) => {
    res.json({
      strictLiveQuota: dependencies.strictLiveQuota,
      providers: PROVIDER_CATALOG.map((provider) => {
        const oauthProfiles = dependencies.oauthProviderService.oauthProfiles(provider.id);
        const profileEnvPrefixById = new Map(
          providerOAuthProfileDefinitions(provider.id).map((definition) => [definition.id, definition.envPrefix]),
        );
        const oauthOptions = oauthProfiles.map((profile) => {
          const envPrefix = profileEnvPrefixById.get(profile.id);
          const requiredClientIdEnv = envPrefix ? `${envPrefix}_OAUTH_CLIENT_ID` : null;

          return {
            id: profile.id,
            label: profile.label,
            configured: profile.configured,
            startPath: `/auth/${provider.id}/start?profile=${encodeURIComponent(profile.id)}`,
            requiredClientIdEnv,
            configurationHint:
              profile.configured || !requiredClientIdEnv
                ? null
                : `Set ${requiredClientIdEnv} in .env and restart omni-connector.`,
          };
        });
        const firstConfigured = oauthOptions.find((option) => option.configured);

        return {
          id: provider.id,
          name: provider.name,
          recommended: provider.recommended ?? false,
          warnings: [...(provider.warnings ?? [])],
          supportsOAuth: provider.methods.includes("oauth") && oauthOptions.length > 0,
          oauthConfigured: oauthOptions.some((option) => option.configured),
          oauthStartPath: firstConfigured?.startPath ?? oauthOptions[0]?.startPath ?? null,
          oauthOptions,
          supportsApiKey: provider.methods.includes("api"),
          usageConfigured: dependencies.providerUsageService.isConfigured(provider.id),
        };
      }),
    });
  });

  router.get("/dashboard", async (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const payload = await dependencies.connectorService.getDashboardPayload();
    res.json({
      ...payload,
      dashboardAuthorized: true,
    });
  });

  router.post("/accounts/:accountId/remove", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const accountId = req.params.accountId;
    if (!accountId) {
      throw new HttpError(400, "missing_account_id", "Account id is required.");
    }

    dependencies.connectorService.removeAccount(accountId);
    res.status(204).send();
  });

  router.post("/accounts/link-api", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const payload = parseApiLinkBody(req.body);
    dependencies.connectorService.linkApiAccount(payload);
    res.status(201).json({
      ok: true,
    });
  });

  router.post("/connector/key/rotate", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const apiKey = dependencies.connectorService.rotateConnectorApiKey();
    res.json({
      apiKey,
    });
  });

  router.post("/connector/route", async (req, res) => {
    const connectorKey = parseBearerToken(req.header("Authorization") ?? undefined);
    const units = parseUnits((req.body as { units?: number } | undefined)?.units);
    const decision = await dependencies.connectorService.routeRequest(connectorKey, units);

    res.json(decision);
  });

  return router;
}
