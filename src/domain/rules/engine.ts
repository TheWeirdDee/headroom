// The rule book: lookup of rule data and typed parameter access. Pure, no model calls.
// Arithmetic lives in limits.ts, fx.ts and independence.ts, which take parameters from here.
import { z } from 'zod';
import { CriterionSchema, type Criterion, type Rule } from './schema.ts';

function param<T>(id: string, name: string, schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`Rule ${id} param ${name} is invalid: ${r.error.message}`);
  return r.data;
}

export class RuleBook {
  private readonly byId: Map<string, Rule>;

  constructor(rules: Rule[]) {
    this.byId = new Map();
    for (const r of rules) {
      if (this.byId.has(r.id)) throw new Error(`Duplicate rule id ${r.id}`);
      this.byId.set(r.id, r);
    }
  }

  get(id: string): Rule {
    const r = this.byId.get(id);
    if (!r) throw new Error(`Unknown rule ${id}`);
    return r;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Rule[] {
    return [...this.byId.values()];
  }

  /** Rules shown with an "assumption" chip (never presented as fact). */
  assumptions(): Rule[] {
    return this.all().filter((r) => r.status === 'assumption');
  }

  isAssumption(id: string): boolean {
    return this.get(id).status === 'assumption';
  }

  /** Primary source URL used for `rule` SourceRefs. */
  url(id: string): string {
    const [first] = this.get(id).sources;
    if (!first) throw new Error(`Rule ${id} has no source`);
    return first.url;
  }

  decimalParam(id: string, name: string): string {
    return param(id, name, z.string().regex(/^-?\d+(\.\d+)?$/), this.get(id).params[name]);
  }

  intParam(id: string, name: string): number {
    return param(id, name, z.number().int(), this.get(id).params[name]);
  }

  boolParam(id: string, name: string): boolean {
    return param(id, name, z.boolean(), this.get(id).params[name]);
  }

  stringParam(id: string, name: string): string {
    return param(id, name, z.string(), this.get(id).params[name]);
  }

  criteria(): Criterion[] {
    return z.array(CriterionSchema).length(9).parse(this.get('R-INDEP').params['criteria']);
  }
}
