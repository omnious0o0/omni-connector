function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function extractCodexRateLimitPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const root = asRecord(payload.result);
  const rateLimits = asRecord(
    root?.rateLimits ?? root?.rate_limits ?? payload.rateLimits ?? payload.rate_limits,
  );
  if (!rateLimits) {
    return null;
  }

  return {
    result: {
      rateLimits,
    },
  };
}
