// npm run record-demo [profileId]: records a live run of a bundled sample with the real model into
// runs/demo-<profileId>/, the offline demo. Needs the model key in .env (GEMINI_API_KEY by default) and network access
// to the model provider and the Kurs API. The previous recording is kept until the new one completes.
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/config/env.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { RunManager } from '../src/server/run-manager.ts';
import { liveFetcher } from '../src/integrations/kurs/client.ts';
import { sampleRecorder } from '../src/engine/recordings.ts';
import { configurePacer } from '../src/runtime/pacer.ts';

const ROOT = join(import.meta.dirname, '..');
const profileId = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'p07';
const env = loadEnv(ROOT, ['node', 'record-demo']);
if (!env.hasModelKey) {
  process.stderr.write(`No model key: add ${env.keyEnv} to .env to record a demo run.\n`);
  process.exit(1);
}
configurePacer(env.maxRpm);
const runsDir = join(ROOT, 'runs');
const staging = join(runsDir, '.recording');
rmSync(staging, { recursive: true, force: true });
const runs = new RunManager({
  env,
  rules: loadRules(),
  profilesDir: join(ROOT, 'data', 'profiles'),
  liveFetcher,
  recorder: sampleRecorder(staging),
});
const runId = await runs.start({ profileId, mode: 'live' });
process.stdout.write(`Recording ${profileId} as ${runId}...\n`);
let snap = runs.snapshot(runId) as unknown as {
  status: string;
  loops: Array<{ status: string; error?: string }>;
};
for (let i = 0; snap.status === 'running'; i++) {
  if (i > 7200) throw new Error('The run did not finish within an hour.');
  await new Promise((r) => setTimeout(r, 500));
  snap = runs.snapshot(runId) as unknown as typeof snap;
}
const failed = snap.loops.filter((l) => l.status === 'failed');
if (snap.status === 'failed' || failed.length > 0) {
  process.stderr.write(
    `The run failed; the previous recording is kept.\n${failed.map((l) => l.error).join('\n')}\n`,
  );
  process.exit(1);
}
const [dir] = readdirSync(staging);
if (!dir) throw new Error('Nothing was recorded.');
const target = join(runsDir, `demo-${profileId}`);
if (existsSync(target)) rmSync(target, { recursive: true });
renameSync(join(staging, dir), target);
rmSync(staging, { recursive: true, force: true });
process.stdout.write(`Saved ${target} (status ${snap.status}). Check it with npm run start:offline.\n`);
process.exit(0);
