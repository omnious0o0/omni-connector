import { ProviderId } from "../types";
import claudeProvider from "./claude";
import codexProvider from "./codex";
import {
  OAuthProfileDefinition,
  ProviderDescriptor,
  ProviderModule,
  ProviderUsageDefinition,
} from "./contracts";
import geminiProvider from "./gemini";
import openrouterProvider from "./openrouter";

const modules: readonly ProviderModule[] = Object.freeze([
  codexProvider,
  geminiProvider,
  claudeProvider,
  openrouterProvider,
]);

export const PROVIDER_MODULES: readonly ProviderModule[] = modules;

export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = Object.freeze(
  PROVIDER_MODULES.map((providerModule) => providerModule.descriptor),
);

const moduleByProviderId = new Map<ProviderId, ProviderModule>(
  PROVIDER_MODULES.map((providerModule) => [providerModule.descriptor.id, providerModule]),
);

const providerNameLookup = new Map<ProviderId, string>(
  PROVIDER_CATALOG.map((provider) => [provider.id, provider.name]),
);

export function isProviderId(value: string): value is ProviderId {
  return moduleByProviderId.has(value as ProviderId);
}

export function providerDisplayName(providerId: ProviderId): string {
  return providerNameLookup.get(providerId) ?? providerId;
}

export function providerOAuthProfileDefinitions(providerId: ProviderId): readonly OAuthProfileDefinition[] {
  const providerModule = moduleByProviderId.get(providerId);
  return providerModule?.oauthProfiles ?? [];
}

export function providerUsageDefinition(providerId: ProviderId): ProviderUsageDefinition {
  const providerModule = moduleByProviderId.get(providerId);
  if (!providerModule) {
    throw new Error(`Provider usage definition not found for provider ${providerId}.`);
  }

  return providerModule.usage;
}

export type { ProviderDescriptor, ProviderModule, OAuthProfileDefinition, ProviderUsageDefinition };
