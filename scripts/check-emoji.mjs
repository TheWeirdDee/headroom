#!/usr/bin/env node
// Fails when any literal emoji code point appears in source, rules, scripts or the README.
// Standing rule: icons come from lucide-react only, never emoji.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles } from './lib/walk.mjs';

// Text symbols (c), (r) and TM are pictographic in Unicode but are not emoji; they are allowed.
const EMOJI =
  /(?![\u{00A9}\u{00AE}\u{2122}])\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{20E3}/u;
const TEXT_EXT = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.html',
  '.csv',
  '.txt',
  '.yml',
  '.yaml',
];

export function findEmoji(base, roots, exclude = []) {
  const hits = [];
  for (const rel of listFiles(roots, base, { extensions: TEXT_EXT, exclude })) {
    const lines = readFileSync(resolve(base, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = EMOJI.exec(line);
      if (m)
        hits.push({
          file: rel,
          line: i + 1,
          codePoint: `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`,
        });
    });
  }
  return hits;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const base = process.cwd();
  const roots =
    args.length > 0
      ? args
      : ['src', 'web/src', 'web/index.html', 'rules', 'scripts', 'packages', 'README.md', 'data'];
  const hits = findEmoji(base, roots, args.length > 0 ? [] : ['test/fixtures/scans']);
  if (hits.length > 0) {
    for (const h of hits) console.error(`${h.file}:${h.line} emoji ${h.codePoint}`);
    console.error(`check-emoji: ${hits.length} emoji found. Use lucide-react icons instead.`);
    process.exit(1);
  }
  process.stdout.write(`check-emoji: ok (${roots.join(', ')})\n`);
}
