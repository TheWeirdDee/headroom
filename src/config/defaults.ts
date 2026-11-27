import type { RunConfig } from '../domain/types.ts';

/** Model ids must be in the @mozaik-ai/core 6.0.0 supportedModels list. */
// Gemini by default: it has a free tier. Any other supported model can be set in .env.
export const DEFAULT_MODELS = { reader: 'gemini-3.5-flash-lite', verifier: 'gemini-3.5-flash-lite' } as const;

export function defaultRunConfig(year: number, asOf: string, overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    year,
    asOf,
    fxDateRule: 'invoice_issue_date',
    vatWindow: '365d',
    indepIncomeBasis: 'invoiced',
    rsdRounding: 'half_up',
    models: { ...DEFAULT_MODELS },
    concurrency: { invoice: 4, statement: 4, kpo: 4, verifier: 6 },
    loopTimeoutMs: 90_000,
    maxRetries: 2,
    ...overrides,
  };
}
