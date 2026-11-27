// npm run demo:catch: replay the p07 sample with one injected misread and show the Verifier catching it.
// No key, no network. Exits 1 if the wrong figure is ever verified, or the totals end up wrong.
import { join } from 'node:path';
import { RunManager } from '../src/server/run-manager.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { loadEnv } from '../src/config/env.ts';
import { replaySource } from '../src/engine/recordings.ts';
import { MISREAD_AMOUNT as fault } from '../src/engine/faults.ts';
import { cmp } from '../src/domain/money.ts';
import type { Figure } from '../src/domain/types.ts';

const ROOT = join(import.meta.dirname, '..');

async function main(): Promise<void> {
  const runs = new RunManager({
    env: loadEnv(ROOT, ['--offline']),
    rules: loadRules(),
    profilesDir: join(ROOT, 'data', 'profiles'),
    liveFetcher: async () => ({ status: 503, body: '' }),
    replay: replaySource(join(ROOT, 'runs'), { ratesFile: join(ROOT, 'data', 'rates', 'kurs.json') }),
  });
  const runId = await runs.start({ profileId: fault.profileId, mode: 'replay', fault: fault.id });
  const record = runs.get(runId);
  const summary = await record.run.done;
  const key = `invoice:${fault.invoice}:amount`;
  const versions = record.run.rt.state.board
    .versions(key)
    .map((v) => record.run.rt.state.figures.get(v.id))
    .filter((f): f is Figure => f !== undefined);
  const amount = (f: Figure): string =>
    f.value.t === 'money' ? `${f.value.amount} ${f.value.currency}` : '';
  const out = (s = ''): void => void process.stdout.write(`${s}\n`);
  out(fault.note);
  out();
  for (const f of versions) {
    const why = f.checks?.find((c) => !c.passed)?.detail;
    out(`${f.producedBy} proposed ${amount(f)} -> ${f.status.toUpperCase()}${why ? `: ${why}` : ''}`);
  }
  // The same replay without the fault: the wrong reading must leave no trace in the total.
  const cleanId = await runs.start({ profileId: fault.profileId, mode: 'replay' });
  const clean = await runs.get(cleanId).run.done;
  await runs.get(cleanId).run.dispose();
  const total = summary.headroom?.limit6m.withDraft.amount ?? '';
  const expected = clean.headroom?.limit6m.withDraft.amount ?? '';
  out();
  out(`6M total with the draft: ${total} RSD (the same replay without the fault: ${expected} RSD)`);
  out(`Run status ${summary.status}, ${summary.failedLoops} failed loops`);
  await record.run.dispose();

  const wrong = versions.filter((f) => f.value.t === 'money' && cmp(f.value.amount, fault.wrong) === 0);
  const caught = wrong.length > 0 && wrong.every((f) => f.status === 'contested');
  const right = versions.some(
    (f) => f.status === 'verified' && f.value.t === 'money' && cmp(f.value.amount, fault.right) === 0,
  );
  out();
  const same = total !== '' && expected !== '' && cmp(total, expected) === 0;
  if (caught && right && same && summary.failedLoops === 0)
    out('PASS: the Verifier rejected the wrong figure and the total is right.');
  else {
    out('FAIL: the wrong figure was not rejected, or the result is wrong.');
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
