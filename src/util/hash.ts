import { createHash } from 'node:crypto';

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Canonical JSON: object keys sorted, undefined dropped. Used for request hashes and determinism checks. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function sequentialIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(6, '0')}`;
}
