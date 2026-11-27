// Kurs API client (kurs.resenje.org, official NBS data; RESEARCH_NOTES V8). Timeout 8 s, two retries
// with backoff, a per-run cache, and a response store the Verifier uses to check integrity hashes.
// Live responses are recorded for replay; in replay mode only recorded responses are served.
import { sha256 } from '../../util/hash.ts';
import { DEFAULT_RETRY, withRetry } from '../../runtime/loop.ts';
import { TransientError } from '../../runtime/types.ts';
import { isRateRequestable, parseKursRate, type KursRate } from '../../domain/fx.ts';
import type { SourceRef } from '../../domain/types.ts';

export const KURS_BASE = 'https://kurs.resenje.org/api/v1/currencies';

export interface KursResponse {
  url: string;
  httpStatus: number;
  body: string;
  fetchedAt: string;
  sha256: string;
}

export type KursResult =
  | { ok: true; rate: KursRate; source: Extract<SourceRef, { type: 'url' }> }
  | { ok: false; reason: 'not_published_yet' | 'unavailable' | 'not_found'; detail: string };

export interface KursClient {
  rate(currency: string, date: string, today: string): Promise<KursResult>;
  response(sha: string): KursResponse | undefined;
  pending(): number;
  attempts(currency: string, date: string): number;
}

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;

export class ReplayMissError extends Error {
  constructor(readonly url: string) {
    super(`REPLAY_MISS: no recorded Kurs response for ${url}`);
    this.name = 'ReplayMissError';
  }
}

export interface KursClientOptions {
  fetcher: Fetcher;
  now: () => number;
  onResponse?: (r: KursResponse) => void;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export function kursUrl(currency: string, date: string): string {
  return `${KURS_BASE}/${currency.toLowerCase()}/rates/${date}`;
}

export function createKursClient(opts: KursClientOptions): KursClient {
  const cache = new Map<string, Promise<KursResult>>();
  const responses = new Map<string, KursResponse>();
  const tries = new Map<string, number>();
  let inFlight = 0;

  async function fetchOnce(currency: string, date: string): Promise<KursResult> {
    const url = kursUrl(currency, date);
    const key = `${currency}:${date}`;
    const res = await withRetry(
      async () => {
        tries.set(key, (tries.get(key) ?? 0) + 1);
        const r = await opts.fetcher(url);
        if (r.status === 429 || r.status >= 500) throw new TransientError(`Kurs HTTP ${r.status}`);
        return r;
      },
      { ...DEFAULT_RETRY, timeoutMs: opts.timeoutMs ?? 8000, ...(opts.sleep ? { sleep: opts.sleep } : {}) },
    );
    const record: KursResponse = {
      url,
      httpStatus: res.status,
      body: res.body,
      fetchedAt: new Date(opts.now()).toISOString(),
      sha256: sha256(res.body),
    };
    responses.set(record.sha256, record);
    opts.onResponse?.(record);
    if (res.status === 404)
      return { ok: false, reason: 'not_found', detail: `Kurs has no ${currency} rates` };
    if (res.status !== 200) return { ok: false, reason: 'unavailable', detail: `Kurs HTTP ${res.status}` };
    const rate = parseKursRate(res.body, currency);
    if (rate.requestedDate !== date) {
      return {
        ok: false,
        reason: 'unavailable',
        detail: `Kurs answered for ${rate.requestedDate}, not ${date}`,
      };
    }
    return {
      ok: true,
      rate,
      source: {
        type: 'url',
        url,
        fetchedAt: record.fetchedAt,
        httpStatus: res.status,
        responseSha256: record.sha256,
        jsonPath: '$.exchange_middle',
      },
    };
  }

  return {
    rate(currency, date, today) {
      if (!isRateRequestable(date, today)) {
        return Promise.resolve({
          ok: false,
          reason: 'not_published_yet',
          detail: `NBS has not published a rate for ${date} yet (today is ${today})`,
        });
      }
      const key = `${currency}:${date}`;
      let p = cache.get(key);
      if (!p) {
        inFlight += 1;
        p = fetchOnce(currency, date)
          .catch((e: unknown): KursResult => ({
            ok: false,
            reason: 'unavailable',
            detail: e instanceof Error ? e.message : String(e),
          }))
          .finally(() => {
            inFlight -= 1;
          });
        cache.set(key, p);
      }
      return p;
    },
    response: (sha) => responses.get(sha),
    pending: () => inFlight,
    attempts: (currency, date) => tries.get(`${currency}:${date}`) ?? 0,
  };
}

/** Live fetcher using Node's fetch (no credentials, public API). */
export const liveFetcher: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  return { status: r.status, body: await r.text() };
};

/** Replay fetcher: serves recorded bodies by URL; a miss fails loudly. */
export function replayFetcher(recorded: Map<string, { status: number; body: string }>): Fetcher {
  return async (url) => {
    const r = recorded.get(url);
    if (!r) throw new ReplayMissError(url);
    return r;
  };
}
