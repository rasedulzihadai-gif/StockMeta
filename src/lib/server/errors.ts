export type ProviderErrorCode =
  | "config"
  | "auth"
  | "billing"
  | "rate_limit"
  | "server"
  | "not_found"
  | "bad_request"
  | "network"
  | "timeout"
  | "empty"
  | "invalid_output";

export class ProviderError extends Error {
  code: ProviderErrorCode;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: { status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  return new ProviderError("server", e instanceof Error ? e.message : String(e));
}

/** Errors that will fail every item in a batch — the client stops the queue on these. */
export const FATAL_CODES: ProviderErrorCode[] = ["config", "auth", "billing", "not_found"];
