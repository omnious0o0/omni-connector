import { ProviderModule } from "./contracts";

const claudeProvider: ProviderModule = {
  descriptor: {
    id: "claude",
    name: "Anthropic (Claude)",
    methods: ["oauth", "api"],
  },
  oauthProfiles: [
    {
      providerId: "claude",
      envPrefix: "CLAUDE_CODE",
      id: "claude-code",
      defaults: {
        label: "Claude Code",
        authorizationUrl: "https://console.anthropic.com/oauth/authorize",
        tokenUrl: "https://console.anthropic.com/v1/oauth/token",
        userInfoUrl: "https://api.anthropic.com/v1/user",
        scopes: "user:inference user:profile",
        clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      },
    },
  ],
  usage: {
    providerId: "claude",
    envPrefix: "CLAUDE",
    defaults: {
      parser: "anthropic_usage",
      authMode: "bearer",
      baseUrl: "https://api.anthropic.com/v1",
      headers: {
        "anthropic-version": "2023-06-01",
      },
    },
  },
};

export default claudeProvider;
