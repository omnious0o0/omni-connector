import crypto from "node:crypto";
import { Response as ExpressResponse, Router } from "express";
import { effectiveAccountAuthMethod } from "../account-auth";
import { HttpError } from "../errors";
import { resilientFetch } from "../services/http-resilience";
import { ConnectedAccount, ProviderId } from "../types";

interface OpenAiConnectorService {
  routeCandidates(apiKey: string, units: number, modelHint?: string): Promise<ConnectedAccount[]>;
  consumeRoutedUsage(accountId: string, units: number): void;
}

interface OpenAiRouterDependencies {
  connectorService: OpenAiConnectorService;
  providerInferenceBaseUrls: Record<ProviderId, string>;
  codexChatgptBaseUrl: string;
}

interface ProviderFailureDetail {
  provider: ProviderId;
  status: number | null;
  message: string;
}

type OpenAiRole = "system" | "developer" | "user" | "assistant" | "tool";

interface OpenAiMessage {
  role: OpenAiRole;
  content: unknown;
}

interface CodexSseCompletion {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  codex: "gpt-4.1-mini",
  gemini: "gemini-2.0-flash",
  claude: "claude-3-5-sonnet-latest",
  openrouter: "openai/gpt-4o-mini",
};
const DEFAULT_CODEX_CHATGPT_MODEL = "gpt-5-codex";
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

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    return sanitizeExternalErrorMessage(error.message, fallback);
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeExternalErrorMessage(error.message, fallback);
  }

  return sanitizeExternalErrorMessage(fallback, fallback);
}

function parseBearerToken(rawHeader: string | undefined): string {
  if (!rawHeader) {
    throw new HttpError(401, "missing_authorization", "Missing Authorization header.");
  }

  const match = /^Bearer\s+(.+)$/i.exec(rawHeader.trim());
  if (!match || !match[1]) {
    throw new HttpError(401, "invalid_authorization", "Authorization header must use Bearer token format.");
  }

  return match[1].trim();
}

function inferProviderFromModelReference(reference: string): ProviderId | null {
  const normalized = reference.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return null;
  }

  const providers: ProviderId[] = ["codex", "gemini", "claude", "openrouter"];
  for (const provider of providers) {
    if (
      normalized === provider ||
      normalized.startsWith(`${provider}/`) ||
      normalized.startsWith(`${provider}:`) ||
      normalized.startsWith(`${provider}-`)
    ) {
      return provider;
    }
  }

  return null;
}

function resolveModelForProvider(provider: ProviderId, requestedModel: string): string {
  const normalized = requestedModel.trim();
  const normalizedLower = normalized.toLowerCase();
  const hintedProvider = inferProviderFromModelReference(normalizedLower);
  if (hintedProvider && hintedProvider !== provider) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  if (!normalizedLower || normalizedLower === "auto" || normalizedLower === provider) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  if (normalizedLower.startsWith(`${provider}/`) || normalizedLower.startsWith(`${provider}:`)) {
    const providerPrefixLength = provider.length + 1;
    const stripped = normalized.slice(providerPrefixLength).trim();
    return stripped.length > 0 ? stripped : DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  return normalized;
}

function resolveCodexResponsesModel(requestedModel: string): string {
  const normalized = requestedModel.trim();
  const normalizedLower = normalized.toLowerCase();
  if (!normalizedLower || normalizedLower === "auto" || normalizedLower === "codex") {
    return DEFAULT_CODEX_CHATGPT_MODEL;
  }

  if (normalizedLower.startsWith("codex/") || normalizedLower.startsWith("codex:")) {
    const stripped = normalized.slice(6).trim();
    return stripped.length > 0 ? stripped : DEFAULT_CODEX_CHATGPT_MODEL;
  }

  return normalized;
}

function mapOpenAiRoleToCodexResponsesRole(role: OpenAiRole): "developer" | "user" | "assistant" {
  if (role === "system" || role === "developer") {
    return "developer";
  }

  if (role === "assistant") {
    return "assistant";
  }

  return "user";
}

function buildCodexResponsesInstructions(messages: OpenAiMessage[]): string {
  const segments: string[] = [];
  for (const message of messages) {
    if (message.role !== "system" && message.role !== "developer") {
      continue;
    }

    const text = messageContentToPlainText(message.content).trim();
    if (text.length > 0) {
      segments.push(text);
    }
  }

  return segments.length > 0 ? segments.join("\n\n") : "You are a helpful assistant.";
}

function buildCodexResponsesInput(messages: OpenAiMessage[]): Array<Record<string, unknown>> {
  const inputItems: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    const text = messageContentToPlainText(message.content).trim();
    if (!text) {
      continue;
    }

    inputItems.push({
      type: "message",
      role: mapOpenAiRoleToCodexResponsesRole(message.role),
      content: [
        {
          type: "input_text",
          text,
        },
      ],
    });
  }

  if (inputItems.length === 0) {
    throw new HttpError(400, "invalid_messages", "At least one text message is required.");
  }

  return inputItems;
}

function buildCodexResponsesBody(requestedModel: string, messages: OpenAiMessage[]): Record<string, unknown> {
  return {
    model: resolveCodexResponsesModel(requestedModel),
    instructions: buildCodexResponsesInstructions(messages),
    input: buildCodexResponsesInput(messages),
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: true,
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
  };
}

function extractTextFromCodexCompletedResponse(completed: Record<string, unknown>): string {
  const textChunks: string[] = [];
  for (const item of asArray(completed.output)) {
    const itemRecord = asRecord(item);
    if (!itemRecord) {
      continue;
    }

    if (typeof itemRecord.type !== "string" || itemRecord.type.trim().toLowerCase() !== "message") {
      continue;
    }

    for (const contentEntry of asArray(itemRecord.content)) {
      const contentRecord = asRecord(contentEntry);
      if (!contentRecord) {
        continue;
      }

      const contentType = typeof contentRecord.type === "string" ? contentRecord.type.trim().toLowerCase() : "";
      if (contentType !== "output_text" && contentType !== "text") {
        continue;
      }

      const text = typeof contentRecord.text === "string" ? contentRecord.text : null;
      if (text && text.trim().length > 0) {
        textChunks.push(text);
      }
    }
  }

  return textChunks.join("\n");
}

function mapCodexCompletionToOpenAi(completion: CodexSseCompletion): Record<string, unknown> {
  return {
    id: completion.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: completion.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completion.content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: completion.usage.promptTokens,
      completion_tokens: completion.usage.completionTokens,
      total_tokens: completion.usage.totalTokens,
    },
  };
}

function messageContentToPlainText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const segments: string[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (!record) {
      continue;
    }

    const partType = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    if (partType === "text" || partType === "input_text") {
      const textValue = typeof record.text === "string" ? record.text : null;
      if (textValue && textValue.trim().length > 0) {
        segments.push(textValue);
      }
    }
  }

  return segments.join("\n");
}

function parseOpenAiMessages(rawMessages: unknown): OpenAiMessage[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new HttpError(400, "invalid_messages", "messages must be a non-empty array.");
  }

  const parsed: OpenAiMessage[] = [];
  for (const rawMessage of rawMessages) {
    const record = asRecord(rawMessage);
    if (!record) {
      throw new HttpError(400, "invalid_messages", "Each message must be an object.");
    }

    const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
    const allowedRoles: OpenAiRole[] = ["system", "developer", "user", "assistant", "tool"];
    if (!allowedRoles.includes(role as OpenAiRole)) {
      throw new HttpError(400, "invalid_messages", "Each message requires a valid role.");
    }

    parsed.push({
      role: role as OpenAiRole,
      content: record.content,
    });
  }

  return parsed;
}

function parseChatCompletionRequestBody(rawBody: unknown): {
  model: string;
  requestPayload: Record<string, unknown>;
  messages: OpenAiMessage[];
} {
  const body = asRecord(rawBody);
  if (!body) {
    throw new HttpError(400, "invalid_request", "Request body must be a JSON object.");
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    throw new HttpError(400, "invalid_model", "model must be a non-empty string.");
  }

  if (body.stream === true) {
    throw new HttpError(400, "stream_not_supported", "stream=true is not supported by omni-connector yet.");
  }

  const messages = parseOpenAiMessages(body.messages);
  const requestPayload: Record<string, unknown> = {
    ...body,
    model,
    messages: body.messages,
  };

  return {
    model,
    requestPayload,
    messages,
  };
}

function anthropicStopReasonToOpenAi(reason: unknown): string {
  const normalized = typeof reason === "string" ? reason.trim().toLowerCase() : "";
  if (normalized === "max_tokens") {
    return "length";
  }

  if (normalized === "tool_use") {
    return "tool_calls";
  }

  return "stop";
}

function toOpenAiErrorType(status: number): string {
  if (status >= 500) {
    return "server_error";
  }

  if (status === 429) {
    return "rate_limit_error";
  }

  if (status === 401 || status === 403) {
    return "authentication_error";
  }

  return "invalid_request_error";
}

function sendOpenAiError(
  res: ExpressResponse,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  const fallbackMessage = status >= 500 ? "Unexpected server error." : "Request failed.";
  const safeMessage = sanitizeExternalErrorMessage(message, fallbackMessage);

  res.status(status).json({
    error: {
      message: safeMessage,
      type: toOpenAiErrorType(status),
      code,
      ...extra,
    },
  });
}

async function parseResponsePayload(response: globalThis.Response): Promise<{ json: unknown | null; text: string }> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {
      json: null,
      text: "",
    };
  }

  try {
    return {
      json: JSON.parse(rawText) as unknown,
      text: rawText,
    };
  } catch {
    return {
      json: null,
      text: rawText,
    };
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  if (!record) {
    return sanitizeExternalErrorMessage(fallback, fallback);
  }

  const errorRecord = asRecord(record.error);
  if (errorRecord && typeof errorRecord.message === "string" && errorRecord.message.trim()) {
    return sanitizeExternalErrorMessage(errorRecord.message, fallback);
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return sanitizeExternalErrorMessage(record.message, fallback);
  }

  return sanitizeExternalErrorMessage(fallback, fallback);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown | null; message: string }> {
  const response = await resilientFetch(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    {
      timeoutMs: 45_000,
      maxAttempts: 1,
      baseDelayMs: 300,
      maxDelayMs: 1_200,
      retryableStatusCodes: new Set([408, 425, 429, 500, 502, 503, 504]),
    },
  );

  const parsed = await parseResponsePayload(response);
  const message = response.ok
    ? "ok"
    : extractErrorMessage(parsed.json, parsed.text.trim() || `Upstream returned status ${response.status}.`);

  return {
    status: response.status,
    payload: parsed.json,
    message,
  };
}

async function parseCodexSseCompletionFromResponse(
  response: globalThis.Response,
  fallbackModel: string,
): Promise<CodexSseCompletion> {
  if (!response.body) {
    throw new HttpError(502, "provider_invalid_response", "Codex backend returned an empty stream body.");
  }

  const decoder = new TextDecoder();
  let buffered = "";
  let outputText = "";
  let completed: Record<string, unknown> | null = null;

  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffered.slice(0, newlineIndex).trimEnd();
      buffered = buffered.slice(newlineIndex + 1);

      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        newlineIndex = buffered.indexOf("\n");
        continue;
      }

      const payloadText = line.slice("data:".length).trim();
      if (!payloadText) {
        newlineIndex = buffered.indexOf("\n");
        continue;
      }

      if (payloadText === "[DONE]") {
        newlineIndex = buffered.indexOf("\n");
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(payloadText) as unknown;
      } catch {
        newlineIndex = buffered.indexOf("\n");
        continue;
      }

      const event = asRecord(payload);
      if (!event) {
        newlineIndex = buffered.indexOf("\n");
        continue;
      }

      const eventType = typeof event.type === "string" ? event.type.trim().toLowerCase() : "";
      if (eventType === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : null;
        if (delta) {
          outputText += delta;
        }
      } else if (eventType === "response.output_text.done") {
        const text = typeof event.text === "string" ? event.text : null;
        if (text && outputText.trim().length === 0) {
          outputText = text;
        }
      } else if (eventType === "response.completed") {
        completed = asRecord(event.response);
        if (completed && outputText.trim().length === 0) {
          outputText = extractTextFromCodexCompletedResponse(completed);
        }
      } else if (eventType === "error") {
        const message = extractErrorMessage(event, "Codex backend emitted an error event.");
        throw new HttpError(502, "upstream_request_failed", message);
      }

      newlineIndex = buffered.indexOf("\n");
    }
  }

  if (completed && outputText.trim().length === 0) {
    outputText = extractTextFromCodexCompletedResponse(completed);
  }

  if (outputText.trim().length === 0) {
    throw new HttpError(502, "provider_invalid_response", "Codex backend returned no assistant text.");
  }

  const usage = asRecord(completed?.usage);
  const promptTokens = Math.max(0, Math.round(asNumber(usage?.input_tokens) ?? 0));
  const completionTokens = Math.max(
    0,
    Math.round(asNumber(usage?.output_tokens) ?? asNumber(usage?.completion_tokens) ?? 0),
  );
  const totalTokens = Math.max(
    promptTokens + completionTokens,
    Math.round(asNumber(usage?.total_tokens) ?? promptTokens + completionTokens),
  );
  const id =
    typeof completed?.id === "string" && completed.id.trim().length > 0
      ? completed.id
      : `chatcmpl_${crypto.randomUUID()}`;
  const model =
    typeof completed?.model === "string" && completed.model.trim().length > 0
      ? completed.model
      : fallbackModel;

  return {
    id,
    model,
    content: outputText,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
    },
  };
}

async function postCodexResponsesSse(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  fallbackModel: string,
): Promise<CodexSseCompletion> {
  const response = await resilientFetch(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    {
      timeoutMs: 60_000,
      maxAttempts: 1,
      baseDelayMs: 300,
      maxDelayMs: 1_200,
      retryableStatusCodes: new Set([408, 425, 429, 500, 502, 503, 504]),
    },
  );

  if (!response.ok) {
    const parsed = await parseResponsePayload(response);
    const message = extractErrorMessage(
      parsed.json,
      parsed.text.trim() || `Upstream returned status ${response.status}.`,
    );
    throw new HttpError(response.status >= 400 ? response.status : 502, "upstream_request_failed", message);
  }

  return parseCodexSseCompletionFromResponse(response, fallbackModel);
}

function buildClaudeRequestBody(
  requestedModel: string,
  messages: OpenAiMessage[],
  basePayload: Record<string, unknown>,
): Record<string, unknown> {
  const model = resolveModelForProvider("claude", requestedModel);

  const systemSegments: string[] = [];
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of messages) {
    const text = messageContentToPlainText(message.content);
    if (!text.trim()) {
      continue;
    }

    if (message.role === "system" || message.role === "developer") {
      systemSegments.push(text);
      continue;
    }

    if (message.role === "assistant") {
      conversationMessages.push({ role: "assistant", content: text });
      continue;
    }

    conversationMessages.push({ role: "user", content: text });
  }

  if (conversationMessages.length === 0) {
    throw new HttpError(400, "invalid_messages", "At least one user/assistant message is required.");
  }

  const maxTokensRaw = basePayload.max_tokens;
  const maxTokens =
    typeof maxTokensRaw === "number" && Number.isFinite(maxTokensRaw) && maxTokensRaw > 0
      ? Math.round(maxTokensRaw)
      : 1024;

  const nextPayload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: conversationMessages,
  };

  if (systemSegments.length > 0) {
    nextPayload.system = systemSegments.join("\n\n");
  }

  if (typeof basePayload.temperature === "number") {
    nextPayload.temperature = basePayload.temperature;
  }

  if (typeof basePayload.top_p === "number") {
    nextPayload.top_p = basePayload.top_p;
  }

  if (Array.isArray(basePayload.stop) && basePayload.stop.length > 0) {
    nextPayload.stop_sequences = basePayload.stop;
  }

  return nextPayload;
}

function mapClaudeResponseToOpenAi(payload: unknown, fallbackModel: string): Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) {
    throw new HttpError(502, "provider_invalid_response", "Claude returned an invalid JSON response.");
  }

  const contentBlocks = asArray(record.content)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => typeof entry.type === "string" && entry.type.trim().toLowerCase() === "text")
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .filter((entry) => entry.trim().length > 0);

  const content = contentBlocks.join("\n");
  const usage = asRecord(record.usage);
  const promptTokens =
    typeof usage?.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? Math.max(0, Math.round(usage.input_tokens))
      : 0;
  const completionTokens =
    typeof usage?.output_tokens === "number" && Number.isFinite(usage.output_tokens)
      ? Math.max(0, Math.round(usage.output_tokens))
      : 0;

  const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id : `chatcmpl_${crypto.randomUUID()}`;
  const model = typeof record.model === "string" && record.model.trim().length > 0 ? record.model : fallbackModel;

  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: anthropicStopReasonToOpenAi(record.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

async function executeOpenAiCompatibleChatCompletion(
  candidate: ConnectedAccount,
  requestedModel: string,
  requestPayload: Record<string, unknown>,
  providerInferenceBaseUrls: Record<ProviderId, string>,
): Promise<Record<string, unknown>> {
  const model = resolveModelForProvider(candidate.provider, requestedModel);
  const upstreamBody: Record<string, unknown> = {
    ...requestPayload,
    model,
  };

  const endpointBase =
    candidate.provider === "codex"
      ? providerInferenceBaseUrls.codex
      : candidate.provider === "gemini"
        ? providerInferenceBaseUrls.gemini
        : providerInferenceBaseUrls.openrouter;

  const baseUrl = endpointBase.replace(/\/$/, "");
  const result = await postJson(
    `${baseUrl}/chat/completions`,
    {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "omni-connector/1.0",
      Authorization: `Bearer ${candidate.accessToken}`,
    },
    upstreamBody,
  );

  if (result.status < 200 || result.status >= 300 || !asRecord(result.payload)) {
    const fallbackMessage =
      result.status >= 200 && result.status < 300
        ? "Upstream returned an invalid response payload."
        : result.message;
    throw new HttpError(result.status >= 400 ? result.status : 502, "upstream_request_failed", fallbackMessage);
  }

  return result.payload as Record<string, unknown>;
}

async function executeChatCompletionForCandidate(
  candidate: ConnectedAccount,
  requestedModel: string,
  requestPayload: Record<string, unknown>,
  messages: OpenAiMessage[],
  providerInferenceBaseUrls: Record<ProviderId, string>,
  codexChatgptBaseUrl: string,
): Promise<Record<string, unknown>> {
  if (candidate.provider === "claude") {
    const claudeBody = buildClaudeRequestBody(requestedModel, messages, requestPayload);
    const baseUrl = providerInferenceBaseUrls.claude.replace(/\/$/, "");
    const result = await postJson(
      `${baseUrl}/messages`,
      {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "omni-connector/1.0",
        "x-api-key": candidate.accessToken,
        "anthropic-version": "2023-06-01",
      },
      claudeBody,
    );

    if (result.status < 200 || result.status >= 300) {
      throw new HttpError(result.status, "upstream_request_failed", result.message);
    }

    return mapClaudeResponseToOpenAi(result.payload, claudeBody.model as string);
  }

  const isCodexOAuth = candidate.provider === "codex" && effectiveAccountAuthMethod(candidate) === "oauth";
  if (isCodexOAuth) {
    const codexModel = resolveCodexResponsesModel(requestedModel);
    const codexBody = buildCodexResponsesBody(requestedModel, messages);
    const codexHeaders: Record<string, string> = {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "omni-connector/1.0",
      Authorization: `Bearer ${candidate.accessToken}`,
      originator: "codex_cli_rs",
    };
    if (candidate.chatgptAccountId) {
      codexHeaders["ChatGPT-Account-Id"] = candidate.chatgptAccountId;
    }

    const codexUrl = `${codexChatgptBaseUrl.replace(/\/$/, "")}/responses`;

    try {
      const codexCompletion = await postCodexResponsesSse(codexUrl, codexHeaders, codexBody, codexModel);
      return mapCodexCompletionToOpenAi(codexCompletion);
    } catch (codexError) {
      const primaryFailureMessage = errorMessage(codexError, "Codex backend request failed.");
      try {
        return await executeOpenAiCompatibleChatCompletion(
          candidate,
          requestedModel,
          requestPayload,
          providerInferenceBaseUrls,
        );
      } catch (fallbackError) {
        const fallbackFailureMessage = errorMessage(fallbackError, "OpenAI-compatible fallback failed.");
        const fallbackStatus = fallbackError instanceof HttpError ? fallbackError.status : 502;
        throw new HttpError(
          fallbackStatus,
          "upstream_request_failed",
          `Codex backend failed (${primaryFailureMessage}). OpenAI-compatible fallback failed (${fallbackFailureMessage}).`,
        );
      }
    }
  }

  return executeOpenAiCompatibleChatCompletion(
    candidate,
    requestedModel,
    requestPayload,
    providerInferenceBaseUrls,
  );
}

export function createOpenAiRouter(dependencies: OpenAiRouterDependencies): Router {
  const router = Router();

  router.post("/chat/completions", async (req, res) => {
    try {
      const connectorKey = parseBearerToken(req.header("Authorization") ?? undefined);
      const parsedBody = parseChatCompletionRequestBody(req.body);
      const candidates = await dependencies.connectorService.routeCandidates(connectorKey, 1, parsedBody.model);

      const failures: ProviderFailureDetail[] = [];
      for (const candidate of candidates) {
        try {
          const upstreamResponse = await executeChatCompletionForCandidate(
            candidate,
            parsedBody.model,
            parsedBody.requestPayload,
            parsedBody.messages,
            dependencies.providerInferenceBaseUrls,
            dependencies.codexChatgptBaseUrl,
          );
          try {
            dependencies.connectorService.consumeRoutedUsage(candidate.id, 1);
          } catch (error) {
            const message = errorMessage(error, "unknown usage-consume failure");
            process.stderr.write(`Post-response usage accounting failed for account ${candidate.id}: ${message}\n`);
          }
          res.json(upstreamResponse);
          return;
        } catch (error) {
          const status = error instanceof HttpError ? error.status : null;
          const message = errorMessage(error, "Upstream request failed unexpectedly.");

          failures.push({
            provider: candidate.provider,
            status,
            message,
          });
        }
      }

      sendOpenAiError(
        res,
        503,
        "no_providers_available",
        "No connected provider could serve this request.",
        {
          provider_failures: failures,
        },
      );
    } catch (error) {
      if (error instanceof HttpError) {
        sendOpenAiError(res, error.status, error.code, error.message);
        return;
      }

      sendOpenAiError(res, 500, "internal_error", "Unexpected server error.");
    }
  });

  return router;
}
