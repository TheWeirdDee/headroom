// Quiescence detector (PRD 14.4). A run is complete when, continuously for `quietMs`: no loop runs, no
// mailbox has queued or running work, no figure is `proposed`, and no outbound HTTP request is pending.
// Open needs_user questions do not block completion.

export interface ActivityProbe {
  runningLoops: number;
  queuedEvents: number;
  busyMailboxes: number;
  proposedFigures: number;
  pendingHttp: number;
}

export interface QuiescenceOptions {
  probe: () => ActivityProbe;
  quietMs?: number;
  intervalMs?: number;
  now?: () => number;
}

export function isQuiet(a: ActivityProbe): boolean {
  return (
    a.runningLoops === 0 &&
    a.queuedEvents === 0 &&
    a.busyMailboxes === 0 &&
    a.proposedFigures === 0 &&
    a.pendingHttp === 0
  );
}

/** Resolves 'quiet' after `quietMs` of continuous quiet, or 'timeout' after `timeoutMs`. */
export function waitForQuiescence(opts: QuiescenceOptions, timeoutMs: number): Promise<'quiet' | 'timeout'> {
  const quietMs = opts.quietMs ?? 1500;
  const intervalMs = opts.intervalMs ?? 100;
  const now = opts.now ?? ((): number => Date.now());
  const start = now();
  let quietSince: number | undefined;
  return new Promise((resolve) => {
    const check = (): void => {
      const t = now();
      if (isQuiet(opts.probe())) {
        quietSince ??= t;
        if (t - quietSince >= quietMs) return resolve('quiet');
      } else {
        quietSince = undefined;
      }
      if (t - start >= timeoutMs) return resolve('timeout');
      setTimeout(check, intervalMs);
    };
    setTimeout(check, intervalMs);
  });
}
