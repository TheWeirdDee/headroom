// Request pacing for free-tier providers and the rate-limit retry (provider's retry delay honoured).
import { describe, expect, it, afterEach } from 'vitest';
import { acquire, configurePacer, pacerWaiting } from '../../src/runtime/pacer.ts';
import { retryAfterMs, withRetry, isRateLimit } from '../../src/runtime/loop.ts';

afterEach(() => configurePacer(0));

describe('pacer', () => {
  it('lets at most rpm requests start in any 60 s window, in order', async () => {
    let t = 0;
    const slept: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      slept.push(ms);
      t += ms;
    };
    configurePacer(3);
    const starts: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        acquire(() => t, sleep).then(() => {
          starts[i] = t;
        }),
      ),
    );
    expect(starts.slice(0, 3)).toEqual([0, 0, 0]);
    expect(starts[3]).toBeGreaterThanOrEqual(60_000);
    expect(starts[4]).toBeGreaterThanOrEqual(60_000);
    expect(pacerWaiting()).toBe(0);
  });

  it('does nothing when off', async () => {
    configurePacer(0);
    await acquire(
      () => 0,
      async () => {
        throw new Error('must not sleep');
      },
    );
  });
});

describe('rate-limit retry', () => {
  it('reads the provider retry delay', () => {
    expect(retryAfterMs(new Error('{"retryDelay":"40s"}'))).toBe(40_250);
    expect(retryAfterMs(new Error('Please retry in 12.5s.'))).toBe(12_750);
    expect(retryAfterMs(new Error('quota'))).toBeUndefined();
    expect(retryAfterMs(new Error('retry in 500s'))).toBe(90_000);
  });

  it('waits out 429s without spending normal retries, then fails if the quota stays exhausted', async () => {
    const waits: number[] = [];
    let calls = 0;
    const err = Object.assign(new Error('RESOURCE_EXHAUSTED retry in 2s'), { status: 429 });
    expect(isRateLimit(err)).toBe(true);
    const ok = await withRetry(
      async () => {
        calls += 1;
        if (calls <= 3) throw err;
        return 'done';
      },
      {
        timeoutMs: 1000,
        retries: 0,
        backoffMs: [1],
        rateLimitRetries: 5,
        sleep: async (ms) => void waits.push(ms),
      },
    );
    expect(ok).toBe('done');
    expect(waits).toEqual([2250, 2250, 2250]);
    await expect(
      withRetry(
        async () => {
          throw err;
        },
        { timeoutMs: 1000, retries: 0, backoffMs: [1], rateLimitRetries: 2, sleep: async () => {} },
      ),
    ).rejects.toThrow('RESOURCE_EXHAUSTED');
  });
});
