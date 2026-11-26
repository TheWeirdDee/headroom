// Process-wide request pacing for the model provider. Free tiers (the Gemini free tier is the default
// provider) allow only a few requests per minute; seven agents running at once would otherwise burst into
// HTTP 429. The pacer queues requests so at most `rpm` start in any 60-second window. 0 turns it off.
// Recorded replays and the test model never pass through it.

let rpm = 0;
const stamps: number[] = [];
let chain: Promise<void> = Promise.resolve();
let waiting = 0;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function configurePacer(requestsPerMinute: number): void {
  rpm = Math.max(0, Math.floor(requestsPerMinute));
  stamps.length = 0;
  chain = Promise.resolve();
  waiting = 0;
}

export function pacerRpm(): number {
  return rpm;
}

/** Requests currently queued behind the pacer (shown as "waiting for the model quota"). */
export function pacerWaiting(): number {
  return waiting;
}

/** Resolves when this request may start. */
export function acquire(
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<void> {
  if (rpm === 0) return Promise.resolve();
  waiting += 1;
  const turn = chain.then(async () => {
    for (;;) {
      const t = now();
      while (stamps.length > 0 && t - (stamps[0] ?? 0) >= 60_000) stamps.shift();
      if (stamps.length < rpm) {
        stamps.push(t);
        return;
      }
      await sleep(60_000 - (t - (stamps[0] ?? t)) + 5);
    }
  });
  chain = turn.finally(() => {
    waiting -= 1;
  });
  return turn;
}
