import { ProviderModule } from "./contracts";

const codexProvider: ProviderModule = {
  descriptor: {
    id: "codex",
    name: "OpenAI (Codex)",
    methods: ["oauth", "api"],
  },
  oauthProfiles: [
    {
      providerId: "codex",
      envPrefix: "CODEX",
      id: "oauth",
      defaults: {
        label: "OpenAI (Codex)",
        authorizationUrl: "https://auth.openai.com/oauth/authorize",
        tokenUrl: "https://auth.openai.com/oauth/token",
        userInfoUrl: null,
        scopes: "openid profile email offline_access",
        originator: "codex_cli_rs",
        clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
        clientSecret: "",
        extraParams: {
          codex_cli_simplified_flow: "true",
          id_token_add_organizations: "true",
        },
      },
    },
  ],
  usage: {
    providerId: "codex",
    envPrefix: "CODEX",
    defaults: {
      parser: "openai_usage",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
    },
  },
};

export default codexProvider;
