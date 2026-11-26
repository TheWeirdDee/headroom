// Runtime configuration from the environment (.env is read with Node's built-in loader). Keys are never
// logged or written anywhere; the only thing exposed is whether a model key is present.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODELS } from './defaults.ts';

export interface AppEnv {
  port: number;
  uploadMaxMb: number;
  offline: boolean;
  hasModelKey: boolean;
  models: { reader: string; verifier: string };
  root: string;
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
  return {
    port: int('PORT', 4317),
    uploadMaxMb: int('UPLOAD_MAX_MB', 10),
    offline,
    hasModelKey: !offline && (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '',
    models: {
      reader: process.env['HEADROOM_MODEL_READER']?.trim() || DEFAULT_MODELS.reader,
      verifier: process.env['HEADROOM_MODEL_VERIFIER']?.trim() || DEFAULT_MODELS.verifier,
    },
    root,
  };
}
