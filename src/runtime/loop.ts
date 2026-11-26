// Timeout and retry policy for model and HTTP calls (workaround for Mozaik gap #14: no abort signal,
// retry policy or timeouts). At most 2 retries, only for transient errors, backoff 1 s then 4 s.
import { TransientError } from './types.ts';

export interface RetryPolicy {
  timeoutMs: number;
  retries: number;
  backoffMs: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
  /** Runs before each attempt, outside its timeout (the request pacer's queue). */
  before?: () => Promise<void>;
  /** Extra attempts for HTTP 429 (rate limits) and 503 overload, each waiting the provider's retry delay. */
  rateLimitRetries?: number;
}

export const DEFAULT_RETRY: Omit<RetryPolicy, 'timeoutMs'> = { retries: 2, backoffMs: [1000, 4000] };

export class TimeoutError extends TransientError {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** HTTP 429 and 5xx, timeouts and connection resets are transient; everything else is not. */
export function isTransient(error: unknown): boolean {
  if (error instanceof TransientError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === 'string' &&
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)
  );
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function isRateLimit(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown; code?: unknown }).status ?? (error as { code?: unknown }).code;
  return (
    status === 429 || /RESOURCE_EXHAUSTED|\b429\b/.test(String((error as { message?: unknown }).message))
  );
}

/** HTTP 503 "model overloaded / high demand": the provider is busy, not broken; worth waiting out. */
export function isOverloaded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown; code?: unknown }).status ?? (error as { code?: unknown }).code;
  const message = String((error as { message?: unknown }).message);
  return status === 503 || /"code"\s*:\s*503|high demand|overloaded/i.test(message);
}

/** A per-day quota is used up (Gemini free tier): retrying within this run cannot succeed. */
export function isDailyQuota(error: unknown): boolean {
  return isRateLimit(error) && /PerDay|per day/i.test(String((error as { message?: unknown }).message));
}

export class DailyQuotaError extends Error {
  constructor(cause: unknown) {
    super(
      `The model provider's daily request quota is used up; try again tomorrow or choose another model (HEADROOM_MODEL_READER / HEADROOM_MODEL_VERIFIER). ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'DailyQuotaError';
  }
}

/** The provider's suggested wait ("retryDelay": "40s", "retry in 12.5s"), capped at 90 s. */
export function retryAfterMs(error: unknown): number | undefined {
  const text =
    error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  const m =
    /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(text ?? '') ??
    /retry in (\d+(?:\.\d+)?)\s*s/i.exec(text ?? '');
  if (!m?.[1]) return undefined;
  const [whole = '0', frac = ''] = m[1].split('.');
  const ms = Number.parseInt(whole, 10) * 1000 + Number.parseInt((frac + '000').slice(0, 3), 10);
  return Math.min(90_000, ms + 250);
}

export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  let limited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      await policy.before?.();
      return await withTimeout(fn(), policy.timeoutMs);
    } catch (error) {
      if (isDailyQuota(error)) throw new DailyQuotaError(error);
      if ((isRateLimit(error) || isOverloaded(error)) && limited < (policy.rateLimitRetries ?? 0)) {
        // A rate limit or a busy model is not a failed attempt: wait as long as the provider asks (or
        // 30 s, then 20 s for overload), then try again.
        limited += 1;
        attempt -= 1;
        policy.onRetry?.(limited, error);
        await sleep(retryAfterMs(error) ?? (isRateLimit(error) ? 30_000 : 20_000));
        continue;
      }
      if (attempt >= policy.retries || !isTransient(error)) throw error;
      policy.onRetry?.(attempt + 1, error);
      await sleep(policy.backoffMs[attempt] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 1000);
    }
  }
}
