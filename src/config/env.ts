// Runtime configuration from the environment (.env is read with Node's built-in loader). Keys are never
// logged or written anywhere; the only thing exposed is whether a model key is present.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODELS } from './defaults.ts';
import { DEFAULT_RPM, KEY_ENV, providerOf } from './providers.ts';

export interface AppEnv {
  port: number;
  uploadMaxMb: number;
  offline: boolean;
  hasModelKey: boolean;
  /** The variable the user should set, for messages (for example GEMINI_API_KEY). */
  keyEnv: string;
  /** Model requests per minute across all agents (0: no pacing). */
  maxRpm: number;
  models: { reader: string; verifier: string };
  root: string;
  /** A hosted read-only sample instance (HEADROOM_PUBLIC_DEMO=1): offline only, uploads refused. */
  publicDemo?: boolean;
  /** Address to listen on (HOST); 127.0.0.1 unless a host platform needs 0.0.0.0. */
  host?: string;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/** Mozaik Cloud keys would upload loop events (with document text) to a third party: refuse them. */
export function assertNoCloudKeys(root: string): void {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  if (/^\s*(export\s+)?MOZAIK_(API|PROJECT)_KEY\s*=\s*\S/m.test(text)) {
    throw new EnvError(
      '.env sets MOZAIK_API_KEY or MOZAIK_PROJECT_KEY. Headroom keeps document text on this machine and the model provider only; remove that line.',
    );
  }
}

export function loadEnv(root: string, argv: string[] = process.argv): AppEnv {
  assertNoCloudKeys(root);
  const file = join(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const int = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) throw new EnvError(`${name} must be a whole number`);
    return Number.parseInt(raw, 10);
  };
  const offline = argv.includes('--offline');
  const publicDemo = (process.env['HEADROOM_PUBLIC_DEMO'] ?? '').trim() === '1';
  if (publicDemo && !offline)
    throw new EnvError('HEADROOM_PUBLIC_DEMO=1 runs only with --offline (recorded samples, no model key).');
  const models = {
    reader: process.env['HEADROOM_MODEL_READER']?.trim() || DEFAULT_MODELS.reader,
    verifier: process.env['HEADROOM_MODEL_VERIFIER']?.trim() || DEFAULT_MODELS.verifier,
  };
  const providers = [...new Set([providerOf(models.reader), providerOf(models.verifier)])];
  for (const [name, model] of Object.entries(models))
    if (!providerOf(model))
      throw new EnvError(`HEADROOM_MODEL_${name.toUpperCase()}: unknown model "${model}"`);
  const value = (n: string): string => (process.env[n] ?? '').trim();
  // Mozaik's Gemini endpoint reads GEMINI_API_KEY; accept Google's other name too.
  if (!value('GEMINI_API_KEY') && value('GOOGLE_API_KEY'))
    process.env['GEMINI_API_KEY'] = value('GOOGLE_API_KEY');
  const has = providers.every((p) => p !== undefined && KEY_ENV[p].some((n) => value(n) !== ''));
  const main = providerOf(models.reader) ?? 'google';
  return {
    port: int('PORT', 4317),
    uploadMaxMb: int('UPLOAD_MAX_MB', 10),
    offline,
    hasModelKey: !offline && has,
    keyEnv: KEY_ENV[main][0] ?? 'GEMINI_API_KEY',
    maxRpm: int('HEADROOM_MAX_RPM', Math.max(...providers.map((p) => (p ? DEFAULT_RPM[p] : 0)))),
    models,
    root,
    publicDemo,
    host: (process.env['HOST'] ?? '').trim() || '127.0.0.1',
  };
}
