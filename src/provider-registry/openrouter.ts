import { ProviderModule } from "./contracts";

const openrouterProvider: ProviderModule = {
  descriptor: {
    id: "openrouter",
    name: "OpenRouter",
    methods: ["api"],
    recommended: true,
  },
  oauthProfiles: [],
  usage: {
    providerId: "openrouter",
    envPrefix: "OPENROUTER",
    defaults: {
      parser: "json_totals",
      authMode: "bearer",
      fiveHourUrl: "https://openrouter.ai/api/v1/auth/key",
      weeklyUrl: "https://openrouter.ai/api/v1/credits",
    },
  },
};

export default openrouterProvider;
