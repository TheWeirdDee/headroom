// Full run on the real Mozaik adapter with the deterministic fake model: seven agents, one board.
import { describe, expect, it, beforeAll } from 'vitest';
import { loadInputSet } from '../../src/engine/load-inputs.ts';
import { startRun, type RunSummary, type Run } from '../../src/engine/run-engine.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import { fixtureKurs, smallProfile, writeTempProfile } from '../helpers/profiles.ts';
import { validatePayload } from '../../src/events/schemas.ts';
import { cmp } from '../../src/domain/money.ts';

const NOW = Date.parse('2026-11-26T09:00:00Z');

let run: Run;
let summary: RunSummary;

beforeAll(async () => {
  const dir = await writeTempProfile(smallProfile());
  const { inputs, year, asOf } = await loadInputSet(dir);
  const rules = loadRules();
  const started = Date.now();
  const clock = (): number => NOW + (Date.now() - started);
  run = startRun({
    runId: 'run-t01',
    inputs,
    rules,
    config: defaultRunConfig(year, asOf),
    mode: 'live',
    kurs: fixtureKurs(clock),
    backend: fakeModel({ delayMs: 15 }),
    now: clock,
    quietMs: 400,
    runTimeoutMs: 30_000,
  });
  summary = await run.done;
}, 60_000);

const v = (key: string): unknown => {
  const f = run.rt.state.verified(key);
  return f?.value;
};

describe('end-to-end run (t01, fake model)', () => {
  it('waits for debounced recomputations before it calls the run quiet', () => {
    expect(run.rt.state.debouncing.size).toBe(0);
    expect(summary.headroom).not.toBeNull();
  });

  it('completes without participant errors, failed loops or false rejections', () => {
    expect(summary.rejections).toEqual({
      UNSOURCED: 0,
      SOURCE_MISMATCH: 0,
      DERIVATION_MISMATCH: 0,
      NOT_SUPPORTED_BY_SOURCE: 0,
      IMPLAUSIBLE: 0,
    });
    expect(summary.participantErrors).toBe(0);
    expect(summary.failedLoops).toBe(0);
    expect(['completed', 'awaiting_user']).toContain(summary.status);
    expect(summary.figures.proposed).toBe(0);
  });

  it('verifies every invoice fact read from the documents', () => {
    expect(v('invoice:2026-001:issueDate')).toEqual({ t: 'date', iso: '2026-03-02' });
    expect(v('invoice:2026-002:amount')).toEqual({ t: 'money', amount: '4000', currency: 'EUR' });
    expect(v('invoice:2026-002:clientCountry')).toEqual({ t: 'text', text: 'DE' });
    expect(v('invoice:2026-003:kind')).toEqual({ t: 'text', text: 'product' });
  });

  it('converts the EUR invoice at the NBS middle rate of its issue date', () => {
    expect(v('fx:EUR:2026-11-20')).toMatchObject({ rate: '117.6412', rateDate: '2026-11-20' });
    // The KPO book's value (read by code as 470564.8) and RateClerk's 470564.80 are equal: corroborated.
    expect(v('invoice:2026-002:amountRSD')).toMatchObject({ t: 'money', currency: 'RSD' });
    expect(cmp((v('invoice:2026-002:amountRSD') as { amount: string }).amount, '470564.80')).toBe(0);
    expect(v('invoice:2026-001:amountRSD')).toEqual({ t: 'money', amount: '1200000', currency: 'RSD' });
  });

  it('settles the KPO date conflict against the invoice and raises E2, E3 and E1', () => {
    expect(v('invoice:2026-001:issueDate')).toEqual({ t: 'date', iso: '2026-03-02' });
    const types = [...run.rt.state.discrepancies.values()]
      .filter((d) => d.status === 'verified')
      .map((d) => `${d.type}:${d.subjectKey}`)
      .sort();
    expect(types).toEqual(['E1:payment:S1-3', 'E2:invoice:2026-001', 'E3:invoice:2026-003']);
    expect(summary.conflicts.raised).toBeGreaterThanOrEqual(1);
  });

  it('computes the totals from verified figures, to the cent', () => {
    expect(v('total:limit6m:committed')).toEqual({ t: 'money', amount: '1970564.8', currency: 'RSD' });
    expect(v('draft:amountRSD')).toEqual({ t: 'money', amount: '588216.00', currency: 'RSD' });
    expect(v('total:limit6m:withDraft')).toEqual({ t: 'money', amount: '2558780.8', currency: 'RSD' });
    // 8M: domestic service and product count; services to the German business client do not.
    expect(v('total:vat8m:committed')).toEqual({ t: 'money', amount: '1500000', currency: 'RSD' });
    expect(v('total:vat8m:withDraft')).toEqual({ t: 'money', amount: '1500000', currency: 'RSD' });
  });

  it('evaluates the independence test per client and asks the questions it cannot answer', () => {
    expect(v('criterion:kestrel:1')).toEqual({ t: 'tri', value: 'met' });
    expect(v('criterion:kestrel:8')).toEqual({ t: 'tri', value: 'unknown' });
    // Coverage starts 2026-03 (first statement row): only the trailing window Dec-Nov is evaluated: 58%.
    expect(v('criterion:javor:6')).toEqual({ t: 'tri', value: 'not_met' });
    expect(
      [...run.rt.state.questions.values()].filter((q) => q.askedBy === 'independence-checker'),
    ).toHaveLength(4);
    expect(summary.status).toBe('awaiting_user');
  });

  it('builds the card from verified figures and shows real concurrency', () => {
    expect(summary.headroom?.limit6m.withDraft.display).toBe('2.558.780,80 RSD');
    expect(summary.headroom?.limit6m.band).toBe('green');
    expect(summary.unsourcedFigures).toBe(0);
    expect(summary.maxConcurrentLoops).toBeGreaterThanOrEqual(4);
    expect(summary.sumLoopTimeMs / summary.wallTimeMs).toBeGreaterThan(1);
  });

  it('every hr.* event matches the event catalogue', () => {
    for (const e of run.events.filter((x) => x.type.startsWith('hr.'))) {
      expect([e.type, validatePayload(e.type, e.payload)]).toEqual([e.type, { ok: true }]);
    }
  });
});
