import { AppConfig } from "../config";
import {
  ConnectedAccount,
  ConnectedProviderModelsEntry,
  ConnectedProviderModelsPayload,
  ProviderId,
} from "../types";
import { resilientFetch } from "./http-resilience";

const PROVIDER_ORDER: ProviderId[] = ["codex", "gemini", "claude", "openrouter"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildUrlWithPath(baseUrl: string, pathSegment: string): string {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  parsed.pathname = `${basePath}${pathSegment.replace(/^\/+/, "")}`;
  parsed.search = "";
  return parsed.toString();
}

function normalizeModelId(rawModelId: string): string | null {
  const trimmed = rawModelId.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("models/")) {
    const modelId = trimmed.slice("models/".length).trim();
    return modelId.length > 0 ? modelId : null;
  }

  return trimmed;
}

function sortModelIds(modelIds: Iterable<string>): string[] {
  return [...new Set(modelIds)].sort((left, right) => left.localeCompare(right));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "request failed";
}

export class ProviderModelsService {
  public constructor(private readonly config: AppConfig) {}

  public async fetchConnectedProviderModels(
    accounts: ConnectedAccount[],
  ): Promise<ConnectedProviderModelsPayload> {
    const grouped = new Map<ProviderId, ConnectedAccount[]>();
    for (const account of accounts) {
      if (!grouped.has(account.provider)) {
        grouped.set(account.provider, []);
      }

      grouped.get(account.provider)?.push(account);
    }

    const entries = await Promise.all(
      [...grouped.entries()].map(async ([providerId, providerAccounts]) =>
        this.fetchProviderEntry(providerId, providerAccounts),
      ),
    );

    entries.sort(
      (left, right) => PROVIDER_ORDER.indexOf(left.provider) - PROVIDER_ORDER.indexOf(right.provider),
    );

    return {
      providers: entries,
    };
  }

  private async fetchProviderEntry(
    providerId: ProviderId,
    accounts: ConnectedAccount[],
  ): Promise<ConnectedProviderModelsEntry> {
    const settled = await Promise.allSettled(
      accounts.map(async (account) => this.fetchModelsForAccount(account)),
    );

    const modelIds = new Set<string>();
    const failures: string[] = [];

    for (const result of settled) {
      if (result.status === "fulfilled") {
        for (const modelId of result.value) {
          modelIds.add(modelId);
        }
        continue;
      }

      failures.push(errorMessage(result.reason));
    }

    const uniqueFailures = [...new Set(failures)];
    const sortedModelIds = sortModelIds(modelIds);

    return {
      provider: providerId,
      accountCount: accounts.length,
      status: sortedModelIds.length > 0 ? "live" : "unavailable",
      modelIds: sortedModelIds,
      syncError: uniqueFailures.length > 0 ? uniqueFailures.join("; ") : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchModelsForAccount(account: ConnectedAccount): Promise<string[]> {
    const accessToken = account.accessToken.trim();
    if (!accessToken) {
      throw new Error("missing account credential");
    }

    switch (account.provider) {
      case "codex":
        return await this.fetchCodexModels(account, accessToken);
      case "gemini":
        return await this.fetchGeminiModels(account, accessToken);
      case "claude":
        return await this.fetchClaudeModels(account, accessToken);
      case "openrouter":
        return await this.fetchOpenRouterModels(accessToken);
      default:
        return [];
    }
  }

  private async fetchCodexModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const openAiLikeEndpoint = buildUrlWithPath(this.config.providerInferenceBaseUrls.codex, "models");
    let primaryAttempt: string[] = [];
    let lastError: Error | null = null;
    try {
      primaryAttempt = await this.fetchModelsFromEndpoint(openAiLikeEndpoint, {
        ...this.baseJsonHeaders(),
        Authorization: `Bearer ${accessToken}`,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("request failed");
    }

    if (primaryAttempt.length > 0) {
      return primaryAttempt;
    }

    if ((account.authMethod ?? "oauth") !== "oauth") {
      if (lastError) {
        throw lastError;
      }

      throw new Error("no models returned by provider");
    }

    const oauthHeaders: Record<string, string> = {
      ...this.baseJsonHeaders(),
      Authorization: `Bearer ${accessToken}`,
    };
    if (account.chatgptAccountId) {
      oauthHeaders["ChatGPT-Account-Id"] = account.chatgptAccountId;
    }

    const oauthEndpoints = this.codexOauthModelEndpoints();
    for (const endpoint of oauthEndpoints) {
      try {
        const modelIds = await this.fetchModelsFromEndpoint(endpoint, oauthHeaders);
        if (modelIds.length > 0) {
          return modelIds;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("request failed");
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("no models returned by provider");
  }

  private codexOauthModelEndpoints(): string[] {
    const endpoints = new Set<string>();
    endpoints.add(buildUrlWithPath(this.config.codexChatgptBaseUrl, "models"));

    const parsed = new URL(this.config.codexChatgptBaseUrl);
    const rootBackend = new URL(parsed.origin);
    rootBackend.pathname = "/backend-api/models";
    rootBackend.search = "";
    endpoints.add(rootBackend.toString());

    return [...endpoints];
  }

  private async fetchGeminiModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const authMethod = account.authMethod ?? "oauth";
    const modelIds = new Set<string>();
    const headers =
      authMethod === "api"
        ? this.baseJsonHeaders()
        : {
            ...this.baseJsonHeaders(),
            Authorization: `Bearer ${accessToken}`,
          };

    let nativeError: Error | null = null;
    try {
      let pageToken: string | null = null;
      for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
        const endpoint = this.geminiModelsEndpoint(pageToken, authMethod === "api" ? accessToken : null);
        const payload = await this.fetchJson(endpoint, headers);
        for (const modelId of this.extractModelIds(payload)) {
          modelIds.add(modelId);
        }

        const payloadRecord = asRecord(payload);
        pageToken = payloadRecord ? asString(payloadRecord.nextPageToken) : null;
        if (!pageToken) {
          break;
        }
      }
    } catch (error) {
      nativeError = error instanceof Error ? error : new Error("request failed");
    }

    if (modelIds.size === 0) {
      const compatibilityEndpoint =
        authMethod === "api"
          ? `${buildUrlWithPath(this.config.providerInferenceBaseUrls.gemini, "models")}?key=${encodeURIComponent(accessToken)}`
          : buildUrlWithPath(this.config.providerInferenceBaseUrls.gemini, "models");
      try {
        const payload = await this.fetchJson(compatibilityEndpoint, headers);
        for (const modelId of this.extractModelIds(payload)) {
          modelIds.add(modelId);
        }
      } catch (error) {
        if (nativeError === null) {
          nativeError = error instanceof Error ? error : new Error("request failed");
        }
      }
    }

    const sortedModelIds = sortModelIds(modelIds);
    if (sortedModelIds.length === 0) {
      if (nativeError) {
        throw nativeError;
      }

      throw new Error("no models returned by provider");
    }

    return sortedModelIds;
  }

  private geminiModelsEndpoint(pageToken: string | null, apiKey: string | null): string {
    const inferenceBase = new URL(this.config.providerInferenceBaseUrls.gemini);
    const endpoint = new URL(inferenceBase.origin);
    endpoint.pathname = "/v1beta/models";
    endpoint.search = "";
    endpoint.searchParams.set("pageSize", "1000");
    if (pageToken) {
      endpoint.searchParams.set("pageToken", pageToken);
    }
    if (apiKey) {
      endpoint.searchParams.set("key", apiKey);
    }
    return endpoint.toString();
  }

  private async fetchClaudeModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const endpoint = buildUrlWithPath(this.config.providerInferenceBaseUrls.claude, "models");
    const headers: Record<string, string> = {
      ...this.baseJsonHeaders(),
      "anthropic-version": this.config.providerUsage.claude.headers["anthropic-version"] ?? "2023-06-01",
    };

    if ((account.authMethod ?? "oauth") === "api") {
      headers["x-api-key"] = accessToken;
    } else {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    return await this.fetchModelsFromEndpoint(endpoint, headers);
  }

  private async fetchOpenRouterModels(accessToken: string): Promise<string[]> {
    const endpoint = buildUrlWithPath(this.config.providerInferenceBaseUrls.openrouter, "models");
    return await this.fetchModelsFromEndpoint(endpoint, {
      ...this.baseJsonHeaders(),
      Authorization: `Bearer ${accessToken}`,
    });
  }

  private baseJsonHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": "omni-connector/1.0",
    };
  }

  private async fetchModelsFromEndpoint(
    endpoint: string,
    headers: Record<string, string>,
  ): Promise<string[]> {
    const payload = await this.fetchJson(endpoint, headers);
    return this.extractModelIds(payload);
  }

  private extractModelIds(payload: unknown): string[] {
    const modelIds = new Set<string>();

    const collectFromList = (entries: unknown[]): void => {
      for (const entry of entries) {
        const record = asRecord(entry);
        if (!record) {
          continue;
        }

        const candidates = [
          asString(record.id),
          asString(record.model),
          asString(record.slug),
          asString(record.name),
        ];

        for (const candidate of candidates) {
          if (!candidate) {
            continue;
          }

          const normalized = normalizeModelId(candidate);
          if (normalized) {
            modelIds.add(normalized);
          }
        }
      }
    };

    const root = asRecord(payload);
    if (!root) {
      return [];
    }

    collectFromList(asArray(root.data));
    collectFromList(asArray(root.models));

    const result = asRecord(root.result);
    if (result) {
      collectFromList(asArray(result.data));
      collectFromList(asArray(result.models));
    }

    return sortModelIds(modelIds);
  }

  private async fetchJson(endpoint: string, headers: Record<string, string>): Promise<unknown> {
    const response = await resilientFetch(
      endpoint,
      {
        method: "GET",
        headers,
      },
      {
        timeoutMs: 12_000,
        maxAttempts: 2,
        baseDelayMs: 180,
        maxDelayMs: 700,
      },
    );

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error("invalid JSON response");
    }
  }
}
