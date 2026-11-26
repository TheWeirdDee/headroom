// Versioned claims for shared agent state: compare-and-set, corroboration, conflicts and idempotent
// retries. Every method is synchronous with no await inside, so in a single-threaded JS runtime each
// call is atomic: concurrent agents can never interleave inside a mutation.

export type ClaimStatus = 'proposed' | 'verified' | 'contested' | 'superseded' | 'needs_user';

export type ClaimEventType = 'claimed' | 'corroborated' | 'conflict' | 'status' | 'superseded';

export interface ClaimEvent {
  type: ClaimEventType;
  key: string;
  recordId: string;
  by: string;
  at: number;
  status: ClaimStatus;
  /** For 'conflict': the record the new proposal disagrees with. For 'superseded': the replacement. */
  relatedId?: string;
  reason?: string;
}

export interface ClaimRecord<V> {
  key: string;
  id: string;
  version: number;
  value: V;
  owner: string; // participant that first claimed the key
  proposedBy: string; // participant that proposed this version
  corroborators: string[];
  status: ClaimStatus;
  idempotencyKey: string;
  createdAt: number;
  conflictsWith?: string;
  history: ClaimEvent[];
}

export type ProposeResult<V> =
  | { kind: 'claimed'; record: ClaimRecord<V> }
  | { kind: 'corroborated'; record: ClaimRecord<V> }
  | { kind: 'conflict'; existing: ClaimRecord<V>; proposed: ClaimRecord<V> }
  | { kind: 'stale'; current: ClaimRecord<V> | undefined }
  | { kind: 'duplicate'; record: ClaimRecord<V> };

export interface ProposeInput<V> {
  key: string;
  value: V;
  by: string;
  idempotencyKey: string;
  expectedVersion?: number;
  equals?: (a: V, b: V) => boolean;
}

export interface ClaimStore<V> {
  propose(input: ProposeInput<V>): ProposeResult<V>;
  setStatus(key: string, id: string, status: ClaimStatus, by: string, reason?: string): ClaimRecord<V>;
  supersede(
    key: string,
    oldId: string,
    next: { value: V; by: string; idempotencyKey: string },
  ): ClaimRecord<V>;
  get(key: string): ClaimRecord<V> | undefined;
  getById(id: string): ClaimRecord<V> | undefined;
  versions(key: string): ClaimRecord<V>[];
  all(filter?: (r: ClaimRecord<V>) => boolean): ClaimRecord<V>[];
  onChange(listener: (e: ClaimEvent) => void): () => void;
}

export interface ClaimStoreOptions<V> {
  newId?: () => string;
  now?: () => number;
  equals?: (a: V, b: V) => boolean;
}

/** Thrown after a mutation when one or more change listeners threw; the store itself is consistent. */
export class ListenerError extends Error {
  constructor(readonly errors: unknown[]) {
    super(
      `${errors.length} claim change listener(s) threw: ${errors
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join('; ')}`,
    );
    this.name = 'ListenerError';
  }
}

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimError';
  }
}

/** Deterministic structural equality on JSON-like values (object key order ignored). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

const ACTIVE: ReadonlySet<ClaimStatus> = new Set(['proposed', 'verified', 'needs_user']);

export function isActive(r: { status: ClaimStatus }): boolean {
  return ACTIVE.has(r.status);
}

export function createClaimStore<V>(options: ClaimStoreOptions<V> = {}): ClaimStore<V> {
  let seq = 0;
  const newId = options.newId ?? ((): string => `c${String(++seq).padStart(8, '0')}`);
  const now = options.now ?? ((): number => Date.now());
  const defaultEquals = options.equals ?? jsonEquals;

  const byKey = new Map<string, ClaimRecord<V>[]>();
  const byId = new Map<string, ClaimRecord<V>>();
  // Idempotency keys are scoped to the claim key: the same producer key on another record key is new.
  const byIdempotency = new Map<string, ClaimRecord<V>>();
  const idemKey = (key: string, idempotencyKey: string): string => `${key}\u0000${idempotencyKey}`;
  const listeners = new Set<(e: ClaimEvent) => void>();

  // Events are recorded during a mutation and delivered only after all state has changed, so a throwing
  // listener can never leave a half-applied change. Listener errors are collected and rethrown.
  let outbox: ClaimEvent[] = [];
  function emit(record: ClaimRecord<V>, e: Omit<ClaimEvent, 'key' | 'recordId' | 'at' | 'status'>): void {
    const event: ClaimEvent = {
      ...e,
      key: record.key,
      recordId: record.id,
      at: now(),
      status: record.status,
    };
    record.history.push(event);
    outbox.push(event);
  }
  function flush(): void {
    const events = outbox;
    outbox = [];
    const errors: unknown[] = [];
    for (const event of events) {
      for (const l of [...listeners]) {
        try {
          l(event);
        } catch (err) {
          errors.push(err);
        }
      }
    }
    if (errors.length > 0) throw new ListenerError(errors);
  }

  function headVersion(key: string): number {
    const list = byKey.get(key);
    return list && list.length > 0 ? Math.max(...list.map((r) => r.version)) : 0;
  }

  /** The verified record, else the highest active version, else the highest version. */
  function current(key: string): ClaimRecord<V> | undefined {
    const list = byKey.get(key);
    if (!list || list.length === 0) return undefined;
    const verified = list.find((r) => r.status === 'verified');
    if (verified) return verified;
    const desc = [...list].sort((a, b) => b.version - a.version);
    return desc.find(isActive) ?? desc[0];
  }

  function create(
    key: string,
    value: V,
    by: string,
    idempotencyKey: string,
    conflictsWith?: string,
  ): ClaimRecord<V> {
    const list = byKey.get(key) ?? [];
    const first = list[0];
    const record: ClaimRecord<V> = {
      key,
      id: newId(),
      version: headVersion(key) + 1,
      value,
      owner: first ? first.owner : by,
      proposedBy: by,
      corroborators: [],
      status: 'proposed',
      idempotencyKey,
      createdAt: now(),
      history: [],
      ...(conflictsWith !== undefined ? { conflictsWith } : {}),
    };
    list.push(record);
    byKey.set(key, list);
    byId.set(record.id, record);
    byIdempotency.set(idemKey(key, idempotencyKey), record);
    return record;
  }

  function requireRecord(key: string, id: string): ClaimRecord<V> {
    const r = byId.get(id);
    if (!r || r.key !== key) throw new ClaimError(`No claim ${id} on key ${key}`);
    return r;
  }

  return {
    propose({ key, value, by, idempotencyKey, expectedVersion, equals }) {
      const dup = byIdempotency.get(idemKey(key, idempotencyKey));
      if (dup) return { kind: 'duplicate', record: dup };
      const cur = current(key);
      // Compare-and-set against the version callers read with get(key).
      if (expectedVersion !== undefined && expectedVersion !== (cur?.version ?? 0)) {
        return { kind: 'stale', current: cur };
      }
      const eq = equals ?? defaultEquals;
      const active = (byKey.get(key) ?? []).filter(isActive);
      const same = active.find((r) => eq(r.value, value));
      if (same) {
        byIdempotency.set(idemKey(key, idempotencyKey), same);
        // The same participant repeating its own value is a duplicate, not independent agreement.
        if (same.proposedBy === by || same.corroborators.includes(by))
          return { kind: 'duplicate', record: same };
        same.corroborators.push(by);
        emit(same, { type: 'corroborated', by });
        flush();
        return { kind: 'corroborated', record: same };
      }
      const opponent =
        active.find((r) => r.status === 'verified') ?? [...active].sort((a, b) => b.version - a.version)[0];
      if (opponent) {
        const proposed = create(key, value, by, idempotencyKey, opponent.id);
        emit(proposed, { type: 'conflict', by, relatedId: opponent.id });
        flush();
        return { kind: 'conflict', existing: opponent, proposed };
      }
      const record = create(key, value, by, idempotencyKey);
      emit(record, { type: 'claimed', by });
      flush();
      return { kind: 'claimed', record };
    },

    setStatus(key, id, status, by, reason) {
      const r = requireRecord(key, id);
      if (r.status === 'superseded')
        throw new ClaimError(`Claim ${id} is superseded and cannot change status`);
      const replaced =
        status === 'verified'
          ? (byKey.get(key) ?? []).filter((o) => o.id !== id && o.status === 'verified')
          : [];
      for (const other of replaced) other.status = 'superseded';
      r.status = status;
      for (const other of replaced) {
        emit(other, { type: 'superseded', by, relatedId: id, reason: 'another version was verified' });
      }
      emit(r, { type: 'status', by, ...(reason !== undefined ? { reason } : {}) });
      flush();
      return r;
    },

    supersede(key, oldId, next) {
      const old = requireRecord(key, oldId);
      const dup = byIdempotency.get(idemKey(key, next.idempotencyKey));
      if (dup) return dup;
      if (!isActive(old)) throw new ClaimError(`Claim ${oldId} is ${old.status} and cannot be superseded`);
      old.status = 'superseded';
      // If another active version already holds the replacement value, it becomes the replacement.
      const existing = (byKey.get(key) ?? []).find(
        (r) => r.id !== old.id && isActive(r) && defaultEquals(r.value, next.value),
      );
      if (existing) {
        byIdempotency.set(idemKey(key, next.idempotencyKey), existing);
        emit(old, { type: 'superseded', by: next.by, relatedId: existing.id });
        if (existing.proposedBy !== next.by && !existing.corroborators.includes(next.by)) {
          existing.corroborators.push(next.by);
          emit(existing, { type: 'corroborated', by: next.by });
        }
        flush();
        return existing;
      }
      const record = create(key, next.value, next.by, next.idempotencyKey);
      emit(old, { type: 'superseded', by: next.by, relatedId: record.id });
      emit(record, { type: 'claimed', by: next.by });
      flush();
      return record;
    },

    get: current,

    getById(id) {
      return byId.get(id);
    },

    versions(key) {
      return [...(byKey.get(key) ?? [])].sort((a, b) => a.version - b.version);
    },

    all(filter) {
      const out = [...byId.values()];
      return filter ? out.filter(filter) : out;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
