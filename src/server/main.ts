// Entry point: npm start (live) and npm run start:offline (recorded sample runs, no key, no network).
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { loadEnv } from '../config/env.ts';
import { loadRules } from '../domain/rules/loader.ts';
import { RunManager } from './run-manager.ts';
import { UploadStore } from './uploads.ts';
import { buildApp } from './app.ts';
import { configurePacer } from '../runtime/pacer.ts';
import { liveFetcher, type Fetcher } from '../integrations/kurs/client.ts';
import { replaySource, sampleRecorder } from '../engine/recordings.ts';

const ROOT = join(import.meta.dirname, '..', '..');

function replaySpeed(argv: string[]): number {
  const i = argv.indexOf('--speed');
  if (i < 0) return 1;
  const raw = argv[i + 1] ?? '';
  if (!/^\d+(\.\d+)?$/.test(raw) || Number.parseFloat(raw) <= 0)
    throw new Error('--speed needs a positive number, for example --speed 2');
  return Number.parseFloat(raw);
}

async function main(): Promise<void> {
  const env = loadEnv(ROOT);
  const rules = loadRules();
  configurePacer(env.maxRpm);
  mkdirSync(join(ROOT, 'uploads'), { recursive: true });
  const offlineFetcher: Fetcher = async (url) => {
    throw new Error(`Offline mode makes no network requests (${url})`);
  };
  const runs = new RunManager({
    env,
    rules,
    profilesDir: join(ROOT, 'data', 'profiles'),
    liveFetcher: env.offline ? offlineFetcher : liveFetcher,
    // --speed N plays recorded runs N times faster (PRD 14.6); the default keeps the recorded timing.
    replay: replaySource(join(ROOT, 'runs'), { speed: replaySpeed(process.argv) }),
    // A public instance keeps only the most recent runs in memory.
    ...(env.publicDemo ? { maxRuns: 30 } : {}),
    ...(env.offline ? {} : { recorder: sampleRecorder(join(ROOT, 'runs')) }),
  });
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const app = await buildApp({
    env,
    runs,
    uploads: new UploadStore(join(ROOT, 'uploads'), env.uploadMaxMb * 1024 * 1024),
    rules,
    webDist: join(ROOT, 'web', 'dist'),
    evidenceFile: join(ROOT, 'eval', 'results.json'),
    version: pkg.version,
  });
  // Unhandled rejections are reported, never allowed to take the server down silently.
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(
      `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}\n`,
    );
  });
  await app.listen({ port: env.port, host: env.host ?? '127.0.0.1' });
  process.stdout.write(
    `Headroom ${env.publicDemo ? 'PUBLIC SAMPLE INSTANCE, ' : ''}${env.offline ? 'OFFLINE (recorded sample runs only)' : env.hasModelKey ? `LIVE (${env.models.reader}${env.maxRpm ? `, at most ${env.maxRpm} requests a minute` : ''})` : `LIVE (no ${env.keyEnv}: sample runs offer the recorded version)`} on http://localhost:${env.port}\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
