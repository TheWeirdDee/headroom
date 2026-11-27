import { describe, expect, it } from 'vitest';
import { isQuiet, waitForQuiescence, type ActivityProbe } from '../../src/engine/quiescence.ts';
import { SecretLeakError, serializeEvent, serializeValue } from '../../src/engine/serialize.ts';
import { requestHash } from '../../src/runtime/request-hash.ts';
import { unsourcedVeto } from '../../src/runtime/veto.ts';
import { isTransient, TimeoutError, withRetry } from '../../src/runtime/loop.ts';
import { TransientError, type HrInferenceRequest } from '../../src/runtime/types.ts';

const busy: ActivityProbe = {
  runningLoops: 1,
  queuedEvents: 0,
  busyMailboxes: 0,
  proposedFigures: 0,
  pendingHttp: 0,
};
const quiet: ActivityProbe = {
  runningLoops: 0,
  queuedEvents: 0,
  busyMailboxes: 0,
  proposedFigures: 0,
  pendingHttp: 0,
};

describe('quiescence', () => {
  it('needs every counter at zero', () => {
    expect(isQuiet(quiet)).toBe(true);
    for (const k of Object.keys(quiet) as Array<keyof ActivityProbe>)
      expect(isQuiet({ ...quiet, [k]: 1 })).toBe(false);
  });

  it('waits for continuous quiet and restarts the window when activity resumes', async () => {
    const seq = [busy, quiet, quiet, busy, quiet, quiet, quiet, quiet];
    let i = 0;
    // A clock that moves 5 ms per probe, so the result does not depend on the system's timer resolution.
    const r = await waitForQuiescence(
      {
        probe: () => seq[Math.min(i++, seq.length - 1)] ?? quiet,
        quietMs: 20,
        intervalMs: 1,
        now: () => i * 5,
      },
      2000,
    );
    expect(r).toBe('quiet');
    expect(i).toBeGreaterThanOrEqual(8);
  });

  it('times out when never quiet', async () => {
    expect(await waitForQuiescence({ probe: () => busy, quietMs: 10, intervalMs: 5 }, 40)).toBe('timeout');
  });
});

describe('allowlist serializer', () => {
  const ev = {
    eventId: 'e1',
    runId: 'r',
    type: 'hr.x',
    producerId: 'p',
    occurredAt: '2026-11-26T10:00:00.000Z',
    payload: { a: 1 },
  };

  it('keeps only allowlisted event fields', () => {
    const withExtra = { ...ev, env: { HOME: '/root' } } as typeof ev;
    expect(JSON.parse(serializeEvent(withExtra))).toEqual(ev);
  });

  it('refuses anything that looks like a credential', () => {
    expect(() => serializeEvent({ ...ev, payload: { note: 'key sk-ant-abcdefghijklmnop' } })).toThrow(
      SecretLeakError,
    );
    expect(() => serializeValue({ headers: { 'x-api-key': 'abc' } })).toThrow(SecretLeakError);
    expect(() => serializeValue({ text: 'ANTHROPIC_API_KEY=abc' })).toThrow(SecretLeakError);
    expect(() => serializeValue({ text: `key ${'AIza'}${'x'.repeat(35)}` })).toThrow(SecretLeakError);
    expect(() => serializeValue({ h: 'x-goog-api-key: abc' })).toThrow(SecretLeakError);
    expect(serializeValue({ text: 'Faktura 2026-041' })).toBe('{"text":"Faktura 2026-041"}');
  });

  it('lets ordinary invoice and contract wording through', () => {
    for (const text of [
      'IT risk-assessment services',
      'Desk-research and task-automation',
      'Payment authorization: John Smith',
      'API key: integration and rotation',
    ])
      expect(serializeValue({ text })).toBe(JSON.stringify({ text }));
    expect(() => serializeValue({ h: 'Authorization: Bearer abc.def' })).toThrow(SecretLeakError);
    expect(() => serializeValue({ text: `gsk_${'a1'.repeat(20)}` })).toThrow(SecretLeakError);
    expect(() => serializeValue({ text: `apiKey: "${'a1'.repeat(10)}"` })).toThrow(SecretLeakError);
  });
});

describe('requestHash', () => {
  const base: HrInferenceRequest = {
    agentId: 'invoice-reader',
    loopInputKey: 'doc:inv-041.pdf',
    step: 0,
    model: 'claude-sonnet-5-5',
    promptHash: 'p',
    schemaHash: 's',
    system: 'sys',
    user: 'text',
    transcript: [],
    toolNames: ['post_figures'],
    structuredOutput: false,
  };

  it('depends on the loop input, not on anything that varies between runs', () => {
    expect(requestHash(base)).toBe(requestHash({ ...base }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, loopInputKey: 'doc:other.pdf' }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, step: 1 }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, model: 'claude-haiku-4-5' }));
  });
});

describe('veto and retry helpers', () => {
  it('vetoes submit calls whose values carry no evidence, and nothing else', () => {
    expect(unsourcedVeto('submit_invoice', '{"amount":{"value":"1","excerpt":" "}}')).toBe(
      'amount has a value but no excerpt',
    );
    expect(
      unsourcedVeto('submit_invoice', '{"amount":{"value":"1","excerpt":"Iznos: 1,00"},"supplyDate":null}'),
    ).toBeUndefined();
    expect(
      unsourcedVeto('submit_rows', '{"rows":[{"index":1,"invoiceNumber":"2026-001","reasonExcerpt":""}]}'),
    ).toBe('rows[0] names an invoice without citing the row text');
    expect(
      unsourcedVeto('submit_rows', '{"rows":[{"index":1,"invoiceNumber":null,"reasonExcerpt":""}]}'),
    ).toBeUndefined();
    expect(
      unsourcedVeto('submit_criteria', '{"criteria":[{"n":1,"value":"met","field":"","fieldValue":"x"}]}'),
    ).toBe('criteria[0] gives a criterion without citing a contract field');
    expect(unsourcedVeto('other_tool', '{"amount":{"value":"1","excerpt":""}}')).toBeUndefined();
    expect(unsourcedVeto('submit_invoice', 'not json')).toBeUndefined();
  });

  it('classifies transient errors', () => {
    expect(isTransient(new TransientError('x'))).toBe(true);
    expect(isTransient(new TimeoutError(5))).toBe(true);
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 400 })).toBe(false);
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient(new Error('bad'))).toBe(false);
  });

  it('times out a hung call and backs off 1 s then 4 s', async () => {
    const waits: number[] = [];
    await expect(
      withRetry(() => new Promise<never>(() => {}), {
        timeoutMs: 5,
        retries: 2,
        backoffMs: [1000, 4000],
        sleep: async (ms) => void waits.push(ms),
      }),
    ).rejects.toThrow(TimeoutError);
    expect(waits).toEqual([1000, 4000]);
  });
});
