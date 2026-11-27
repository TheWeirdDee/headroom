// What Headroom relies on from Mozaik (@mozaik-ai/core 6.0.0), run on the real package with a scripted
// model, so a package change shows up here and not in a broken demo.
import { describe, expect, it } from 'vitest';
import { createHuman } from '@mozaik-ai/core';
import {
  agentNamed,
  call,
  makeRuntime,
  makeState,
  msg,
  observe,
  scripted,
  thinkInput,
  tick,
} from '../helpers/runtime.ts';
import { AboutMyFigure, EventIs } from '../../src/agents/situations.ts';
import { evidenceGate } from '../../src/agents/verifier/gate.ts';
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

describe('situations on Mozaik', () => {
  it('delivers an event only to the participants whose specification it satisfies, in order', async () => {
    const rt = makeRuntime(scripted(() => msg('x')));
    const mine: string[] = [];
    const ones: number[] = [];
    agentNamed(rt, 'a', [
      rt.when(new EventIs('hr.figure.contested').and(new AboutMyFigure()), (e) => {
        mine.push((e.payload as { key: string }).key);
      }),
      rt.when(new EventIs('hr.test'), (e) => {
        ones.push((e.payload as { n: number }).n);
      }),
    ]);
    agentNamed(rt, 'b');
    rt.publish('hr.figure.contested', 'b', { key: 'one', producerId: 'a' });
    rt.publish('hr.figure.contested', 'b', { key: 'two', producerId: 'b' });
    rt.publish('hr.test', 'b', { n: 1 });
    rt.publish('hr.other', 'b', { n: 2 });
    rt.publish('hr.test', 'b', { n: 3 });
    await rt.shutdown();
    expect(mine).toEqual(['one']);
    expect(ones).toEqual([1, 3]);
  });

  it('names the sender of an event and keeps lifecycle events apart', async () => {
    const rt = makeRuntime(scripted(() => msg('x')));
    const seen = observe(rt);
    agentNamed(rt, 'a');
    rt.publish('hr.ping', 'a', {});
    await tick(5);
    await rt.shutdown();
    expect(seen.map((e) => e.type)).toEqual(['participant.joined', 'participant.joined', 'hr.ping']);
    expect(seen.at(-1)?.producerId).toBe('a');
  });

  it('turns a failing reaction into hr.participant.error and goes on with the next', async () => {
    const state = makeState();
    const rt = makeRuntime(
      scripted(() => msg('x')),
      state,
    );
    const seen = observe(rt);
    const handled: number[] = [];
    agentNamed(rt, 'a', [
      rt.when(new EventIs('hr.job'), async (e) => {
        const n = (e.payload as { n: number }).n;
        if (n === 1) throw new Error('boom');
        handled.push(n);
      }),
    ]);
    rt.publish('hr.job', 'x', { n: 1 });
    rt.publish('hr.job', 'x', { n: 2 });
    await tick(10);
    await rt.shutdown();
    expect(handled).toEqual([2]);
    const err = seen.find((e) => e.type === 'hr.participant.error');
    expect(err?.payload).toMatchObject({ participantId: 'a', eventType: 'hr.job', message: 'boom' });
    expect(state.handlerErrors).toEqual(['a: boom']);
  });

  it('runs one participant’s reactions one at a time, in order, awaited', async () => {
    const rt = makeRuntime(scripted(() => msg('x')));
    const log: string[] = [];
    agentNamed(rt, 'a', [
      rt.when(new EventIs('hr.job'), async (e) => {
        const n = (e.payload as { n: number }).n;
        log.push(`start ${n}`);
        await tick(5 - n);
        log.push(`end ${n}`);
      }),
    ]);
    for (const n of [1, 2, 3]) rt.publish('hr.job', 'x', { n });
    await tick(30);
    await rt.shutdown();
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });

  it('refuses a second participant of the same name', async () => {
    const rt = makeRuntime(scripted(() => msg('x')));
    agentNamed(rt, 'a');
    expect(() => agentNamed(rt, 'a')).toThrow(/already joined/);
    await rt.shutdown();
  });
});

describe('agent loops on Mozaik', () => {
  it('runs a loop: tool call, tool output back to the model, final answer, metrics and loop events', async () => {
    const backend = scripted((req) =>
      req.step === 0 ? call('post_figures', { figures: [{ sources: [{}] }] }, 100, 20) : msg('done', 50, 3),
    );
    const rt = makeRuntime(backend);
    const seen = observe(rt);
    const reader = agentNamed(rt, 'reader');
    const tool = recordingTool();
    const result = await rt.think(reader, thinkInput({ tools: [tool] })).done;
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
    // The participant's own instruction is the system prompt.
    expect(backend.requests[0]).toMatchObject({ agentId: 'reader', system: 'You are a test agent.' });
    expect(backend.requests[1]?.transcript).toEqual([
      { type: 'function_call', name: 'post_figures', args: JSON.stringify({ figures: [{ sources: [{}] }] }) },
      { type: 'function_call_output', output: 'accepted' },
    ]);
    expect(seen.filter((e) => e.type.startsWith('hr.loop.')).map((e) => e.type)).toEqual([
      'hr.loop.started',
      'hr.loop.finished',
    ]);
    expect(rt.loopMetrics()[0]).toMatchObject({ agentId: 'reader', status: 'completed', toolCalls: 1 });
  });

  it('will not run a loop for an agent that could not hear its answer', async () => {
    const rt = makeRuntime(scripted(() => msg('x')));
    const { createAgent } = await import('@mozaik-ai/core');
    const deaf = createAgent({ name: 'deaf', capabilities: [], instruction: '', tools: [], handlers: [] });
    rt.join(deaf);
    expect(() => rt.think(deaf, thinkInput())).toThrow(/ownLoops/);
    await rt.shutdown();
  });

  it('executes only the first function call when a model returns two in one step', async () => {
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
    const rt = makeRuntime(backend);
    const first = recordingTool('first');
    const second = recordingTool('second');
    const result = await rt.think(agentNamed(rt, 'reader'), thinkInput({ tools: [first, second] })).done;
    await rt.shutdown();
    expect(result.status).toBe('completed');
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it('reports a failed loop (non-transient error) without crashing and without retrying', async () => {
    const backend = scripted(() => {
      throw new Error('invalid request');
    });
    const state = makeState();
    const rt = makeRuntime(backend, state);
    const seen = observe(rt);
    const result = await rt.think(agentNamed(rt, 'reader'), thinkInput()).done;
    await tick(5);
    await rt.shutdown();
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.error).toContain('invalid request');
    expect(backend.requests).toHaveLength(1);
    expect(seen.some((e) => e.type === 'hr.loop.failed')).toBe(true);
    expect(state.failedLoops).toHaveLength(1);
  });

  it('retries transient errors at most twice', async () => {
    let n = 0;
    const flaky = scripted(() => {
      n += 1;
      if (n <= 2) throw new TransientError('429');
      return msg('ok');
    });
    const rt = makeRuntime(flaky);
    expect(await rt.think(agentNamed(rt, 'reader'), thinkInput()).done).toMatchObject({
      status: 'completed',
      answer: 'ok',
    });

    const always = scripted(() => {
      throw new TransientError('503');
    });
    const rt2 = makeRuntime(always);
    expect(await rt2.think(agentNamed(rt2, 'reader'), thinkInput()).done).toMatchObject({ status: 'failed' });
    expect(always.requests).toHaveLength(3);
    await rt.shutdown();
    await rt2.shutdown();
  });

  it('lets the Verifier’s InterceptionHandler refuse an unsourced write before the tool runs', async () => {
    const backend = scripted((req) =>
      req.step === 0
        ? call('submit_invoice', { isInvoice: true, amount: { value: '4000.00', excerpt: '' } })
        : msg('done'),
    );
    const state = makeState();
    const rt = makeRuntime(backend, state);
    const seen = observe(rt);
    agentNamed(rt, 'verifier');
    const tool = recordingTool('submit_invoice');
    await rt.think(
      agentNamed(rt, 'reader'),
      thinkInput({ tools: [tool], gate: evidenceGate(rt, 'verifier') }),
    ).done;
    await tick(5);
    await rt.shutdown();
    expect(tool.calls).toEqual([{ __vetoed: 'amount has a value but no excerpt' }]);
    expect(state.vetoedWrites).toEqual([{ agentId: 'reader', reason: 'amount has a value but no excerpt' }]);
    expect(seen.find((e) => e.type === 'hr.write.vetoed')?.producerId).toBe('verifier');
  });

  it('runs loops concurrently: four agents’ loops overlap in time', async () => {
    const backend = scripted(async () => {
      await tick(40);
      return msg('ok');
    });
    const rt = makeRuntime(backend);
    const agents = ['a', 'b', 'c', 'd'].map((n) => agentNamed(rt, n));
    const t0 = Date.now();
    const handles = agents.map((a) => rt.think(a, thinkInput()));
    await tick(10);
    expect(rt.activity().runningLoops).toBe(4);
    await Promise.all(handles.map((h) => h.done));
    const wall = Date.now() - t0;
    await rt.shutdown();
    const sum = rt.loopMetrics().reduce((s, x) => s + ((x.endedAt ?? 0) - x.startedAt), 0);
    expect(sum / wall).toBeGreaterThan(2.5);
    expect(rt.activity().runningLoops).toBe(0);
  });
});

describe('the board as RuntimeState', () => {
  it('is the state Mozaik keeps its participants in', async () => {
    const state = makeState();
    const rt = makeRuntime(
      scripted(() => msg('x')),
      state,
    );
    rt.join(createHuman({ name: 'someone', capabilities: [], handlers: [] }));
    expect(rt.state).toBe(state);
    expect(state.getParticipants().map((p) => p.getManifest().name)).toEqual(['runtime', 'someone']);
    await rt.shutdown();
  });

  it('announces board changes as hr.figure events', async () => {
    const state = makeState();
    const rt = makeRuntime(
      scripted(() => msg('x')),
      state,
    );
    const seen = observe(rt);
    const src = [{ type: 'rule' as const, ruleId: 'R-FX', url: 'https://example.test' }];
    const post = (value: string, by: string) =>
      state.postFigure({
        key: 'k',
        kind: 'invoice_field',
        value: { t: 'text', text: value },
        sources: src,
        producedBy: by,
        idempotencyKey: `${by}/k`,
      });
    const a = post('A', 'r1');
    post('A', 'r2');
    post('B', 'r3');
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

describe('runtime specifics', () => {
  it('keeps Mozaik Cloud off', async () => {
    process.env['MOZAIK_API_KEY'] = 'should-be-removed';
    const rt = makeRuntime(scripted(() => msg('x')));
    expect(process.env['MOZAIK_API_KEY']).toBeUndefined();
    expect(process.env['MOZAIK_CREDENTIALS_FILE']).toMatch(/nonexistent/);
    await rt.shutdown();
  });

  it('isolates runs: two runtimes do not see each other’s events', async () => {
    const a = makeRuntime(scripted(() => msg('x')));
    const b = makeRuntime(scripted(() => msg('x')));
    const seenB = observe(b);
    a.publish('hr.ping', 'x', {});
    await tick(5);
    expect(seenB.filter((e) => e.type === 'hr.ping')).toHaveLength(0);
    await a.shutdown();
    await b.shutdown();
  });

  it('produces event payloads that match the catalogue', async () => {
    const { validatePayload } = await import('../../src/events/schemas.ts');
    const backend = scripted((req) =>
      req.step === 0 ? call('post_figures', { figures: [{ sources: [{}] }] }) : msg('done'),
    );
    const state = makeState();
    const rt = makeRuntime(backend, state);
    const seen = observe(rt);
    await rt.think(agentNamed(rt, 'reader'), thinkInput({ tools: [recordingTool()] })).done;
    const a = state.postFigure({
      key: 'k',
      kind: 'fx_rate',
      value: { t: 'date', iso: '2026-11-20' },
      sources: [{ type: 'rule', ruleId: 'R-FX', url: 'https://example.test/' }],
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
