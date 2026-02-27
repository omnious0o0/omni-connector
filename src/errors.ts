export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly context: Record<string, unknown> | null;

  public constructor(status: number, code: string, message: string, context: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.context = context;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
