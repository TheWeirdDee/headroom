// The card never shows a verdict built from part of the files, and a failed agent loop never ends in a
// normal run status. Full runs on Mozaik with the deterministic test model, with failures injected.
import { describe, expect, it } from 'vitest';
import { loadInputSet } from '../../src/engine/load-inputs.ts';
import { startRun, type Run, type RunSummary } from '../../src/engine/run-engine.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import { fixtureKurs, smallProfile, writeTempProfile } from '../helpers/profiles.ts';
import type { CardVM } from '../../src/agents/limit-keeper/card.ts';
import type { HrInferenceRequest, ModelBackend } from '../../src/runtime/types.ts';

const NOW = Date.parse('2026-11-26T09:00:00Z');

async function start(
  fail: (r: HrInferenceRequest) => boolean = () => false,
  spec = smallProfile(),
): Promise<Run> {
  const { inputs, year, asOf } = await loadInputSet(await writeTempProfile(spec));
  const started = Date.now();
  const clock = (): number => NOW + (Date.now() - started);
  const model = fakeModel({ delayMs: 10 });
  const backend: ModelBackend = {
    async infer(r) {
      if (fail(r)) throw new Error('the model request failed');
      return model.infer(r);
    },
  };
  return startRun({
    runId: 'run-gaps',
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf),
    mode: 'live',
    kurs: fixtureKurs(clock),
    backend,
    now: clock,
    quietMs: 400,
    runTimeoutMs: 30_000,
  });
}

const cards = (run: Run): CardVM[] =>
  run.events.filter((e) => e.type === 'hr.headroom.updated').map((e) => e.payload as CardVM);

function expectNoVerdict(s: RunSummary): void {
  expect(s.headroom?.completeness.complete).toBe(false);
  expect(s.headroom?.limit6m.band).toBe('incomplete');
  expect(s.headroom?.vat8m.band).toBe('incomplete');
  expect(s.headroom?.independence.map((c) => c.status)).toEqual(['incomplete', 'incomplete']);
}

describe('incomplete cards and degraded runs', () => {
  it('shows a verdict only once every input is verified, and the same totals as at the end', async () => {
    const run = await start();
    const s = await run.done;
    expect(s.headroom?.completeness).toEqual({ complete: true, gaps: [] });
    expect(s.status).toBe('awaiting_user'); // the independence questions; they do not touch the totals
    const all = cards(run);
    expect(all[0]?.limit6m.band).toBe('incomplete');
    for (const c of all.filter((x) => x.limit6m.band !== 'incomplete')) {
      expect(c.completeness.complete).toBe(true);
      expect(c.limit6m.withDraft.amount).toBe(s.headroom?.limit6m.withDraft.amount);
    }
    await run.dispose();
  }, 40_000);

  it('flags a second payment of an invoiced amount: one invoice accounts for one payment', async () => {
    const spec = smallProfile();
    spec.statement.push({
      date: '2026-10-05',
      valueDate: '2026-10-05',
      description: 'Uplata za konsultacije',
      counterparty: 'Lipa Studio',
      reference: '',
      amount: '300000.00', // the amount of invoice 2026-003, already paid by the row that names it
      currency: 'RSD',
      direction: 'PRILIV',
      balance: '2519064.80',
    });
    const run = await start(undefined, spec);
    await run.done;
    const unmatched = [...run.rt.state.discrepancies.values()]
      .filter((d) => d.type === 'E1' && d.status === 'verified')
      .map((d) => d.subjectKey)
      .sort();
    expect(unmatched).toEqual(['payment:S1-3', 'payment:S1-6']);
    await run.dispose();
  }, 40_000);

  it.each([
    [
      'one invoice read',
      (r: HrInferenceRequest) => r.agentId === 'invoice-reader' && r.user.includes('2026-001'),
    ],
    ['every invoice read', (r: HrInferenceRequest) => r.agentId === 'invoice-reader'],
    ['the Verifier model', (r: HrInferenceRequest) => r.agentId === 'verifier'],
    ['the statement read', (r: HrInferenceRequest) => r.agentId === 'statement-reader'],
    ['one contract read', (r: HrInferenceRequest) => r.agentId === 'independence-checker'],
  ])(
    'is degraded and incomplete when %s fails',
    async (_name, fail) => {
      const run = await start(fail);
      const s = await run.done;
      expect(s.failedLoops).toBeGreaterThan(0);
      expect(s.status).toBe('degraded');
      expectNoVerdict(s);
      expect(s.headroom?.completeness.gaps.map((g) => g.kind)).toContain('failed');
      expect(cards(run).every((c) => c.limit6m.band === 'incomplete')).toBe(true);
      await run.dispose();
    },
    60_000,
  );

  it('is failed, with no verdict, when no model request succeeds', async () => {
    const run = await start(() => true);
    const s = await run.done;
    expect(s.status).toBe('failed');
    expectNoVerdict(s);
    await run.dispose();
  }, 40_000);

  it('says that an invoice only the KPO book states has no document behind it', async () => {
    const run = await start((r) => r.agentId === 'invoice-reader' && r.user.includes('2026-001'));
    const s = await run.done;
    expect(s.headroom?.completeness.gaps.map((g) => g.text)).toContain(
      'Only your KPO book states: 2026-001.',
    );
    await run.dispose();
  }, 40_000);

  it('converts a changed invoice again, also when it changes back, and asks for a rate it lacks', async () => {
    const run = await start();
    const first = await run.done;
    const draft = { ...(await loadInputSet(await writeTempProfile(smallProfile()))).inputs.draft };
    const settle = async (): Promise<RunSummary> => {
      for (let i = 0; i < 200; i++) {
        const latest = run.latest();
        if (latest && latest !== previous) return (previous = latest);
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('the run did not settle again');
    };
    let previous = first;
    run.human.changeDraft({ ...draft, amount: '100.00' });
    const small = await settle();
    expect(small.headroom?.completeness.complete).toBe(true);
    expect(small.headroom?.draft.amountRSD?.amount).not.toBe(first.headroom?.draft.amountRSD?.amount);
    run.human.changeDraft(draft);
    const back = await settle();
    expect(back.headroom?.draft.amountRSD?.amount).toBe(first.headroom?.draft.amountRSD?.amount);
    expect(back.headroom?.limit6m.withDraft.amount).toBe(first.headroom?.limit6m.withDraft.amount);

    // A date with no rate to be had: no stale conversion, no verdict, and a question.
    run.human.changeDraft({ ...draft, issueDate: '2026-04-02' });
    const asked = await settle();
    expect(asked.headroom?.limit6m.band).toBe('incomplete');
    expect(asked.headroom?.draft.amountRSD).toBeUndefined();
    const q = [...run.rt.state.questions.values()].find((x) => x.subjectKey === 'fx:EUR:2026-04-02');
    expect(q).toBeDefined();
    run.human.answer(q?.id ?? '', '117.2000');
    const answered = await settle();
    expect(answered.headroom?.completeness.complete).toBe(true);
    expect(answered.headroom?.draft.amountRSD?.amount).toBe('586000.00');
    await run.dispose();
  }, 60_000);
});
