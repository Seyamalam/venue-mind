import { AdapterContractError } from "./contracts.ts";

const DEFAULT_MAXIMUM_RETRY_AFTER_MS = 300_000;

type RetryAfterHeaders = Pick<Headers, "get"> | Readonly<Record<string, string | null | undefined>>;

interface ResponseLike {
  readonly status?: number;
  readonly name?: string;
  readonly headers?: RetryAfterHeaders;
}

export interface RetryAfterOptions {
  readonly now?: number;
  readonly maximumRetryAfterMs?: number;
}

const isResponseLike = (value: unknown): value is ResponseLike => typeof value === "object" && value !== null;

const readRetryAfter = (headers: RetryAfterHeaders | undefined): string | null => {
  if (!headers) return null;
  if ("get" in headers && typeof headers.get === "function") return headers.get("retry-after");
  if (!("get" in headers)) {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === "retry-after");
    return key ? (headers[key] ?? null) : null;
  }
  return null;
};

export function normalizeRetryAfter(
  value: unknown,
  { now = Date.now(), maximumRetryAfterMs = DEFAULT_MAXIMUM_RETRY_AFTER_MS }: RetryAfterOptions = {},
): number {
  if (!Number.isFinite(now)) throw new TypeError("Retry-After now must be a finite epoch millisecond value");
  if (!Number.isInteger(maximumRetryAfterMs) || maximumRetryAfterMs < 0 || maximumRetryAfterMs > 86_400_000) {
    throw new TypeError("maximumRetryAfterMs must be an integer from 0 to 86400000");
  }
  if (typeof value !== "string") return 0;
  const normalized = value.trim();
  let milliseconds;
  if (/^\d+$/.test(normalized)) milliseconds = Number(normalized) * 1_000;
  else {
    const target = Date.parse(normalized);
    if (!Number.isFinite(target)) return 0;
    milliseconds = Math.max(0, target - now);
  }
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return maximumRetryAfterMs;
  return Math.min(milliseconds, maximumRetryAfterMs);
}

export function adapterHttpError(responseOrCause: unknown, options: RetryAfterOptions = {}): AdapterContractError {
  if (responseOrCause instanceof AdapterContractError) return responseOrCause;
  const response = isResponseLike(responseOrCause) ? responseOrCause : null;
  const status = typeof response?.status === "number" && Number.isInteger(response.status) ? response.status : null;
  if (status === null || status === 0) {
    if (response?.name === "AbortError") {
      return new AdapterContractError("ADAPTER_REQUEST_ABORTED", "Adapter upstream request was aborted");
    }
    return new AdapterContractError(
      "ADAPTER_NETWORK_ERROR",
      "Adapter upstream request failed before receiving a response",
    );
  }
  if (status === 429) {
    const retryAfterMs = normalizeRetryAfter(readRetryAfter(response?.headers), options);
    return new AdapterContractError("ADAPTER_RATE_LIMITED", "Adapter upstream rate limit was reached", {
      status,
      retryAfterMs,
    });
  }
  if (status === 408)
    return new AdapterContractError("ADAPTER_NETWORK_ERROR", "Adapter upstream request timed out", { status });
  if (status >= 500 && status <= 599)
    return new AdapterContractError("ADAPTER_UPSTREAM_UNAVAILABLE", "Adapter upstream service is unavailable", {
      status,
    });
  if (status >= 400 && status <= 499)
    return new AdapterContractError("ADAPTER_SOURCE_INVALID", "Adapter upstream request was rejected", { status });
  return new AdapterContractError("ADAPTER_HANDLER_FAILED", "Adapter upstream response was not successful", { status });
}
