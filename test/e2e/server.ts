// Test-only server for UI checks and Playwright: the real app with the deterministic fake model (never a
// real model, never shipped as a recording) and the recorded NBS rates. The model name says so on screen.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.ts';
import { RunManager } from '../../src/server/run-manager.ts';
import { UploadStore } from '../../src/server/uploads.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import type { AppEnv } from '../../src/config/env.ts';

const rates = JSON.parse(readFileSync('data/rates/kurs.json', 'utf8')) as Record<
  string,
  { status: number; body: string }
>;
const port = Number.parseInt(process.env['E2E_PORT'] ?? '4318', 10);
const env: AppEnv = {
  port,
  uploadMaxMb: 5,
  offline: false,
  hasModelKey: true,
  models: { reader: 'fake-model (test)', verifier: 'fake-model (test)' },
  root: '.',
  keyEnv: 'GEMINI_API_KEY',
  maxRpm: 0,
};
const rules = loadRules();
const runs = new RunManager({
  env,
  rules,
  profilesDir: 'data/profiles',
  liveFetcher: async (u) => rates[u] ?? { status: 503, body: '' },
  modelBackend: () => fakeModel(),
});
const app = await buildApp({
  env,
  runs,
  uploads: new UploadStore(mkdtempSync(join(tmpdir(), 'headroom-e2e-')), env.uploadMaxMb * 1024 * 1024),
  rules,
  webDist: join(import.meta.dirname, '..', '..', 'web', 'dist'),
  evidenceFile: join(tmpdir(), 'headroom-e2e-no-evidence.json'),
  version: 'e2e',
});
await app.listen({ port, host: '127.0.0.1' });
process.stdout.write(`e2e server on http://127.0.0.1:${port}\n`);
