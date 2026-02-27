import { ProviderModule } from "./contracts";

const googleAuthorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const googleUserInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";

const geminiProvider: ProviderModule = {
  descriptor: {
    id: "gemini",
    name: "Google (Gemini)",
    methods: ["oauth", "api"],
    warnings: [
      "Gemini CLI OAuth may violate provider terms. Use at your own risk.",
      "Antigravity OAuth may violate provider terms. Use at your own risk.",
    ],
  },
  oauthProfiles: [
    {
      providerId: "gemini",
      envPrefix: "GEMINI_CLI",
      id: "gemini-cli",
      defaults: {
        label: "Gemini CLI",
        authorizationUrl: googleAuthorizationUrl,
        tokenUrl: googleTokenUrl,
        userInfoUrl: googleUserInfoUrl,
        scopes:
          "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        extraParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    },
    {
      providerId: "gemini",
      envPrefix: "GEMINI_ANTIGRAVITY",
      id: "antigravity",
      defaults: {
        label: "Antigravity",
        authorizationUrl: googleAuthorizationUrl,
        tokenUrl: googleTokenUrl,
        userInfoUrl: googleUserInfoUrl,
        scopes:
          "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs",
        extraParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    },
  ],
  usage: {
    providerId: "gemini",
    envPrefix: "GEMINI",
    defaults: {
      parser: "json_totals",
      authMode: "query-api-key",
      authQueryParam: "key",
    },
  },
};

export default geminiProvider;
