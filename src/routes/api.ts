import { Request, Router } from "express";
import { HttpError } from "../errors";
import { ConnectorService } from "../services/connector";
import { OAuthProviderService } from "../services/oauth-provider";

interface ApiRouterDependencies {
  connectorService: ConnectorService;
  oauthProviderService: OAuthProviderService;
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

function assertDashboardClientRequest(req: Request): void {
  const clientHeader = req.header(DASHBOARD_CLIENT_HEADER)?.trim().toLowerCase();
  if (clientHeader === "dashboard") {
    return;
  }

  throw new HttpError(403, "dashboard_client_required", "Dashboard client header is required.");
}

export function createApiRouter(dependencies: ApiRouterDependencies): Router {
  const router = Router();

  router.get("/auth/provider", (_req, res) => {
    res.json(dependencies.oauthProviderService.publicMetadata());
  });

  router.get("/dashboard", async (req, res) => {
    assertDashboardClientRequest(req);
    const payload = await dependencies.connectorService.getDashboardPayload();
    res.json({
      ...payload,
      dashboardAuthorized: true,
    });
  });

  router.post("/accounts/:accountId/remove", (req, res) => {
    assertDashboardClientRequest(req);
    const accountId = req.params.accountId;
    if (!accountId) {
      throw new HttpError(400, "missing_account_id", "Account id is required.");
    }

    dependencies.connectorService.removeAccount(accountId);
    res.status(204).send();
  });

  router.post("/connector/key/rotate", (req, res) => {
    assertDashboardClientRequest(req);
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
