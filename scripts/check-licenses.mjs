#!/usr/bin/env node
// Lists production dependency licences and fails on copyleft licences that conflict with MIT
// distribution (PRD 20.6). Uses license-checker's JSON output.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DENY = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC|CC-BY-SA)\b/i;

export function evaluate(packages) {
  const counts = new Map();
  const denied = [];
  for (const [name, info] of Object.entries(packages)) {
    const lic = Array.isArray(info.licenses)
      ? info.licenses.join(' OR ')
      : String(info.licenses ?? 'UNKNOWN');
    counts.set(lic, (counts.get(lic) ?? 0) + 1);
    if (DENY.test(lic)) denied.push({ name, lic });
  }
  return { counts, denied };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dirs = ['.', 'web'].filter((d) => d === '.' || process.argv.includes('--with-web'));
  let failed = false;
  for (const dir of dirs) {
    const raw = execFileSync(
      'npx',
      [
        '--no-install',
        'license-checker',
        '--production',
        '--excludePrivatePackages',
        '--json',
        '--start',
        dir,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const { counts, denied } = evaluate(JSON.parse(raw));
    process.stdout.write(`licences (${dir}):\n`);
    for (const [lic, n] of [...counts].sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${lic}: ${n}\n`);
    for (const d of denied) {
      console.error(`  denied: ${d.name} (${d.lic})`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
