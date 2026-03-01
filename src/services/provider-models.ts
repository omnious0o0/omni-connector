import { effectiveAccountAuthMethod } from "../account-auth";
import { AppConfig } from "../config";
import {
  ConnectedAccount,
  ConnectedProviderModelsEntry,
  ConnectedProviderModelsPayload,
  ProviderId,
} from "../types";
import { resilientFetch } from "./http-resilience";

const PROVIDER_ORDER: ProviderId[] = ["codex", "gemini", "claude", "openrouter"];
const CODEX_MODELS_CLIENT_VERSION = "0.99.0";
const GEMINI_CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com";
const GEMINI_CODE_ASSIST_API_VERSION = "v1internal";
const EXTERNAL_ERROR_MESSAGE_MAX_LENGTH = 260;

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

function sanitizeExternalErrorMessage(rawMessage: string, fallback: string): string {
  const normalized = rawMessage.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  const redacted = normalized
    .replace(/([?&](?:key|api_key|apikey|token|access_token|refresh_token)=)([^&\s]+)/gi, "$1[redacted]")
    .replace(/(\b(?:key|api_key|apikey|token|access_token|refresh_token)=)([^\s&]+)/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~-]{10,}/gi, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[A-Za-z0-9-]+)\b/g, "[redacted]");

  return redacted.slice(0, EXTERNAL_ERROR_MESSAGE_MAX_LENGTH);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeExternalErrorMessage(error.message, "provider request failed");
  }

  return sanitizeExternalErrorMessage("provider request failed", "provider request failed");
}

export class ProviderModelsService {
  public constructor(private readonly config: AppConfig) {}

  private geminiCodeAssistQuotaEndpoint(): string {
    const baseUrl = asString(process.env.CODE_ASSIST_ENDPOINT) ?? GEMINI_CODE_ASSIST_BASE_URL;
    const apiVersion = asString(process.env.CODE_ASSIST_API_VERSION) ?? GEMINI_CODE_ASSIST_API_VERSION;
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedVersion = apiVersion.replace(/^\/+|\/+$/g, "");
    return `${normalizedBase}/${normalizedVersion}:retrieveUserQuota`;
  }

  private extractUpstreamError(payload: unknown): string | null {
    const root = asRecord(payload);
    if (!root) {
      return null;
    }

    const directMessage = asString(root.message);
    const errorValue = root.error;
    if (typeof errorValue === "string") {
      return asString(errorValue);
    }

    const errorRecord = asRecord(errorValue);
    if (!errorRecord) {
      return directMessage;
    }

    const message = asString(errorRecord.message);
    const status = asString(errorRecord.status);
    let reason: string | null = null;

    for (const detail of asArray(errorRecord.details)) {
      const detailRecord = asRecord(detail);
      if (!detailRecord) {
        continue;
      }

      const detailReason = asString(detailRecord.reason);
      if (detailReason) {
        reason = detailReason;
        break;
      }

      const metadata = asRecord(detailRecord.metadata);
      const metadataReason = metadata ? asString(metadata.reason) : null;
      if (metadataReason) {
        reason = metadataReason;
        break;
      }
    }

    const summary = message ?? directMessage ?? status;
    if (!summary) {
      return reason;
    }

    if (reason && !summary.includes(reason)) {
      return `${summary} (${reason})`;
    }

    return summary;
  }

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
    const authMethod = effectiveAccountAuthMethod(account);
    if (authMethod === "oauth") {
      return await this.fetchCodexOauthModels(account, accessToken);
    }

    const openAiLikeEndpoint = buildUrlWithPath(this.config.providerInferenceBaseUrls.codex, "models");
    const modelIds = await this.fetchModelsFromEndpoint(openAiLikeEndpoint, {
      ...this.baseJsonHeaders(),
      Authorization: `Bearer ${accessToken}`,
    });
    if (modelIds.length === 0) {
      throw new Error("no models returned by provider");
    }

    return modelIds;
  }

  private async fetchCodexOauthModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const headers: Record<string, string> = {
      ...this.baseJsonHeaders(),
      Authorization: `Bearer ${accessToken}`,
    };
    if (account.chatgptAccountId) {
      headers["ChatGPT-Account-Id"] = account.chatgptAccountId;
    }

    const endpoint = buildUrlWithPath(this.config.codexChatgptBaseUrl, "models");
    const endpointWithVersion = `${endpoint}?client_version=${encodeURIComponent(CODEX_MODELS_CLIENT_VERSION)}`;
    const payload = await this.fetchJson(endpointWithVersion, headers);
    const modelIds = this.extractCodexOauthModelIds(payload);
    if (modelIds.length === 0) {
      throw new Error("no codex oauth models returned by provider");
    }

    return modelIds;
  }

  private extractCodexOauthModelIds(payload: unknown): string[] {
    const root = asRecord(payload);
    if (!root) {
      return [];
    }

    const models = asArray(root.models);
    const modelIds = new Set<string>();
    for (const modelEntry of models) {
      const record = asRecord(modelEntry);
      if (!record) {
        continue;
      }

      if (record.supported_in_api !== true) {
        continue;
      }

      const slug = asString(record.slug);
      if (!slug) {
        continue;
      }

      const normalized = normalizeModelId(slug);
      if (normalized) {
        modelIds.add(normalized);
      }
    }

    return sortModelIds(modelIds);
  }

  private extractGeminiCodeAssistModelIds(payload: unknown): string[] {
    const root = asRecord(payload);
    if (!root) {
      return [];
    }

    const modelIds = new Set<string>();
    for (const bucket of asArray(root.buckets)) {
      const record = asRecord(bucket);
      if (!record) {
        continue;
      }

      const rawModelId = asString(record.modelId ?? record.model_id);
      if (!rawModelId) {
        continue;
      }

      const normalizedCandidate = rawModelId.endsWith("_vertex")
        ? rawModelId.slice(0, rawModelId.length - "_vertex".length)
        : rawModelId;
      const normalized = normalizeModelId(normalizedCandidate);
      if (normalized) {
        modelIds.add(normalized);
      }
    }

    return sortModelIds(modelIds);
  }

  private async fetchGeminiOauthModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const endpoint = this.geminiCodeAssistQuotaEndpoint();
    const headers: Record<string, string> = {
      ...this.baseJsonHeaders(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    const projectId = account.providerAccountId.trim();
    const body = projectId.length > 0 ? { project: projectId } : {};
    const payload = await this.requestJson(endpoint, headers, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.extractGeminiCodeAssistModelIds(payload);
  }

  private async fetchGeminiModels(account: ConnectedAccount, accessToken: string): Promise<string[]> {
    const authMethod = effectiveAccountAuthMethod(account);
    const modelIds = new Set<string>();
    let codeAssistError: Error | null = null;

    if (authMethod === "oauth") {
      try {
        const oauthModels = await this.fetchGeminiOauthModels(account, accessToken);
        if (oauthModels.length > 0) {
          return oauthModels;
        }
      } catch (error) {
        codeAssistError = error instanceof Error ? error : new Error("provider request failed");
      }
    }

    const headers =
      authMethod === "api"
        ? this.baseJsonHeaders()
        : {
            ...this.baseJsonHeaders(),
            Authorization: `Bearer ${accessToken}`,
          };

    if (authMethod === "oauth") {
      const billingProjectId = account.providerAccountId.trim();
      if (billingProjectId.length > 0) {
        headers["x-goog-user-project"] = billingProjectId;
      }
    }

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
      nativeError = error instanceof Error ? error : new Error("provider request failed");
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
          nativeError = error instanceof Error ? error : new Error("provider request failed");
        }
      }
    }

    const sortedModelIds = sortModelIds(modelIds);
    if (sortedModelIds.length === 0) {
      if (codeAssistError) {
        throw codeAssistError;
      }

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

    if (effectiveAccountAuthMethod(account) === "api") {
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
    return this.requestJson(endpoint, headers, {
      method: "GET",
    });
  }

  private async requestJson(
    endpoint: string,
    headers: Record<string, string>,
    request: {
      method: "GET" | "POST";
      body?: string;
    },
  ): Promise<unknown> {
    const response = await resilientFetch(
      endpoint,
      {
        method: request.method,
        headers,
        body: request.body,
      },
      {
        timeoutMs: 12_000,
        maxAttempts: 2,
        baseDelayMs: 180,
        maxDelayMs: 700,
      },
    );

    const responseBody = await response.text();
    let payload: unknown;

    try {
      payload = responseBody.length > 0 ? (JSON.parse(responseBody) as unknown) : null;
    } catch {
      if (!response.ok) {
        const snippet = responseBody.trim().slice(0, 200);
        if (snippet.length > 0) {
          throw new Error(`status ${response.status}: ${snippet}`);
        }
        throw new Error(`status ${response.status}`);
      }

      throw new Error("invalid JSON response");
    }

    if (!response.ok) {
      const detail = this.extractUpstreamError(payload);
      if (detail) {
        throw new Error(`status ${response.status}: ${detail}`);
      }

      throw new Error(`status ${response.status}`);
    }

    if (payload === null) {
      throw new Error("invalid JSON response");
    }

    return payload;
  }
}
