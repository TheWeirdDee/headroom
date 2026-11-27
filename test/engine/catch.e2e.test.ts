// The Verifier catches a wrong number: the recorded sample replayed with one injected misread.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunManager } from '../../src/server/run-manager.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { replaySource } from '../../src/engine/recordings.ts';
import { loadEnv } from '../../src/config/env.ts';
import { MISREAD_AMOUNT as fault } from '../../src/engine/faults.ts';

const truth = JSON.parse(readFileSync('data/profiles/p07/_truth/truth.json', 'utf8')) as {
  totals: { limit6m: { withDraft: string } };
};

const manager = (): RunManager =>
  new RunManager({
    env: loadEnv('.', ['--offline']),
    rules: loadRules(),
    profilesDir: 'data/profiles',
    liveFetcher: async () => ({ status: 503, body: '' }),
    replay: replaySource('runs', { instant: true, ratesFile: 'data/rates/kurs.json' }),
  });

describe('injected misread', () => {
  it('is rejected by the Verifier, read again, and never counted', async () => {
    const m = manager();
    const id = await m.start({ profileId: 'p07', mode: 'replay', fault: fault.id });
    const r = m.get(id);
    const summary = await r.run.done;
    const versions = r.run.rt.state.board
      .versions(`invoice:${fault.invoice}:amount`)
      .map((v) => r.run.rt.state.figures.get(v.id));
    expect(versions.map((f) => [f?.value, f?.status])).toEqual([
      [{ t: 'money', amount: '5300', currency: 'EUR' }, 'contested'],
      [{ t: 'money', amount: '3500', currency: 'EUR' }, 'verified'],
    ]);
    expect(versions[0]?.checks?.find((c) => !c.passed)?.detail).toMatch(/does not show the amount 5300/);
    expect(summary.failedLoops).toBe(0);
    expect(summary.headroom?.completeness.complete).toBe(true);
    expect(summary.headroom?.limit6m.withDraft.amount).toBe(truth.totals.limit6m.withDraft);
    expect(m.snapshot(id)).toMatchObject({ fault: { id: 'misread-amount', note: fault.note } });
    await r.run.dispose();
  }, 60_000);

  it('is only ever added when asked for, and only to the recorded sample it belongs to', async () => {
    const m = manager();
    const plain = await m.start({ profileId: 'p07', mode: 'replay' });
    expect(m.snapshot(plain)).toMatchObject({ fault: null });
    await expect(m.start({ profileId: 'p01', mode: 'replay', fault: fault.id })).rejects.toThrow(
      /recorded sample p07/,
    );
    await m.get(plain).run.done;
  }, 60_000);
});
