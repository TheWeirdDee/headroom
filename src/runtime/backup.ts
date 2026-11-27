// Backup models. When a model's daily quota is used up, the rest of the run is sent to the next model in the
// list instead of failing. Which backups answered is reported with the run and shown on screen: a result is
// never attributed to a model that did not produce it.
import { DailyQuotaError } from './loop.ts';

export interface Backups {
  /** Run `send` with `primary`, moving to the next model each time a daily quota is used up. */
  run<T>(primary: string, send: (model: string) => Promise<T>): Promise<T>;
  /** The backup models that answered at least one request, in the order they first did. */
  used(): string[];
}

export function createBackups(
  models: readonly string[],
  onSwitch?: (from: string, to: string) => void,
): Backups {
  const exhausted = new Set<string>();
  const used = new Set<string>();
  return {
    async run(primary, send) {
      const chain = [primary, ...models.filter((m) => m !== primary)];
      const open = chain.filter((m) => !exhausted.has(m));
      // With every quota used up the primary is asked again, so its refusal is the error that is shown.
      const candidates = open.length > 0 ? open : [primary];
      for (let i = 0; ; i++) {
        const model = candidates[i] ?? primary;
        try {
          const out = await send(model);
          if (model !== primary) used.add(model);
          return out;
        } catch (error) {
          const next = candidates[i + 1];
          if (!(error instanceof DailyQuotaError) || next === undefined) throw error;
          if (!exhausted.has(model)) onSwitch?.(model, next);
          exhausted.add(model);
        }
      }
    },
    used: () => [...used],
  };
}
