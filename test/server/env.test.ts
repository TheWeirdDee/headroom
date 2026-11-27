import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvError, loadEnv } from '../../src/config/env.ts';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'headroom-env-'));

  it('a public sample instance runs only offline', () => {
    process.env['HEADROOM_PUBLIC_DEMO'] = '1';
    expect(() => loadEnv(root, ['node', 'main'])).toThrow(EnvError);
    const env = loadEnv(root, ['node', 'main', '--offline']);
    expect(env.publicDemo).toBe(true);
    expect(env.hasModelKey).toBe(false);
  });

  it('listens on 127.0.0.1 unless HOST says otherwise; Groq models need GROQ_API_KEY', () => {
    delete process.env['HOST'];
    expect(loadEnv(root, ['node', 'main']).host).toBe('127.0.0.1');
    process.env['HOST'] = '0.0.0.0';
    process.env['HEADROOM_MODEL_READER'] = 'groq/openai/gpt-oss-120b';
    process.env['HEADROOM_MODEL_VERIFIER'] = 'groq/openai/gpt-oss-120b';
    delete process.env['GROQ_API_KEY'];
    const env = loadEnv(root, ['node', 'main']);
    expect(env.host).toBe('0.0.0.0');
    expect(env.hasModelKey).toBe(false);
    expect(env.keyEnv).toBe('GROQ_API_KEY');
    expect(env.maxRpm).toBe(8);
  });
});
