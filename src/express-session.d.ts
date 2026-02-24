import "express-session";

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    oauthRedirectUri?: string;
    oauthCodeVerifier?: string;
    dashboardAuthorized?: boolean;
  }
}
