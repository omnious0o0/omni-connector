import path from "node:path";
import fs from "node:fs";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import helmet from "helmet";
import { AppConfig, resolveConfig } from "./config";
import { isHttpError } from "./errors";
import { createApiRouter } from "./routes/api";
import { createOpenAiRouter } from "./routes/openai";
import { createOAuthRouter } from "./routes/oauth";
import { ConnectorService } from "./services/connector";
import { OAuthProviderService } from "./services/oauth-provider";
import { ProviderModelsService } from "./services/provider-models";
import { ProviderUsageService } from "./services/provider-usage";
import { AccountRepository } from "./storage/account-repository";
import { DataStore } from "./store";

function isResolvedConfig(config: Partial<AppConfig>): config is AppConfig {
  return (
    typeof config.host === "string" &&
    typeof config.trustProxyHops === "number" &&
    typeof config.port === "number" &&
    typeof config.dataFilePath === "string" &&
    typeof config.publicDir === "string" &&
    typeof config.sessionSecret === "string" &&
    typeof config.sessionStore === "string" &&
    typeof config.oauthRedirectUri === "string" &&
    typeof config.oauthProviderName === "string" &&
    typeof config.oauthAuthorizationUrl === "string" &&
    typeof config.oauthTokenUrl === "string" &&
    typeof config.oauthClientId === "string" &&
    typeof config.oauthClientSecret === "string" &&
    typeof config.oauthOriginator === "string" &&
    typeof config.codexChatgptBaseUrl === "string" &&
    Array.isArray(config.oauthScopes) &&
    typeof config.providerInferenceBaseUrls === "object" &&
    config.providerInferenceBaseUrls !== null &&
    typeof config.providerUsage === "object" &&
    config.providerUsage !== null &&
    typeof config.oauthProfiles === "object" &&
    config.oauthProfiles !== null
  );
}

function isLoopbackAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("::ffff:127.")
  ) {
    return true;
  }

  if (/^127\.(\d{1,3}\.){2}\d{1,3}$/.test(normalized)) {
    return true;
  }

  return false;
}

function isTrustedProxyAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (isLoopbackAddress(normalized)) {
    return true;
  }

  const unwrappedV4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(unwrappedV4);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((valuePart) => Number.parseInt(valuePart, 10));
    if (octets.some((entry) => Number.isNaN(entry) || entry < 0 || entry > 255)) {
      return false;
    }

    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function isLoopbackHostname(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === "localhost") {
    return true;
  }

  return isLoopbackAddress(normalized);
}

export function createApp(overrides: Partial<AppConfig> = {}): express.Express {
  const config: AppConfig = isResolvedConfig(overrides)
    ? overrides
    : {
        ...resolveConfig(),
        ...overrides,
      };

  const store = new DataStore(config.dataFilePath);
  const accountRepository = new AccountRepository(store);
  const oauthProviderService = new OAuthProviderService(config);
  const providerUsageService = new ProviderUsageService(config);
  const providerModelsService = new ProviderModelsService(config);
  const connectorService = new ConnectorService(
    accountRepository,
    oauthProviderService,
    providerUsageService,
    providerModelsService,
    config.strictLiveQuota,
  );

  const app = express();
  const MemoryStore = createMemoryStore(session);
  const useMemorystore = config.sessionStore === "memorystore";
  const sessionStore = useMemorystore
    ? new MemoryStore({
        checkPeriod: 24 * 60 * 60 * 1000,
        ttl: 24 * 60 * 60,
      })
    : undefined;
  const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
  app.disable("x-powered-by");
  const trustProxySetting = config.allowRemoteDashboard && config.trustProxyHops > 0 ? config.trustProxyHops : false;
  app.set("trust proxy", trustProxySetting);

  app.use((req, res, next) => {
    if (!config.allowRemoteDashboard) {
      next();
      return;
    }

    const remoteAddress = req.socket.remoteAddress ?? "";
    const requestHostname = req.hostname ?? "";

    if (isLoopbackAddress(remoteAddress) && isLoopbackHostname(requestHostname)) {
      next();
      return;
    }

    if (req.secure && (trustProxySetting === false || isTrustedProxyAddress(remoteAddress))) {
      next();
      return;
    }

    const message = "HTTPS is required for non-loopback access when ALLOW_REMOTE_DASHBOARD=true.";
    if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
      res.status(400).json({
        error: "https_required",
        message,
      });
      return;
    }

    res.status(400).type("text/plain").send(message);
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "style-src": ["'self'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "script-src": ["'self'", "https://unpkg.com"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (isProduction && !useMemorystore) {
    process.stderr.write(
      "[omni-connector] Using the default in-memory session store in production. Configure sticky sessions or an external shared store before scaling beyond a single process.\n",
    );
  }

  app.use(express.json({ limit: "300kb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      name: "omni_connector_sid",
      secret: config.sessionSecret,
      proxy: config.allowRemoteDashboard,
      resave: false,
      saveUninitialized: false,
      unset: "destroy",
      ...(sessionStore ? { store: sessionStore } : {}),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.allowRemoteDashboard ? "auto" : isProduction,
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use((_, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(createOAuthRouter({
    connectorService,
    oauthProviderService,
    allowRemoteDashboard: config.allowRemoteDashboard,
  }));
  app.use(
    "/api",
    createApiRouter({
      connectorService,
      oauthProviderService,
      providerUsageService,
      strictLiveQuota: config.strictLiveQuota,
      allowRemoteDashboard: config.allowRemoteDashboard,
    }),
  );
  app.use(
    "/v1",
    createOpenAiRouter({
      connectorService,
      providerInferenceBaseUrls: config.providerInferenceBaseUrls,
      codexChatgptBaseUrl: config.codexChatgptBaseUrl,
    }),
  );

  const assetDirectory = [
    path.join(config.publicDir, "assets"),
    path.resolve(config.publicDir, "..", "assets"),
    path.join(process.cwd(), "assets"),
  ].find((candidatePath) => {
    try {
      return fs.statSync(candidatePath).isDirectory();
    } catch {
      return false;
    }
  });

  if (assetDirectory) {
    app.use(
      "/assets",
      express.static(assetDirectory, {
        index: false,
      }),
    );
  }

  app.use(express.static(config.publicDir, { index: "index.html" }));

  app.use((req, res, next) => {
    if (req.method !== "GET") {
      next();
      return;
    }

    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/v1/") ||
      req.path.startsWith("/assets") ||
      req.path.startsWith("/auth/") ||
      req.path.startsWith("/oauth/") ||
      path.extname(req.path).length > 0
    ) {
      next();
      return;
    }

    res.sendFile(path.join(config.publicDir, "index.html"));
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const shouldReturnJson = req.path.startsWith("/api/") || req.path.startsWith("/v1/");

    if (isHttpError(error)) {
      if (shouldReturnJson) {
        const message = error.status >= 500 ? "Server error. Please try again shortly." : error.message;
        res.status(error.status).json({
          error: error.code,
          message,
        });
        return;
      }

      const allowsDetailedServerMessage = error.code === "oauth_not_configured";
      const message =
        error.status >= 500 && !allowsDetailedServerMessage
          ? "Server error. Please try again shortly."
          : error.message;
      res.status(error.status).type("text/plain").send(message);
      return;
    }

    if (shouldReturnJson) {
      res.status(500).json({
        error: "internal_error",
        message: "Server error. Please try again shortly.",
      });
      return;
    }

    res.status(500).type("text/plain").send("Server error. Please try again shortly.");
  });

  return app;
}
