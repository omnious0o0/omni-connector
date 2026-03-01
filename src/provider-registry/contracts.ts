import { ProviderId } from "../types";

type ProviderAuthMethod = "oauth" | "api";

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  methods: readonly ProviderAuthMethod[];
  recommended?: boolean;
  warnings?: readonly string[];
}

interface OAuthProfileDefaultsDefinition {
  label: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string | null;
  scopes: string;
  originator?: string | null;
  extraParams?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthProfileDefinition {
  providerId: ProviderId;
  envPrefix: string;
  id: string;
  defaults: OAuthProfileDefaultsDefinition;
}

interface ProviderUsageDefaultsDefinition {
  parser: "openai_usage" | "anthropic_usage" | "json_totals";
  authMode: "bearer" | "x-api-key" | "query-api-key";
  authQueryParam?: string;
  baseUrl?: string | null;
  fiveHourUrl?: string | null;
  weeklyUrl?: string | null;
  fiveHourLimit?: number;
  weeklyLimit?: number;
  headers?: Record<string, string>;
}

export interface ProviderUsageDefinition {
  providerId: ProviderId;
  envPrefix: string;
  defaults: ProviderUsageDefaultsDefinition;
}

export interface ProviderModule {
  descriptor: ProviderDescriptor;
  oauthProfiles: readonly OAuthProfileDefinition[];
  usage: ProviderUsageDefinition;
}
