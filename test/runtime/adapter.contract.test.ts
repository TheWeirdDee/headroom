// The same contract runs against the Mozaik adapter (@mozaik-ai/core 6.0.0 with a scripted inference
// runner) and the in-memory test double, so a package change shows up here, not in a broken demo.
import { describe, expect, it } from 'vitest';
import {
  call,
  loopInput,
  makeRuntime,
  makeState,
  msg,
  observe,
  scripted,
  tick,
  type AdapterKind,
} from '../helpers/runtime.ts';
import { TransientError, type HrTool } from '../../src/runtime/types.ts';

function recordingTool(name = 'post_figures'): HrTool & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name,
    description: 'test tool',
    parameters: { type: 'object', properties: {}, additionalProperties: true },
    calls,
    async invoke(args: unknown) {
      calls.push(args);
      return 'accepted';
    },
  };
}

for (const kind of ['mozaik', 'memory'] as AdapterKind[]) {
  describe(`adapter contract: ${kind}`, () => {
    it('delivers published events in order to joined participants, filtered by type and producer', async () => {
      const rt = makeRuntime(
        kind,
        scripted(() => msg('x')),
      );
      const got: string[] = [];
      rt.join({ id: 'a', name: 'a', kind: 'agent' });
      rt.on('a', { types: ['hr.test.*'], notProducerId: 'a' }, (e) => {
        got.push(`${e.type}:${(e.payload as { n: number }).n}`);
      });
      rt.publish('hr.test.one', 'b', { n: 1 });
      rt.publish('hr.other', 'b', { n: 2 });
      rt.publish('hr.test.two', 'a', { n: 3 });
      rt.publish('hr.test.three', 'b', { n: 4 });
      await rt.shutdown();
      expect(got).toEqual(['hr.test.one:1', 'hr.test.three:4']);
    });

    it('drops lifecycle events unless asked for them', async () => {
      const rt = makeRuntime(
        kind,
        scripted(() => msg('x')),
      );
      const plain: string[] = [];
      rt.join({ id: 'a', name: 'a', kind: 'agent' });
      rt.on('a', {}, (e) => {
        plain.push(e.type);
      });
      rt.join({ id: 'b', name: 'b', kind: 'human' });
      rt.publish('hr.ping', 'b', {});
      await rt.shutdown();
      expect(plain).toEqual(['hr.ping']);
    });

    it('turns a handler error into hr.participant.error and keeps the mailbox running', async () => {
      const rt = makeRuntime(
        kind,
        scripted(() => msg('x')),
      );
      const seen = observe(rt);
      const handled: number[] = [];
      rt.join({ id: 'a', name: 'a', kind: 'agent' });
      rt.on('a', { types: ['hr.job'] }, async (e) => {
        const n = (e.payload as { n: number }).n;
        if (n === 1) throw new Error('boom');
        handled.push(n);
      });
      rt.publish('hr.job', 'x', { n: 1 });
      rt.publish('hr.job', 'x', { n: 2 });
      await tick(10);
      await rt.shutdown();
      expect(handled).toEqual([2]);
      const err = seen.find((e) => e.type === 'hr.participant.error');
      expect(err?.payload).toMatchObject({ participantId: 'a', eventType: 'hr.job', message: 'boom' });
    });

    it('runs handlers of one participant one at a time, in order, awaited', async () => {
      const rt = makeRuntime(
        kind,
        scripted(() => msg('x')),
      );
      const log: string[] = [];
      rt.join({ id: 'a', name: 'a', kind: 'agent' });
      rt.on('a', { types: ['hr.job'] }, async (e) => {
        const n = (e.payload as { n: number }).n;
        log.push(`start ${n}`);
        await tick(5 - n);
        log.push(`end ${n}`);
      });
      for (const n of [1, 2, 3]) rt.publish('hr.job', 'x', { n });
      await tick(30);
      await rt.shutdown();
      expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
    });

    it('runs a loop: tool call, tool output back to the model, final answer, metrics and loop events', async () => {
      const backend = scripted((req) =>
        req.step === 0 ? call('post_figures', { figures: [{ sources: [{}] }] }, 100, 20) : msg('done', 50, 3),
      );
      const rt = makeRuntime(kind, backend);
      const seen = observe(rt);
      rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
      const tool = recordingTool();
      const handle = rt.startLoop(loopInput('reader', { tools: [tool] }));
      const result = await handle.done;
      await rt.shutdown();
      expect(result).toMatchObject({
        status: 'completed',
        answer: 'done',
        toolCalls: 1,
        tokensIn: 150,
        tokensOut: 23,
      });
      expect(tool.calls).toEqual([{ figures: [{ sources: [{}] }] }]);
      expect(backend.requests.map((r) => r.step)).toEqual([0, 1]);
      expect(backend.requests[1]?.transcript).toEqual([
        {
          type: 'function_call',
          name: 'post_figures',
          args: JSON.stringify({ figures: [{ sources: [{}] }] }),
        },
        { type: 'function_call_output', output: 'accepted' },
      ]);
      expect(seen.filter((e) => e.type.startsWith('hr.loop.')).map((e) => e.type)).toEqual([
        'hr.loop.started',
        'hr.loop.finished',
      ]);
      expect(rt.loopMetrics()[0]).toMatchObject({ agentId: 'reader', status: 'completed', toolCalls: 1 });
    });

    it('V3: executes only the first function call when a model returns two in one step', async () => {
      const backend = scripted((req) =>
        req.step === 0
          ? {
              items: [
                { type: 'function_call', name: 'first', args: '{}' },
                { type: 'function_call', name: 'second', args: '{}' },
              ],
              tokensIn: 1,
              tokensOut: 1,
            }
          : msg('done'),
      );
      const rt = makeRuntime(kind, backend);
      rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
      const first = recordingTool('first');
      const second = recordingTool('second');
      const result = await rt.startLoop(loopInput('reader', { tools: [first, second] })).done;
      await rt.shutdown();
      expect(result.status).toBe('completed');
      expect(first.calls).toHaveLength(1);
      expect(second.calls).toHaveLength(0);
    });

    it('reports a failed loop (non-transient error) without crashing and without retrying', async () => {
      const backend = scripted(() => {
        throw new Error('invalid request');
      });
      const rt = makeRuntime(kind, backend);
      const seen = observe(rt);
      rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
      const result = await rt.startLoop(loopInput('reader')).done;
      await tick(5);
      await rt.shutdown();
      expect(result).toMatchObject({ status: 'failed' });
      expect(result.error).toContain('invalid request');
      expect(backend.requests).toHaveLength(1);
      expect(seen.some((e) => e.type === 'hr.loop.failed')).toBe(true);
    });

    it('retries transient errors at most twice', async () => {
      let n = 0;
      const flaky = scripted(() => {
        n += 1;
        if (n <= 2) throw new TransientError('429');
        return msg('ok');
      });
      const rt = makeRuntime(kind, flaky);
      rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
      expect(await rt.startLoop(loopInput('reader')).done).toMatchObject({
        status: 'completed',
        answer: 'ok',
      });

      const always = scripted(() => {
        throw new TransientError('503');
      });
      const rt2 = makeRuntime(kind, always);
      rt2.join({ id: 'reader', name: 'reader', kind: 'agent' });
      expect(await rt2.startLoop(loopInput('reader')).done).toMatchObject({ status: 'failed' });
      expect(always.requests).toHaveLength(3);
      await rt.shutdown();
      await rt2.shutdown();
    });

    it('vetoes a board write without sources before the tool runs', async () => {
      const backend = scripted((req) =>
        req.step === 0
          ? call('submit_invoice', { isInvoice: true, amount: { value: '4000.00', excerpt: '' } })
          : msg('done'),
      );
      const state = makeState();
      const rt = makeRuntime(kind, backend, state);
      rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
      const tool = recordingTool('submit_invoice');
      await rt.startLoop(loopInput('reader', { tools: [tool] })).done;
      await rt.shutdown();
      expect(tool.calls).toEqual([{ __vetoed: 'amount has a value but no excerpt' }]);
      expect(state.vetoedWrites).toEqual([
        { agentId: 'reader', reason: 'amount has a value but no excerpt' },
      ]);
    });

    it('runs loops concurrently: four loops overlap in time', async () => {
      const backend = scripted(async () => {
        await tick(40);
        return msg('ok');
      });
      const rt = makeRuntime(kind, backend);
      for (const id of ['a', 'b', 'c', 'd']) rt.join({ id, name: id, kind: 'agent' });
      const t0 = Date.now();
      const handles = ['a', 'b', 'c', 'd'].map((id) => rt.startLoop(loopInput(id)));
      await tick(10);
      expect(rt.activity().runningLoops).toBe(4);
      await Promise.all(handles.map((h) => h.done));
      const wall = Date.now() - t0;
      await rt.shutdown();
      const m = rt.loopMetrics();
      const sum = m.reduce((s, x) => s + ((x.endedAt ?? 0) - x.startedAt), 0);
      expect(sum / wall).toBeGreaterThan(2.5);
      expect(rt.activity().runningLoops).toBe(0);
    });

    it('mirrors board changes as hr.figure events', async () => {
      const state = makeState();
      const rt = makeRuntime(
        kind,
        scripted(() => msg('x')),
        state,
      );
      const seen = observe(rt);
      const src = [{ type: 'rule' as const, ruleId: 'R-FX', url: 'https://example.test' }];
      const a = state.postFigure({
        key: 'k',
        kind: 'invoice_field',
        value: { t: 'text', text: 'A' },
        sources: src,
        producedBy: 'r1',
        idempotencyKey: 'r1/k',
      });
      state.postFigure({
        key: 'k',
        kind: 'invoice_field',
        value: { t: 'text', text: 'A' },
        sources: src,
        producedBy: 'r2',
        idempotencyKey: 'r2/k',
      });
      state.postFigure({
        key: 'k',
        kind: 'invoice_field',
        value: { t: 'text', text: 'B' },
        sources: src,
        producedBy: 'r3',
        idempotencyKey: 'r3/k',
      });
      state.setFigureStatus(a.figure.id, 'verified', 'verifier', [{ name: 'source_presence', passed: true }]);
      await tick(5);
      await rt.shutdown();
      expect(seen.filter((e) => e.type.startsWith('hr.figure.')).map((e) => e.type)).toEqual([
        'hr.figure.proposed',
        'hr.figure.corroborated',
        'hr.figure.proposed',
        'hr.figure.conflict',
        'hr.figure.verified',
      ]);
      expect(() =>
        state.postFigure({
          key: 'z',
          kind: 'invoice_field',
          value: { t: 'text', text: 'A' },
          sources: [],
          producedBy: 'r1',
          idempotencyKey: 'r1/z',
        }),
      ).toThrow(/at least one source/);
    });
  });
}

describe('Mozaik adapter specifics', () => {
  it('forces Mozaik Cloud telemetry off', () => {
    process.env['MOZAIK_API_KEY'] = 'should-be-removed';
    makeRuntime(
      'mozaik',
      scripted(() => msg('x')),
    );
    expect(process.env['MOZAIK_API_KEY']).toBeUndefined();
    expect(process.env['MOZAIK_CREDENTIALS_FILE']).toMatch(/nonexistent/);
  });

  it('isolates runs: two runtimes do not see each other’s events', async () => {
    const a = makeRuntime(
      'mozaik',
      scripted(() => msg('x')),
    );
    const b = makeRuntime(
      'mozaik',
      scripted(() => msg('x')),
    );
    const seenB = observe(b);
    a.publish('hr.ping', 'x', {});
    await tick(5);
    expect(seenB.filter((e) => e.type === 'hr.ping')).toHaveLength(0);
    await a.shutdown();
    await b.shutdown();
  });
});

describe('event payloads match the catalogue', () => {
  it('every hr.* event produced in a loop and a board round trip validates', async () => {
    const { validatePayload } = await import('../../src/events/schemas.ts');
    const backend = scripted((req) =>
      req.step === 0 ? call('post_figures', { figures: [{ sources: [{}] }] }) : msg('done'),
    );
    const state = makeState();
    const rt = makeRuntime('mozaik', backend, state);
    const seen = observe(rt);
    rt.join({ id: 'reader', name: 'reader', kind: 'agent' });
    const tool = {
      name: 'post_figures',
      description: 't',
      parameters: { type: 'object' },
      invoke: async () => 'accepted',
    };
    await rt.startLoop(loopInput('reader', { tools: [tool] })).done;
    const src = [{ type: 'rule' as const, ruleId: 'R-FX', url: 'https://example.test/' }];
    const a = state.postFigure({
      key: 'k',
      kind: 'fx_rate',
      value: { t: 'date', iso: '2026-11-20' },
      sources: src,
      producedBy: 'r1',
      idempotencyKey: 'x',
    });
    state.setFigureStatus(a.figure.id, 'contested', 'verifier', [], 'NOT_SUPPORTED_BY_SOURCE: no match');
    await tick(5);
    await rt.shutdown();
    const hr = seen.filter((e) => e.type.startsWith('hr.'));
    expect(hr.length).toBeGreaterThan(3);
    for (const e of hr) expect([e.type, validatePayload(e.type, e.payload)]).toEqual([e.type, { ok: true }]);
  });
});
