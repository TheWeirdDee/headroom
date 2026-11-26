// Timeout and retry policy for model and HTTP calls (workaround for Mozaik gap #14: no abort signal,
// retry policy or timeouts). At most 2 retries, only for transient errors, backoff 1 s then 4 s.
import { TransientError } from './types.ts';

export interface RetryPolicy {
  timeoutMs: number;
  retries: number;
  backoffMs: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
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

export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  const sleep = policy.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(fn(), policy.timeoutMs);
    } catch (error) {
      if (attempt >= policy.retries || !isTransient(error)) throw error;
      policy.onRetry?.(attempt + 1, error);
      await sleep(policy.backoffMs[attempt] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 1000);
    }
  }
}
