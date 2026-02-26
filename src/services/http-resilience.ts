const DEFAULT_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ResilientFetchOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryableStatusCodes?: Set<number>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  shouldRetryError?: (error: unknown) => boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) {
    return null;
  }

  const trimmed = retryAfterHeader.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }

    return null;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  const delayMs = parsedDate - Date.now();
  return delayMs > 0 ? delayMs : null;
}

function combineSignalWithTimeout(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }

  if (signal.aborted) {
    return signal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  return timeoutSignal;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  const asRecord = error as { code?: unknown };
  if (typeof asRecord.code === "string" && asRecord.code === "ABORT_ERR") {
    return true;
  }

  return /aborted/i.test(error.message);
}

function defaultShouldRetryError(error: unknown): boolean {
  if (isAbortError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("eai_again")
  );
}

function computeBackoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterRatio: number, random: () => number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(attempt - 1, 0));
  const jitterFactor = 1 + Math.max(0, jitterRatio) * Math.max(0, random());
  return Math.max(0, Math.round(exponential * jitterFactor));
}

export async function resilientFetch(
  input: string,
  init: RequestInit,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 12_000));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 400));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs ?? 12_000));
  const jitterRatio = options.jitterRatio ?? 0.2;
  const retryableStatusCodes = options.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const shouldRetryError = options.shouldRetryError ?? defaultShouldRetryError;

  const originalSignal = init.signal;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: timeoutMs > 0 ? combineSignalWithTimeout(originalSignal, timeoutMs) : originalSignal,
      });

      if (response.ok || !retryableStatusCodes.has(response.status) || attempt >= maxAttempts) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const backoffMs =
        retryAfterMs !== null
          ? Math.min(maxDelayMs, retryAfterMs)
          : computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio, random);
      if (backoffMs > 0) {
        await sleep(backoffMs);
      }
      continue;
    } catch (error) {
      lastError = error;
      if (originalSignal?.aborted) {
        throw error;
      }

      if (!shouldRetryError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const backoffMs = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio, random);
      if (backoffMs > 0) {
        await sleep(backoffMs);
      }
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }

  throw new Error("Request failed after retries.");
}
