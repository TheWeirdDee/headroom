#!/usr/bin/env node
// Slop scan. Fails on placeholder text, debug output, Mozaik imports outside the
// adapter, and literal money-like numbers in the UI outside tests and formatting helpers.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles } from './lib/walk.mjs';

const CODE_EXT = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.md',
];

const CHECKS = [
  { id: 'marker', re: /\b(TODO|FIXME|XXX|TBD)\b/i, message: 'unfinished-work marker' },
  { id: 'lorem', re: /lorem ipsum|\blorem\b/i, message: 'filler text' },
  { id: 'coming-soon', re: /coming soon/i, message: 'coming-soon text' },
  // The word is banned as filler; an HTML/JSX input attribute named placeholder= is allowed.
  { id: 'placeholder', re: /placeholder(?!\s*=)/i, message: 'placeholder text' },
  { id: 'console-log', re: /console\.log\s*\(/, message: 'console.log' },
  { id: 'debugger', re: /\bdebugger\b/, message: 'debugger statement' },
];

const MOZAIK_IMPORT = /(?:from|import|require\(|import\()\s*['"](?:@mozaik-ai\/|@jigjoy\/)/;
// Agents are Mozaik participants; rules, parsing, exports, the web app and the claims package are not.
const WITHOUT_MOZAIK = /^(src\/(domain|inputs|exporters|integrations)|packages\/claims|web\/src)\//;
// Thousands-grouped amounts (6.000.000 / 6,000,000.00) or long decimals with two places (5400000.00).
const MONEY_LITERAL = /\b\d{1,3}(?:[.,]\d{3}){1,}(?:[.,]\d{2})?\b|\b\d{4,}\.\d{2}\b/;

function isUiMoneyExempt(rel) {
  return /\.test\.tsx?$/.test(rel) || rel.startsWith('web/src/format/') || rel.startsWith('web/test/');
}

export function scan(base, roots, exclude = []) {
  const findings = [];
  for (const rel of listFiles(roots, base, { extensions: CODE_EXT, exclude })) {
    if (rel === 'scripts/slop-scan.mjs') continue;
    const lines = readFileSync(resolve(base, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const c of CHECKS) {
        if (c.re.test(line)) findings.push({ file: rel, line: i + 1, id: c.id, message: c.message });
      }
      if (MOZAIK_IMPORT.test(line) && WITHOUT_MOZAIK.test(rel)) {
        findings.push({
          file: rel,
          line: i + 1,
          id: 'mozaik-import',
          message: 'Mozaik import in code that stays independent of the agent runtime',
        });
      }
      if (rel.startsWith('web/src/') && !isUiMoneyExempt(rel) && MONEY_LITERAL.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          id: 'money-literal',
          message: 'literal money-like number in UI code',
        });
      }
    });
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const base = process.cwd();
  const roots =
    args.length > 0
      ? args
      : ['src', 'web/src', 'web/index.html', 'rules', 'scripts', 'packages', 'README.md'];
  const findings = scan(
    base,
    roots,
    // web/src/generated holds pipeline output (npm run export:showcase), not hand-typed figures.
    args.length > 0 ? [] : ['test/fixtures/scans', 'web/src/generated'],
  );
  if (findings.length > 0) {
    for (const f of findings) console.error(`${f.file}:${f.line} [${f.id}] ${f.message}`);
    console.error(`slop-scan: ${findings.length} finding(s).`);
    process.exit(1);
  }
  process.stdout.write(`slop-scan: ok (${roots.join(', ')})\n`);
}
