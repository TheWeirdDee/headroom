// Own initiative: RateClerk raises E5 and LimitKeeper publishes crossing attribution without any
// other agent asking. Variant of t01: the book converts the EUR invoice at the payment-date rate, and a
// larger first invoice puts the corrected total in the red band, so the unexplained payment crosses 6M.
import { describe, expect, it, beforeAll } from 'vitest';
import { loadInputSet } from '../../src/engine/load-inputs.ts';
import { startRun, type RunSummary, type Run } from '../../src/engine/run-engine.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import { fixtureKurs, smallProfile, writeTempProfile } from '../helpers/profiles.ts';

const NOW = Date.parse('2026-11-26T09:00:00Z');
let run: Run;
let summary: RunSummary;

beforeAll(async () => {
  const spec = smallProfile();
  spec.profile.id = 't02';
  const first = spec.invoices[0];
  if (!first) throw new Error('fixture');
  first.amount = '4500000.00';
  const pay1 = spec.statement[0];
  const pay2 = spec.statement[4];
  if (!pay1 || !pay2) throw new Error('fixture');
  pay1.amount = '4500000.00';
  // Paid on 2026-11-26 at 117.6432; the book converts at that payment-date rate: 4000 x 117.6432 = 470572.80.
  pay2.date = '2026-11-26';
  pay2.valueDate = '2026-11-26';
  pay2.amount = '470572.80';
  spec.kpo = [
    {
      date: '2026-03-02',
      description: 'Faktura 2026-001 Javor Softver',
      products: '0.00',
      services: '4500000.00',
      total: '4500000.00',
    },
    {
      date: '2026-11-20',
      description: 'Faktura 2026-002 Kestrel Analytics',
      products: '0.00',
      services: '470572.80',
      total: '470572.80',
    },
    {
      date: '2026-06-15',
      description: 'Faktura 2026-003 Javor Softver',
      products: '300000.00',
      services: '0.00',
      total: '300000.00',
    },
  ];
  const dir = await writeTempProfile(spec);
  const { inputs, year, asOf } = await loadInputSet(dir);
  const started = Date.now();
  const clock = (): number => NOW + (Date.now() - started);
  run = startRun({
    runId: 'run-t02',
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf),
    mode: 'live',
    kurs: fixtureKurs(clock),
    backend: fakeModel({ delayMs: 10 }),
    now: clock,
    quietMs: 400,
    runTimeoutMs: 30_000,
  });
  summary = await run.done;
}, 60_000);

describe('agent initiative', () => {
  it('RateClerk raises E5: the book used the payment-date NBS rate', () => {
    const e5 = [...run.rt.state.discrepancies.values()].find((d) => d.type === 'E5');
    expect(e5?.status).toBe('verified');
    expect(e5?.producedBy).toBe('rate-clerk');
    expect(e5?.detail).toContain('implied rate of 117.6432');
    expect(e5?.detail).toContain('the NBS rate of the payment date 2026-11-26');
    expect(e5?.deltaRSD).toBe('-8');
    expect(run.rt.state.verified('invoice:2026-002:amountRSD')?.value).toEqual({
      t: 'money',
      amount: '470564.80',
      currency: 'RSD',
    });
  });

  it('LimitKeeper attributes the crossing to the payment with no invoice', () => {
    const crossing = run.events.find((e) => e.type === 'hr.headroom.crossing');
    expect(crossing?.producerId).toBe('limit-keeper');
    expect(crossing?.payload).toMatchObject({
      bandBefore: 'red',
      bandAfter: 'crossed',
      discrepancyType: 'E1',
      baseline: 'corrected',
      deltaRSD: '250000',
    });
    expect(summary.headroom?.limit6m.band).toBe('red');
  });

  it('no false rejections and no errors', () => {
    expect(summary.participantErrors).toBe(0);
    expect(Object.values(summary.rejections).reduce((a, b) => a + b, 0)).toBe(0);
    expect(summary.figures.proposed).toBe(0);
  });
});
