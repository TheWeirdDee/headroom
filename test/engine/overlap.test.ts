// The measurement behind `npm run prove`: it must pass real overlap and fail serial or queued work.
import { describe, expect, it } from 'vitest';
import { measureOverlap, proofFailures, type RequestInterval } from '../../src/engine/overlap.ts';

const req = (agentId: string, start: number, end: number): RequestInterval => ({
  agentId,
  loopInputKey: `${agentId}:${start}`,
  start,
  end,
});

describe('overlap of model requests', () => {
  it('fails requests that run one after another, even when they touch', () => {
    const o = measureOverlap([req('a', 0, 10), req('b', 10, 20), req('c', 20, 30), req('a', 30, 40)]);
    expect(o).toMatchObject({ peakRequests: 1, peakAgents: 1, multiAgentMs: 0, busyMs: 40, summedMs: 40 });
    expect(proofFailures(o, 0)).toHaveLength(2);
  });

  it('fails one agent running many requests at once: that is not several agents', () => {
    const o = measureOverlap([0, 1, 2, 3, 4].map((i) => req('a', i, i + 10)));
    expect(o).toMatchObject({ peakRequests: 5, peakAgents: 1, multiAgentMs: 0 });
    expect(proofFailures(o, 0)).toEqual([expect.stringMatching(/at most 1 agent/)]);
  });

  it('measures agents waiting together', () => {
    const o = measureOverlap([req('a', 0, 10), req('a', 1, 11), req('b', 2, 6), req('c', 3, 5)]);
    expect(o).toMatchObject({
      peakRequests: 4,
      peakAgents: 3,
      agentsAtPeak: ['a', 'b', 'c'],
      multiAgentMs: 4, // from 2 to 6
      busyMs: 11,
    });
    expect(proofFailures(o, 0)).toEqual([]);
    expect(proofFailures(o, 1)).toEqual([expect.stringMatching(/failed/)]);
  });
});
