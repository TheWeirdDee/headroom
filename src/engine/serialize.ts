// Allowlist serializer for anything written to disk or sent to the browser. Only the
// listed fields of an event survive; values are walked and any string that looks like a credential is
// refused. Recordings and SSE never carry environment variables, headers or model provider keys.
import type { HrEvent } from '../runtime/types.ts';

const EVENT_FIELDS = ['eventId', 'runId', 'type', 'producerId', 'occurredAt', 'payload'] as const;

// Shapes of real credentials, not the words around them: user documents say things like "risk-assessment"
// or "Payment authorization:" and must pass. Anthropic/OpenAI (sk-...), Google (AIza...) and Groq
// (gsk_...) keys, environment assignments, long values assigned to an api key, and HTTP auth headers.
export const SECRET_PATTERN = new RegExp(
  [
    '(?<![A-Za-z0-9])sk-(?:ant-|proj-)[A-Za-z0-9_-]{8,}',
    '(?<![A-Za-z0-9])sk-(?=[A-Za-z_-]*[0-9])[A-Za-z0-9_-]{20,}',
    'AIza[0-9A-Za-z_-]{30,}',
    'gsk_[A-Za-z0-9]{20,}',
    '_api_key\\s*=\\s*\\S',
    'api[_-]?key["\']?\\s*[:=]\\s*["\']?(?=[A-Za-z_-]*[0-9])[A-Za-z0-9_-]{16,}',
    'authorization\\s*:\\s*(?:bearer|basic)\\s',
    'x-(?:goog-)?api-key',
  ].join('|'),
  'i',
);

export class SecretLeakError extends Error {
  constructor(where: string) {
    super(`Refused to serialize a value that looks like a credential at ${where}`);
    this.name = 'SecretLeakError';
  }
}

function scrub(v: unknown, path: string, depth: number): unknown {
  if (depth > 40) throw new Error(`Value nested too deeply at ${path}`);
  if (typeof v === 'string') {
    if (SECRET_PATTERN.test(v)) throw new SecretLeakError(path);
    return v;
  }
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x, i) => scrub(x, `${path}[${i}]`, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_PATTERN.test(k)) throw new SecretLeakError(`${path}.${k}`);
      const s = scrub(x, `${path}.${k}`, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  throw new Error(`Unserializable ${typeof v} at ${path}`);
}

export function serializeEvent(e: HrEvent): string {
  const picked: Record<string, unknown> = {};
  for (const f of EVENT_FIELDS) picked[f] = e[f];
  return JSON.stringify(scrub(picked, 'event', 0));
}

export function serializeValue(v: unknown, where = 'value'): string {
  return JSON.stringify(scrub(v, where, 0));
}
