import { ProviderModule } from "./contracts";

const claudeProvider: ProviderModule = {
  descriptor: {
    id: "claude",
    name: "Anthropic (Claude)",
    methods: ["api"],
  },
  oauthProfiles: [],
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
