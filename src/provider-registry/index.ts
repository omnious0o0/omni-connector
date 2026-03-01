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

export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = Object.freeze(
  modules.map((providerModule) => providerModule.descriptor),
);

const moduleByProviderId = new Map<ProviderId, ProviderModule>(
  modules.map((providerModule) => [providerModule.descriptor.id, providerModule]),
);

export function isProviderId(value: string): value is ProviderId {
  return moduleByProviderId.has(value as ProviderId);
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
