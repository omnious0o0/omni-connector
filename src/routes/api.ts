import { Request, Router } from "express";
import { HttpError } from "../errors";
import { PROVIDER_CATALOG, isProviderId, providerOAuthProfileDefinitions } from "../providers";
import { ConnectorService } from "../services/connector";
import { OAuthProviderService } from "../services/oauth-provider";
import { ProviderUsageService } from "../services/provider-usage";
import { AccountSettingsUpdatePayload, RoutingPreferences } from "../types";

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

function parseOptionalModel(rawModel: unknown): string | null {
  if (rawModel === undefined || rawModel === null) {
    return null;
  }

  if (typeof rawModel !== "string") {
    throw new HttpError(400, "invalid_model", "Model must be a string when provided.");
  }

  const normalized = rawModel.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 120);
}

function parseRoutingPreferencesBody(rawBody: unknown, current: RoutingPreferences): RoutingPreferences {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as {
    preferredProvider?: unknown;
    fallbackProviders?: unknown;
    priorityModels?: unknown;
  };

  let preferredProvider = current.preferredProvider;
  if (body.preferredProvider !== undefined) {
    if (typeof body.preferredProvider !== "string") {
      throw new HttpError(400, "invalid_routing_preferences", "Preferred provider must be a string.");
    }

    const normalized = body.preferredProvider.trim().toLowerCase();
    if (!normalized || normalized === "auto") {
      preferredProvider = "auto";
    } else if (isProviderId(normalized)) {
      preferredProvider = normalized;
    } else {
      throw new HttpError(400, "invalid_routing_preferences", "Preferred provider is not supported.");
    }
  }

  let fallbackProviders = [...current.fallbackProviders];
  if (body.fallbackProviders !== undefined) {
    if (!Array.isArray(body.fallbackProviders)) {
      throw new HttpError(400, "invalid_routing_preferences", "Fallback providers must be an array.");
    }

    fallbackProviders = [];
    for (const entry of body.fallbackProviders) {
      if (typeof entry !== "string") {
        throw new HttpError(400, "invalid_routing_preferences", "Fallback providers must contain strings.");
      }

      const normalized = entry.trim().toLowerCase();
      if (!isProviderId(normalized)) {
        throw new HttpError(400, "invalid_routing_preferences", `Unsupported fallback provider: ${entry}`);
      }

      if (preferredProvider !== "auto" && normalized === preferredProvider) {
        continue;
      }

      if (!fallbackProviders.includes(normalized)) {
        fallbackProviders.push(normalized);
      }
    }
  }

  let priorityModels = [...current.priorityModels];
  if (body.priorityModels !== undefined) {
    if (!Array.isArray(body.priorityModels)) {
      throw new HttpError(400, "invalid_routing_preferences", "Priority models must be an array.");
    }

    priorityModels = [];
    for (const entry of body.priorityModels) {
      if (typeof entry !== "string") {
        throw new HttpError(400, "invalid_routing_preferences", "Priority models must contain strings.");
      }

      const normalized = entry.trim();
      if (!normalized) {
        continue;
      }

      const clipped = normalized.slice(0, 120);
      if (!priorityModels.includes(clipped)) {
        priorityModels.push(clipped);
      }

      if (priorityModels.length >= 20) {
        break;
      }
    }

    if (priorityModels.length === 0) {
      priorityModels.push("auto");
    }
  }

  return {
    preferredProvider,
    fallbackProviders,
    priorityModels,
  };
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
  const parsedManualFiveHourLimit = Number(body.manualFiveHourLimit);
  const parsedManualWeeklyLimit = Number(body.manualWeeklyLimit);
  const manualFiveHourLimit =
    Number.isFinite(parsedManualFiveHourLimit) && parsedManualFiveHourLimit > 0
      ? Math.round(parsedManualFiveHourLimit)
      : undefined;
  const manualWeeklyLimit =
    Number.isFinite(parsedManualWeeklyLimit) && parsedManualWeeklyLimit > 0
      ? Math.round(parsedManualWeeklyLimit)
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

function parseOptionalLimit(rawValue: unknown, fieldName: string): number | undefined {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return undefined;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new HttpError(400, "invalid_account_settings", `${fieldName} must be a positive number.`);
  }

  return Math.round(numericValue);
}

function parseAccountSettingsBody(rawBody: unknown): AccountSettingsUpdatePayload {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as {
    displayName?: unknown;
    manualFiveHourLimit?: unknown;
    manualWeeklyLimit?: unknown;
  };

  const displayName =
    body.displayName === undefined
      ? undefined
      : typeof body.displayName === "string"
        ? body.displayName.trim()
        : null;
  if (displayName === null) {
    throw new HttpError(400, "invalid_account_settings", "Display name must be a string.");
  }

  const manualFiveHourLimit = parseOptionalLimit(body.manualFiveHourLimit, "Manual 5h limit");
  const manualWeeklyLimit = parseOptionalLimit(body.manualWeeklyLimit, "Manual weekly limit");

  if (displayName === undefined && manualFiveHourLimit === undefined && manualWeeklyLimit === undefined) {
    throw new HttpError(400, "invalid_account_settings", "At least one account setting must be provided.");
  }

  return {
    displayName,
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
          const requiredClientIdEnv =
            provider.id === "codex" && profile.id === "oauth"
              ? "OAUTH_CLIENT_ID"
              : envPrefix
                ? `${envPrefix}_OAUTH_CLIENT_ID`
                : null;
          const configurationHint =
            profile.configured || !requiredClientIdEnv
              ? null
              : provider.id === "gemini" && profile.id === "gemini-cli"
                ? `OAuth not configured. Install @google/gemini-cli for auto-discovery, or set ${requiredClientIdEnv} in .env and restart omni-connector.`
                : provider.id === "gemini" && profile.id === "antigravity"
                  ? `OAuth not configured. Install Antigravity or OpenClaw for auto-discovery, or set ${requiredClientIdEnv} in .env and restart omni-connector.`
                : `OAuth not configured. Set ${requiredClientIdEnv} in .env and restart omni-connector.`;

          return {
            id: profile.id,
            label: profile.label,
            configured: profile.configured,
            startPath: `/auth/${provider.id}/start?profile=${encodeURIComponent(profile.id)}`,
            requiredClientIdEnv,
            configurationHint,
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

  router.get("/models/connected", async (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const payload = await dependencies.connectorService.connectedProviderModels();
    res.json(payload);
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

  router.post("/accounts/:accountId/settings", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const accountId = req.params.accountId;
    if (!accountId) {
      throw new HttpError(400, "missing_account_id", "Account id is required.");
    }

    const payload = parseAccountSettingsBody(req.body);
    dependencies.connectorService.updateAccountSettings(accountId, payload);
    res.json({
      ok: true,
    });
  });

  router.post("/accounts/link-api", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const payload = parseApiLinkBody(req.body);

    const requestedManualLimitFallback =
      payload.manualFiveHourLimit !== undefined || payload.manualWeeklyLimit !== undefined;
    if (requestedManualLimitFallback && dependencies.providerUsageService.isConfigured(payload.provider)) {
      throw new HttpError(
        409,
        "manual_limits_not_allowed",
        "Manual limits can only be set when live usage sync is unavailable.",
      );
    }

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

  router.get("/connector/routing", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    res.json({
      routingPreferences: dependencies.connectorService.routingPreferences(),
    });
  });

  router.post("/connector/routing", (req, res) => {
    assertDashboardClientRequest(req, dependencies.allowRemoteDashboard);
    const current = dependencies.connectorService.routingPreferences();
    const next = parseRoutingPreferencesBody(req.body, current);
    const updated = dependencies.connectorService.updateRoutingPreferences(next);

    res.json({
      routingPreferences: updated,
    });
  });

  router.post("/connector/route", async (req, res) => {
    const connectorKey = parseBearerToken(req.header("Authorization") ?? undefined);
    const body = (req.body ?? {}) as {
      units?: unknown;
      model?: unknown;
    };
    const units = parseUnits(body.units);
    const model = parseOptionalModel(body.model);
    const decision = await dependencies.connectorService.routeRequest(connectorKey, units, model ?? undefined);

    res.json(decision);
  });

  return router;
}
