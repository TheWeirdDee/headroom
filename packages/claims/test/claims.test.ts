import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ClaimError,
  createClaimStore,
  isActive,
  jsonEquals,
  ListenerError,
  type ClaimEvent,
  type ClaimStatus,
} from '../src/index.ts';

function store<V>() {
  let t = 0;
  return createClaimStore<V>({ now: () => ++t });
}

describe('propose', () => {
  it('a participant proposing a new value for its own claim revises it instead of conflicting', () => {
    const s = store<string>();
    const events: ClaimEvent[] = [];
    s.onChange((e) => events.push(e));
    const first = s.propose({ key: 'k', value: 'met', by: 'checker', idempotencyKey: 'v1' });
    const second = s.propose({ key: 'k', value: 'not_met', by: 'checker', idempotencyKey: 'v2' });
    expect(second.kind).toBe('claimed');
    expect(first.kind === 'claimed' && s.getById(first.record.id)?.status).toBe('superseded');
    expect(events.map((e) => e.type)).not.toContain('conflict');
    // Another participant disagreeing is still a conflict, against the revised value.
    const third = s.propose({ key: 'k', value: 'met', by: 'reader', idempotencyKey: 'r1' });
    expect(third.kind).toBe('conflict');
    expect(third.kind === 'conflict' && second.kind === 'claimed' && third.existing.id).toBe(
      second.kind === 'claimed' ? second.record.id : '',
    );
  });

  it('first proposal claims the key with status proposed and the proposer as owner', () => {
    const s = store<number>();
    const r = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    expect(r.kind).toBe('claimed');
    if (r.kind !== 'claimed') return;
    expect(r.record).toMatchObject({
      key: 'k',
      version: 1,
      value: 1,
      owner: 'a',
      status: 'proposed',
      corroborators: [],
    });
  });

  it('same value from another participant corroborates', () => {
    const s = store<number>();
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const r = s.propose({ key: 'k', value: 1, by: 'b', idempotencyKey: 'b1' });
    expect(r.kind).toBe('corroborated');
    expect(s.get('k')?.corroborators).toEqual(['b']);
    expect(s.versions('k')).toHaveLength(1);
  });

  it('same value from the same participant with a new idempotency key is a duplicate', () => {
    const s = store<number>();
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    expect(s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a2' }).kind).toBe('duplicate');
    expect(s.get('k')?.corroborators).toEqual([]);
  });

  it('a different value conflicts; both versions are kept, linked, and proposed', () => {
    const s = store<number>();
    const first = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const r = s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1' });
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict' || first.kind !== 'claimed') return;
    expect(r.existing.id).toBe(first.record.id);
    expect(r.proposed).toMatchObject({
      version: 2,
      value: 2,
      owner: 'a',
      proposedBy: 'b',
      conflictsWith: first.record.id,
    });
    expect(s.versions('k').map((v) => v.status)).toEqual(['proposed', 'proposed']);
  });

  it('uses the supplied equality (exact money compare)', () => {
    const s = store<{ amount: string }>();
    const equals = (a: { amount: string }, b: { amount: string }) =>
      a.amount.replace(/\.?0+$/, '') === b.amount.replace(/\.?0+$/, '');
    s.propose({ key: 'k', value: { amount: '10.50' }, by: 'a', idempotencyKey: 'a1', equals });
    expect(
      s.propose({ key: 'k', value: { amount: '10.5' }, by: 'b', idempotencyKey: 'b1', equals }).kind,
    ).toBe('corroborated');
  });

  it('expectedVersion mismatch is stale and changes nothing', () => {
    const s = store<number>();
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const r = s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1', expectedVersion: 0 });
    expect(r.kind).toBe('stale');
    expect(s.versions('k')).toHaveLength(1);
    expect(s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b2', expectedVersion: 1 }).kind).toBe(
      'conflict',
    );
  });

  it('a repeated idempotency key is a duplicate and changes nothing (safe retries)', () => {
    const s = store<number>();
    const events: ClaimEvent[] = [];
    s.onChange((e) => events.push(e));
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'x' });
    const r = s.propose({ key: 'k', value: 99, by: 'a', idempotencyKey: 'x' });
    expect(r.kind).toBe('duplicate');
    expect(s.get('k')?.value).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('after a contest the producer can propose a corrected value as a fresh claim', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('expected claim');
    s.setStatus('k', a.record.id, 'contested', 'verifier', 'NOT_SUPPORTED_BY_SOURCE');
    const r = s.propose({ key: 'k', value: 2, by: 'a', idempotencyKey: 'a2' });
    expect(r.kind).toBe('claimed');
    if (r.kind === 'claimed') expect(r.record.version).toBe(2);
  });
});

describe('status and supersede', () => {
  it('only one verified record per key: verifying a new version supersedes the old one', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const b = s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1' });
    if (a.kind !== 'claimed' || b.kind !== 'conflict') throw new Error('setup');
    s.setStatus('k', a.record.id, 'verified', 'v');
    s.setStatus('k', b.proposed.id, 'verified', 'v');
    expect(s.versions('k').map((r) => r.status)).toEqual(['superseded', 'verified']);
    expect(s.get('k')?.value).toBe(2);
  });

  it('supersede replaces a record with a new version and keeps history', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('setup');
    const next = s.supersede('k', a.record.id, { value: 3, by: 'a', idempotencyKey: 'a2' });
    expect(next.version).toBe(2);
    expect(s.getById(a.record.id)?.status).toBe('superseded');
    expect(s.getById(a.record.id)?.history.map((h) => h.type)).toEqual(['claimed', 'superseded']);
  });

  it('a superseded record cannot change status', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('setup');
    s.supersede('k', a.record.id, { value: 3, by: 'a', idempotencyKey: 'a2' });
    expect(() => s.setStatus('k', a.record.id, 'verified', 'v')).toThrow(/superseded/);
  });

  it('unknown record ids are refused', () => {
    const s = store<number>();
    expect(() => s.setStatus('k', 'nope', 'verified', 'v')).toThrow(/No claim/);
  });

  it('onChange listeners receive every event synchronously and can unsubscribe', () => {
    const s = store<number>();
    const seen: string[] = [];
    const off = s.onChange((e) => seen.push(`${e.type}:${e.status}`));
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('setup');
    s.setStatus('k', a.record.id, 'verified', 'v');
    off();
    s.propose({ key: 'k', value: 1, by: 'b', idempotencyKey: 'b1' });
    expect(seen).toEqual(['claimed:proposed', 'status:verified']);
  });
});

describe('jsonEquals', () => {
  it('ignores key order and undefined fields', () => {
    expect(jsonEquals({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1, d: undefined })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('review regressions', () => {
  it('idempotency keys are scoped per claim key', () => {
    const s = store<number>();
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'same' });
    const r = s.propose({ key: 'other', value: 2, by: 'a', idempotencyKey: 'same' });
    expect(r.kind).toBe('claimed');
    expect(s.get('other')?.value).toBe(2);
  });

  it('compare-and-set uses the version get() returns, so a verified v1 with a pending v2 is not stale', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('setup');
    s.setStatus('k', a.record.id, 'verified', 'v');
    s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1' });
    const cur = s.get('k');
    expect(cur?.version).toBe(1);
    const r = s.propose({ key: 'k', value: 3, by: 'c', idempotencyKey: 'c1', expectedVersion: cur?.version });
    expect(r.kind).toBe('conflict');
  });

  it('expectedVersion on an unclaimed key: 0 claims, anything else is stale with no current record', () => {
    const s = store<number>();
    expect(s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1', expectedVersion: 3 })).toEqual({
      kind: 'stale',
      current: undefined,
    });
    expect(s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a2', expectedVersion: 0 }).kind).toBe(
      'claimed',
    );
  });

  it('get() prefers an active version over a newer contested one', () => {
    const s = store<number>();
    s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const b = s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1' });
    if (b.kind !== 'conflict') throw new Error('setup');
    s.setStatus('k', b.proposed.id, 'contested', 'v');
    expect(s.get('k')?.value).toBe(1);
  });

  it('superseding a record twice is refused, so only one active replacement exists', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    if (a.kind !== 'claimed') throw new Error('setup');
    s.supersede('k', a.record.id, { value: 2, by: 'a', idempotencyKey: 'a2' });
    expect(() => s.supersede('k', a.record.id, { value: 3, by: 'a', idempotencyKey: 'a3' })).toThrow(
      ClaimError,
    );
    expect(s.versions('k').filter(isActive)).toHaveLength(1);
  });

  it('a throwing listener cannot leave a half-applied status change', () => {
    const s = store<number>();
    const a = s.propose({ key: 'k', value: 1, by: 'a', idempotencyKey: 'a1' });
    const b = s.propose({ key: 'k', value: 2, by: 'b', idempotencyKey: 'b1' });
    if (a.kind !== 'claimed' || b.kind !== 'conflict') throw new Error('setup');
    s.setStatus('k', a.record.id, 'verified', 'v');
    s.onChange((e) => {
      if (e.type === 'superseded') throw new Error('listener failed');
    });
    expect(() => s.setStatus('k', b.proposed.id, 'verified', 'v')).toThrow(ListenerError);
    expect(s.versions('k').map((r) => r.status)).toEqual(['superseded', 'verified']);
  });
});

describe('properties under random interleavings', () => {
  type Op =
    | { t: 'propose'; key: number; value: number; by: number; idem: number; expect: number | null }
    | { t: 'status'; key: number; pick: number; status: ClaimStatus }
    | { t: 'supersede'; key: number; pick: number; value: number; idem: number };

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      t: fc.constant('propose' as const),
      key: fc.integer({ min: 0, max: 3 }),
      value: fc.integer({ min: 0, max: 3 }),
      by: fc.integer({ min: 0, max: 4 }),
      idem: fc.integer({ min: 0, max: 40 }),
      expect: fc.option(fc.integer({ min: 0, max: 4 })),
    }),
    fc.record({
      t: fc.constant('supersede' as const),
      key: fc.integer({ min: 0, max: 3 }),
      pick: fc.nat(),
      value: fc.integer({ min: 0, max: 3 }),
      idem: fc.integer({ min: 41, max: 80 }),
    }),
    fc.record({
      t: fc.constant('status' as const),
      key: fc.integer({ min: 0, max: 3 }),
      pick: fc.nat(),
      status: fc.constantFrom<ClaimStatus>('verified', 'contested', 'needs_user'),
    }),
  );

  it('no lost proposal, at most one verified per key, complete history', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const s = store<number>();
        const events: ClaimEvent[] = [];
        s.onChange((e) => events.push(e));
        const accepted: Array<{ idem: string; key: string; value: number }> = [];
        for (const o of ops) {
          const key = `k${o.key}`;
          if (o.t === 'propose') {
            const idem = `i${o.idem}`;
            const before = s.get(key)?.version ?? 0;
            const r = s.propose({
              key,
              value: o.value,
              by: `p${o.by}`,
              idempotencyKey: idem,
              ...(o.expect !== null ? { expectedVersion: o.expect } : {}),
            });
            if (r.kind === 'stale') expect(o.expect).not.toBe(before);
            if (r.kind !== 'duplicate' && r.kind !== 'stale') accepted.push({ idem, key, value: o.value });
          } else if (o.t === 'supersede') {
            const live = s.versions(key).filter(isActive);
            const target = live[o.pick % Math.max(1, live.length)];
            if (target) {
              const rec = s.supersede(key, target.id, {
                value: o.value,
                by: 'p9',
                idempotencyKey: `i${o.idem}`,
              });
              expect(rec.key).toBe(key);
            }
          } else {
            const live = s.versions(key).filter((r) => r.status !== 'superseded');
            const target = live[o.pick % Math.max(1, live.length)];
            if (target) s.setStatus(key, target.id, o.status, 'v');
          }
        }
        // Idempotency is per key: every record lives on its own key's version list.
        for (const r of s.all()) expect(s.versions(r.key)).toContain(r);
        // No lost proposal: every accepted proposal's value is held by some version of its key.
        for (const a of accepted) {
          expect(s.versions(a.key).some((r) => r.value === a.value)).toBe(true);
        }
        // At most one verified per key.
        for (const k of new Set(s.all().map((r) => r.key))) {
          expect(s.versions(k).filter((r) => r.status === 'verified').length).toBeLessThanOrEqual(1);
          // Proposed records on a key never share a value (corroboration instead of duplicates).
          const active = s
            .versions(k)
            .filter((r) => r.status === 'proposed')
            .map((r) => r.value);
          expect(new Set(active).size).toBe(active.length);
        }
        // Complete history: every emitted event is in its record's history, in order.
        for (const r of s.all()) {
          expect(r.history).toEqual(events.filter((e) => e.recordId === r.id));
          expect(r.history[r.history.length - 1]?.status ?? r.status).toBe(r.status);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
