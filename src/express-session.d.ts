import "express-session";
import { ProviderId } from "./types";

interface OAuthPendingFlowSessionState {
  redirectUri: string;
  codeVerifier: string;
  providerId: ProviderId;
  profileId: string;
  createdAt: string;
}

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    oauthRedirectUri?: string;
    oauthCodeVerifier?: string;
    oauthProviderId?: ProviderId;
    oauthProfileId?: string;
    oauthPendingFlows?: Record<string, OAuthPendingFlowSessionState>;
    oauthLastCompletedState?: string;
    dashboardAuthorized?: boolean;
  }
}
