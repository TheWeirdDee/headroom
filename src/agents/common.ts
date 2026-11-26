// Shared agent plumbing: dependencies, status publishing, prompts with hashes, JSON Schema from Zod,
// validated submit tools, and a concurrency limiter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sha256 } from '../util/hash.ts';
import { doingNow, stateOf, type Decision } from './status-text.ts';
import type { HrRuntime, HrTool } from '../runtime/types.ts';
import type { RuleBook } from '../domain/rules/engine.ts';
import type { RunInputs } from '../engine/inputs.ts';
import type { KursClient } from '../integrations/kurs/client.ts';

export const AGENTS = {
  invoiceReader: 'invoice-reader',
  statementReader: 'statement-reader',
  kpoReader: 'kpo-reader',
  rateClerk: 'rate-clerk',
  limitKeeper: 'limit-keeper',
  independenceChecker: 'independence-checker',
  verifier: 'verifier',
  human: 'human',
  observer: 'transcript',
} as const;

export type AgentId = (typeof AGENTS)[keyof typeof AGENTS];

export interface AgentDeps {
  rt: HrRuntime;
  rules: RuleBook;
  inputs: RunInputs;
  kurs: KursClient;
  now: () => number;
  /** Today's date in Belgrade, for refusing rate requests for dates NBS has not published yet. */
  today: () => string;
}

export function setStatus(rt: HrRuntime, agentId: string, decision: Decision, loopId?: string): void {
  rt.publish('hr.agent.status', agentId, {
    agentId,
    state: stateOf(decision),
    doingNow: doingNow(decision),
    ...(loopId ? { loopId } : {}),
  });
}

export interface Prompt {
  text: string;
  hash: string;
}

const AGENTS_DIR = import.meta.dirname;

export function loadPrompt(agentDir: string): Prompt {
  const text = readFileSync(join(AGENTS_DIR, agentDir, 'prompt.md'), 'utf8');
  return { text, hash: `sha256:${sha256(text)}` };
}

/** JSON Schema for a model-facing schema, plus its hash for the request hash. */
export function jsonSchema(schema: z.ZodType): { schema: Record<string, unknown>; hash: string } {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json['$schema'];
  return { schema: json, hash: `sha256:${sha256(JSON.stringify(json))}` };
}

/**
 * A tool whose arguments are validated by Zod before `handle` runs. The text it returns depends only on
 * the arguments and the run's own inputs (never on other agents' board writes), so recorded transcripts
 * and request hashes stay deterministic.
 */
export function submitTool<T>(
  name: string,
  description: string,
  schema: z.ZodType<T>,
  handle: (args: T) => string,
): HrTool & { calls: number } {
  const tool = {
    name,
    description,
    parameters: jsonSchema(schema).schema,
    calls: 0,
    async invoke(args: unknown): Promise<string> {
      tool.calls += 1;
      if (args && typeof args === 'object' && '__vetoed' in args) {
        return `Refused by the Verifier before it ran: ${String((args as { __vetoed: unknown }).__vetoed)}. Every figure needs a source.`;
      }
      const parsed = schema.safeParse(args);
      if (!parsed.success) return `Rejected: arguments do not match the schema. ${parsed.error.message}`;
      return handle(parsed.data);
    },
  };
  return tool;
}

/** Limits concurrent work (e.g. INVOICE_READER_CONCURRENCY). FIFO. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
