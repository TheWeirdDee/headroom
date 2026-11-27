// How much of a run's model traffic really overlapped. A request counts only while it is outstanding:
// from the moment it is sent (after any wait for the provider's rate limit) until it is answered. Loops
// that are open but queued do not count.

export interface RequestInterval {
  agentId: string;
  loopInputKey: string;
  start: number;
  end: number;
}

export interface Overlap {
  requests: number;
  /** Most requests outstanding at one instant. */
  peakRequests: number;
  /** Most different agents with a request outstanding at one instant, and which they were. */
  peakAgents: number;
  agentsAtPeak: string[];
  /** Time during which two or more different agents were waiting on a model at once. */
  multiAgentMs: number;
  /** Time during which at least one request was outstanding, and the sum of all request times. */
  busyMs: number;
  summedMs: number;
  byAgent: Array<{ agentId: string; requests: number; firstStart: number; lastEnd: number }>;
}

export function measureOverlap(intervals: RequestInterval[]): Overlap {
  // At the same instant a request that ends is closed before one that starts: touching is not overlapping.
  const edges = intervals
    .flatMap((i) => [
      { t: i.start, d: 1, agent: i.agentId },
      { t: i.end, d: -1, agent: i.agentId },
    ])
    .sort((a, b) => a.t - b.t || a.d - b.d);
  const open = new Map<string, number>();
  let requests = 0;
  const out: Overlap = {
    requests: intervals.length,
    peakRequests: 0,
    peakAgents: 0,
    agentsAtPeak: [],
    multiAgentMs: 0,
    busyMs: 0,
    summedMs: intervals.reduce((s, i) => s + (i.end - i.start), 0),
    byAgent: [],
  };
  let last = edges[0]?.t ?? 0;
  for (const e of edges) {
    if (requests > 0) out.busyMs += e.t - last;
    if (open.size > 1) out.multiAgentMs += e.t - last;
    last = e.t;
    requests += e.d;
    const n = (open.get(e.agent) ?? 0) + e.d;
    if (n > 0) open.set(e.agent, n);
    else open.delete(e.agent);
    out.peakRequests = Math.max(out.peakRequests, requests);
    if (open.size > out.peakAgents) {
      out.peakAgents = open.size;
      out.agentsAtPeak = [...open.keys()].sort();
    }
  }
  for (const agentId of [...new Set(intervals.map((i) => i.agentId))]) {
    const mine = intervals.filter((i) => i.agentId === agentId);
    out.byAgent.push({
      agentId,
      requests: mine.length,
      firstStart: Math.min(...mine.map((i) => i.start)),
      lastEnd: Math.max(...mine.map((i) => i.end)),
    });
  }
  out.byAgent.sort((a, b) => a.firstStart - b.firstStart || a.agentId.localeCompare(b.agentId));
  return out;
}

/** What `npm run prove` requires; the list of reasons it fails, empty when it passes. */
export function proofFailures(o: Overlap, failedLoops: number): string[] {
  const out: string[] = [];
  if (o.requests === 0) out.push('no model request was made');
  if (o.peakAgents < 3)
    out.push(`at most ${o.peakAgents} agent(s) had a model request outstanding at once (3 required)`);
  if (o.peakRequests < 4)
    out.push(`at most ${o.peakRequests} request(s) were outstanding at once (4 required)`);
  if (failedLoops > 0) out.push(`${failedLoops} agent loop(s) failed`);
  return out;
}
