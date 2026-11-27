// The run view is a projection of events: replaying a recorded event stream from an empty
// snapshot must reach the server's final snapshot, and duplicate or stale deliveries change nothing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyView, reduce, laneCounts, totalRejections, type RunView } from '../src/state/reducer.ts';
import { formatPercent, formatSr, normaliseAmount, valueText } from '../src/format/money.ts';
import type { HrEvent, Snapshot } from '../src/api/types.ts';

const events = readFileSync('test/fixtures/web/events.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { id: number; event: HrEvent });
const final = JSON.parse(readFileSync('test/fixtures/web/snapshot.json', 'utf8')) as Snapshot;

function blank(s: Snapshot): Snapshot {
  return {
    ...s,
    figures: [],
    questions: [],
    discrepancies: [],
    loops: [],
    agents: {},
    card: null,
    summary: null,
    rejections: {},
    lastEventId: 0,
    status: 'running',
  };
}

function replay(start: RunView, evs = events): RunView {
  return evs.reduce((v, e) => reduce(v, { type: 'event', id: e.id, event: e.event }), start);
}

const fromStart = replay(reduce(emptyView(final.runId), { type: 'snapshot', snapshot: blank(final) }));

describe('reducer', () => {
  it('reaches the final snapshot from the event stream', () => {
    expect(Object.keys(fromStart.figures).sort()).toEqual(final.figures.map((f) => f.id).sort());
    for (const f of final.figures) {
      const g = fromStart.figures[f.id];
      expect(g?.status, f.key).toBe(f.status);
      expect(g?.value).toEqual(f.value);
    }
    expect(Object.keys(fromStart.discrepancies).sort()).toEqual(final.discrepancies.map((d) => d.id).sort());
    expect(Object.keys(fromStart.questions).sort()).toEqual(final.questions.map((q) => q.id).sort());
    expect(fromStart.card).toEqual(final.card);
    expect(fromStart.status).toBe(final.status);
    expect(fromStart.summary?.figures).toEqual(final.summary?.figures);
    for (const l of final.loops) expect(fromStart.loops[l.loopId]?.status).toBe(l.status);
  });

  it('ignores duplicate and already-applied events', () => {
    expect(replay(fromStart)).toEqual({ ...fromStart });
    const fromSnap = reduce(emptyView(final.runId), { type: 'snapshot', snapshot: final });
    const again = replay(fromSnap);
    expect(again.figures).toEqual(fromSnap.figures);
    expect(again.lastEventId).toBe(fromSnap.lastEventId);
  });

  it('counts per lane and rejections from the projection only', () => {
    const total = [
      'invoice-reader',
      'statement-reader',
      'kpo-reader',
      'rate-clerk',
      'limit-keeper',
      'independence-checker',
      'verifier',
      'human',
    ]
      .map((a) => laneCounts(fromStart, a).proposed)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(final.figures.length);
    expect(totalRejections(fromStart)).toBe(Object.values(final.rejections).reduce((a, b) => a + b, 0));
  });
});

describe('display formatting (strings only, no floating point)', () => {
  it('formats sr-Latn amounts and percentages', () => {
    expect(formatSr('5412300')).toBe('5.412.300,00');
    expect(formatSr('-30.66')).toBe('-30,66');
    expect(formatSr('0.5')).toBe('0,50');
    expect(formatPercent('0.96650')).toBe('96,7%');
    expect(formatPercent('0')).toBe('0,0%');
    expect(formatPercent('1')).toBe('100,0%');
    expect(valueText({ t: 'ratio', value: '0.0004' })).toBe('0,0%');
  });

  it('normalises typed amounts or refuses them', () => {
    expect(normaliseAmount('1.250.000,00')).toBe('1250000.00');
    expect(normaliseAmount('1,250,000.5')).toBe('1250000.5');
    expect(normaliseAmount('8550')).toBe('8550');
    expect(normaliseAmount('12,5')).toBe('12.5');
    expect(normaliseAmount('0')).toBeUndefined();
    expect(normaliseAmount('1.2.3')).toBeUndefined();
    expect(normaliseAmount('1e6')).toBeUndefined();
    expect(normaliseAmount('-5')).toBeUndefined();
  });
});
