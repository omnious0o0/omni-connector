import { resilientFetch } from "../http-resilience";

const GEMINI_CODE_ASSIST_BASE_URL = "https://cloudcode-pa.googleapis.com";
const GEMINI_CODE_ASSIST_API_VERSION = "v1internal";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeErrorForLog(error: unknown): string {
  const rawMessage =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "unknown error";

  const normalized = rawMessage.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized
    .replace(/([?&](?:key|api_key|apikey|token|access_token|refresh_token)=)([^&\s]+)/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .slice(0, 220);
}

function deepFindFirstString(payload: unknown, keys: Set<string>): string | null {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = deepFindFirstString(entry, keys);
      if (found) {
        return found;
      }
    }

    return null;
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.trim().toLowerCase();
    if (keys.has(normalizedKey)) {
      const textValue = asString(value);
      if (textValue) {
        return textValue;
      }
    }

    if (typeof value === "object" && value !== null) {
      const nested = deepFindFirstString(value, keys);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function resolveGoogleCloudProjectId(): string | null {
  return asString(process.env.GOOGLE_CLOUD_PROJECT_ID) ?? asString(process.env.GOOGLE_CLOUD_PROJECT) ?? null;
}

interface GeminiCodeAssistProjectOptions {
  preferredProjectId?: string | null;
}

function pickGeminiCompanionProjectId(value: unknown): string | null {
  const direct = asString(value);
  if (direct) {
    return direct;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return asString(record.id) ?? asString(record.projectId) ?? asString(record.project_id) ?? null;
}

export function extractGeminiCliProjectId(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const directProjectId =
    asString(record.projectId) ??
    asString(record.project_id) ??
    pickGeminiCompanionProjectId(record.cloudaicompanionProject) ??
    pickGeminiCompanionProjectId(record.cloudaicompanion_project);
  if (directProjectId) {
    return directProjectId;
  }

  const responseRecord = asRecord(record.response);
  const responseProjectId =
    asString(responseRecord?.projectId) ??
    asString(responseRecord?.project_id) ??
    pickGeminiCompanionProjectId(responseRecord?.cloudaicompanionProject) ??
    pickGeminiCompanionProjectId(responseRecord?.cloudaicompanion_project);
  if (responseProjectId) {
    return responseProjectId;
  }

  return deepFindFirstString(record, new Set(["projectid", "project_id", "cloudaicompanionproject", "cloudaicompanion_project"]));
}

export async function fetchGeminiCliProjectId(
  accessToken: string,
  options: GeminiCodeAssistProjectOptions = {},
): Promise<string | null> {
  const baseUrl = asString(process.env.CODE_ASSIST_ENDPOINT) ?? GEMINI_CODE_ASSIST_BASE_URL;
  const apiVersion = asString(process.env.CODE_ASSIST_API_VERSION) ?? GEMINI_CODE_ASSIST_API_VERSION;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedVersion = apiVersion.replace(/^\/+|\/+$/g, "");
  const endpoint = `${normalizedBase}/${normalizedVersion}:loadCodeAssist`;
  const preferredProjectId = asString(options.preferredProjectId ?? null) ?? null;
  const configuredProjectId = preferredProjectId ?? resolveGoogleCloudProjectId();
  const metadata: Record<string, string> = {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  };
  if (configuredProjectId) {
    metadata.duetProject = configuredProjectId;
  }

  const requestBody: Record<string, unknown> = {
    metadata,
  };
  if (configuredProjectId) {
    requestBody.cloudaicompanionProject = configuredProjectId;
  }

  let response: Response;
  try {
    response = await resilientFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "omni-connector/1.0",
        },
        body: JSON.stringify(requestBody),
      },
      {
        timeoutMs: 12_000,
        maxAttempts: 2,
        baseDelayMs: 300,
        maxDelayMs: 1_200,
      },
    );
  } catch (error) {
    const message = sanitizeErrorForLog(error);
    process.stderr.write(
      `Gemini Code Assist project discovery failed; using configured project fallback: ${message}\n`,
    );
    return configuredProjectId;
  }

  if (!response.ok) {
    process.stderr.write(
      `Gemini Code Assist project discovery returned status ${response.status}; using configured project fallback.\n`,
    );
    return configuredProjectId;
  }

  const parsed = (await response.json().catch(() => null)) as unknown;
  return extractGeminiCliProjectId(parsed) ?? configuredProjectId;
}
