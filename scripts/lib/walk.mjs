import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'test-results', 'playwright-report']);

/**
 * List files under each root (file or directory), skipping build and dependency folders.
 * Paths are returned relative to `base` with forward slashes.
 */
export function listFiles(roots, base, { extensions, exclude = [] } = {}) {
  const out = [];
  const visit = (abs) => {
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    const rel = relative(base, abs).split(sep).join('/');
    if (exclude.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return;
    if (st.isDirectory()) {
      const name = abs.split(sep).pop();
      if (SKIP_DIRS.has(name)) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
      return;
    }
    if (!extensions || extensions.some((ext) => rel.endsWith(ext))) out.push(rel);
  };
  for (const root of roots) visit(join(base, root));
  return out.sort();
}
