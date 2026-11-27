import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

async function messages(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.message);
}

describe('custom lint rules (PRD 17.4)', () => {
  it('forbids Number() and parseFloat() in src/domain', async () => {
    const msgs = await messages(
      'src/domain/bad.ts',
      "export const a = Number('1.5');\nexport const b = parseFloat('2');\nexport const c = Number.parseFloat('3');\n",
    );
    expect(msgs.filter((m) => m.includes('domain code'))).toHaveLength(3);
  });

  it('also forbids unary +, parseInt and Number parsing through globalThis in src/domain', async () => {
    const msgs = await messages(
      'src/domain/bad.ts',
      "export const a = +'1';\nexport const b = parseInt('2', 10);\nexport const c = Number.parseInt('3', 10);\nexport const d = globalThis.Number('4');\n",
    );
    expect(msgs.filter((m) => m.includes('domain code'))).toHaveLength(4);
  });

  it('forbids dynamic import and require of Mozaik in the rules and parsing code', async () => {
    const code =
      "export const m = import('@mozaik-ai/core');\nexport const r = require('@jigjoy/mozaik-agent');\n";
    expect(
      (await messages('src/domain/bad.ts', code)).filter((m) => m.includes('independent of the agent')),
    ).toHaveLength(2);
  });

  it('lets agents be Mozaik participants and keeps the domain and claims package free of Mozaik', async () => {
    const code = "import { createAgent } from '@mozaik-ai/core';\nexport const a = createAgent;\n";
    for (const file of ['src/domain/bad.ts', 'src/inputs/bad.ts', 'packages/claims/src/bad.ts'])
      expect((await messages(file, code)).some((m) => m.includes('independent of the agent'))).toBe(true);
    expect(await messages('src/agents/ok.ts', code)).toEqual([]);
    expect(await messages('src/runtime/mozaik/runtime.ts', code)).toEqual([]);
  });

  it('forbids await and async functions in packages/claims/src', async () => {
    const msgs = await messages(
      'packages/claims/src/bad.ts',
      'export async function f(p: Promise<number>): Promise<number> {\n  return await p;\n}\n',
    );
    expect(msgs.some((m) => m.includes('synchronous'))).toBe(true);
    expect(msgs.some((m) => m.includes('No async functions'))).toBe(true);
  });

  it('forbids promise chains and _truth paths in packages/claims/src', async () => {
    const msgs = await messages(
      'packages/claims/src/bad.ts',
      "export const f = (p: Promise<number>): void => {\n  void p.then((x) => x);\n};\nexport const t = '_truth/x';\n",
    );
    expect(msgs.some((m) => m.includes('promise chains'))).toBe(true);
    expect(msgs.some((m) => m.includes('Ground truth'))).toBe(true);
  });

  it('forbids _truth paths outside scripts/eval.ts and tests', async () => {
    const code = "export const p = 'data/profiles/p07/_truth/truth.json';\n";
    expect((await messages('src/server/bad.ts', code)).some((m) => m.includes('Ground truth'))).toBe(true);
    expect(await messages('scripts/eval.ts', code)).toEqual([]);
  });

  it('forbids console in product code', async () => {
    const msgs = await messages('src/server/bad.ts', "console.info('x');\n");
    expect(msgs.some((m) => m.includes('console'))).toBe(true);
  });
});
