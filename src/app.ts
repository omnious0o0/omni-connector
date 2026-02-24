import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import helmet from "helmet";
import { AppConfig, resolveConfig } from "./config";
import { isHttpError } from "./errors";
import { createApiRouter } from "./routes/api";
import { createOAuthRouter } from "./routes/oauth";
import { ConnectorService } from "./services/connector";
import { OAuthProviderService } from "./services/oauth-provider";
import { DataStore } from "./store";

export function createApp(overrides: Partial<AppConfig> = {}): express.Express {
  const config: AppConfig = {
    ...resolveConfig(),
    ...overrides,
  };

  const store = new DataStore(config.dataFilePath);
  const oauthProviderService = new OAuthProviderService(config);
  const connectorService = new ConnectorService(store, oauthProviderService);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

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
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: "300kb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      name: "omni_connector_sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use((_, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(createOAuthRouter({ connectorService, oauthProviderService }));
  app.use("/api", createApiRouter({ connectorService, oauthProviderService }));

  app.use(express.static(config.publicDir, { index: "index.html" }));

  app.use((req, res, next) => {
    if (req.method !== "GET") {
      next();
      return;
    }

    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/auth/") ||
      req.path.startsWith("/oauth/")
    ) {
      next();
      return;
    }

    res.sendFile(path.join(config.publicDir, "index.html"));
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (isHttpError(error)) {
      if (req.path.startsWith("/api/")) {
        res.status(error.status).json({
          error: error.code,
          message: error.message,
        });
        return;
      }

      res.status(error.status).type("text/plain").send(error.message);
      return;
    }

    if (req.path.startsWith("/api/")) {
      res.status(500).json({
        error: "internal_error",
        message: "Unexpected server error.",
      });
      return;
    }

    res.status(500).type("text/plain").send("Unexpected server error.");
  });

  return app;
}
