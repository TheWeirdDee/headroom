import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain ESM script without type declarations
import { scan } from '../../scripts/slop-scan.mjs';
// @ts-expect-error plain ESM script without type declarations
import { findEmoji } from '../../scripts/check-emoji.mjs';
// @ts-expect-error plain ESM script without type declarations
import { evaluate } from '../../scripts/check-licenses.mjs';

interface Finding {
  file: string;
  line: number;
  id: string;
}

// Bad inputs are built at test time so no banned text or emoji is ever committed.
const EMOJI_CHAR = String.fromCodePoint(0x1f680);
const MARK = ['TO', 'DO'].join('');
const LOG = ['console', 'log'].join('.');

let dir: string;

function write(rel: string, body: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'headroom-scan-'));
  write('bad/src/a.ts', `// ${MARK}: finish this\n${LOG}('x');\n`);
  write(
    'bad/src/domain/b.ts',
    `import { createAgent } from '@mozaik-ai/core';\nexport const a = createAgent;\n`,
  );
  write('bad/web/src/Card.tsx', `export const total = '5.400.000,00';\n`);
  write('bad/web/src/Hero.tsx', `export const title = 'Launch ${EMOJI_CHAR}';\n`);
  write('bad/src/c.ts', `export const copy = 'lorem ipsum, coming soon';\n`);
  write('bad2/src/domain/d.mts', `import '@mozaik-ai/core';\n// ${MARK.toLowerCase()}: later\n`);
  write('bad2/src/domain/e.cjs', `const m = require('@jigjoy/mozaik-agent');\n`);
  write('good/src/footer.ts', `export const notice = 'Copyright \u00A9 2026';\n`);
  write('good/src/a.ts', `export const add = (a: string): string => a;\n`);
  write('good/web/src/Input.tsx', `export const el = '<input placeholder="Amount" />';\n`);
  write('good/web/src/format/money.ts', `export const sample = '6.000.000,00';\n`);
  write(
    'good/src/agents/agent.ts',
    `import { createAgent } from '@mozaik-ai/core';\nexport { createAgent };\n`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('slop scan', () => {
  it('fails on markers, debug output, Mozaik in domain code, filler and UI money literals', () => {
    const ids = (scan(join(dir, 'bad'), ['.']) as Finding[]).map((f) => f.id).sort();
    expect(ids).toEqual(['coming-soon', 'console-log', 'lorem', 'marker', 'money-literal', 'mozaik-import']);
  });

  it('passes on clean files, input placeholder attributes, format helpers and agents on Mozaik', () => {
    expect(scan(join(dir, 'good'), ['.'])).toEqual([]);
  });
});

describe('slop scan edge cases', () => {
  it('catches side-effect imports, require, lowercase markers and .mts/.cjs files', () => {
    const ids = (scan(join(dir, 'bad2'), ['.']) as Finding[]).map((f) => `${f.file}:${f.id}`).sort();
    expect(ids).toEqual([
      'src/domain/d.mts:marker',
      'src/domain/d.mts:mozaik-import',
      'src/domain/e.cjs:mozaik-import',
    ]);
  });
});

describe('emoji check', () => {
  it('finds a literal emoji with file, line and code point', () => {
    const hits = findEmoji(join(dir, 'bad'), ['.']) as Array<{
      file: string;
      line: number;
      codePoint: string;
    }>;
    expect(hits).toEqual([{ file: 'web/src/Hero.tsx', line: 1, codePoint: 'U+1F680' }]);
  });

  it('passes on clean files', () => {
    expect(findEmoji(join(dir, 'good'), ['.'])).toEqual([]);
  });

  it('exits non-zero from the command line on a bad tree', () => {
    expect(() =>
      execFileSync(process.execPath, [join(process.cwd(), 'scripts/check-emoji.mjs'), 'web'], {
        cwd: join(dir, 'bad'),
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});

describe('licence check', () => {
  it('denies copyleft licences and counts the rest', () => {
    const { denied, counts } = evaluate({
      'a@1.0.0': { licenses: 'MIT' },
      'b@1.0.0': { licenses: 'GPL-3.0' },
      'c@1.0.0': { licenses: ['MIT', 'Apache-2.0'] },
    }) as { denied: Array<{ name: string }>; counts: Map<string, number> };
    expect(denied.map((d) => d.name)).toEqual(['b@1.0.0']);
    expect(counts.get('MIT')).toBe(1);
  });
});
