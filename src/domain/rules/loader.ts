import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RuleFileSchema, type Rule } from './schema.ts';
import { RuleBook } from './engine.ts';

export const RULES_DIR = join(import.meta.dirname, '..', '..', '..', 'rules');

export class RuleLoadError extends Error {
  constructor(file: string, detail: string) {
    super(`Rules file ${file} is invalid: ${detail}`);
    this.name = 'RuleLoadError';
  }
}

/** Load and validate every rules/*.json file. Duplicate ids are an error. */
export function loadRules(dir: string = RULES_DIR): RuleBook {
  const rules: Rule[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      throw new RuleLoadError(file, (e as Error).message);
    }
    const parsed = RuleFileSchema.safeParse(raw);
    if (!parsed.success) throw new RuleLoadError(file, parsed.error.message);
    rules.push(...parsed.data.rules);
  }
  return new RuleBook(rules);
}
