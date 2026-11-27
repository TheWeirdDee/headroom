// In-memory test double of HrRuntime (no Mozaik). Same contract as the Mozaik adapter, including the
// Mozaik 6.0.0 loop semantics it mirrors: only the first function call of a model step runs, loops are
// not awaited by the caller, and handlers run through ordered mailboxes. Used by contract tests only.
import { Mailbox } from '../mailbox.ts';
import { installBoardMirror } from '../board-mirror.ts';
import { DEFAULT_RETRY, withRetry } from '../loop.ts';
import { unsourcedVeto } from '../veto.ts';
import type { HeadroomState } from '../state.ts';
import type {
  EventFilter,
  HrEvent,
  HrHandler,
  HrInferenceRequest,
  HrParticipant,
  HrRuntime,
  InferenceObserver,
  LoopHandle,
  LoopInput,
  LoopMetric,
  LoopResult,
  ModelBackend,
} from '../types.ts';

export interface MemoryAdapterOptions {
  state: HeadroomState;
  backend: ModelBackend;
  observer?: InferenceObserver;
  newEventId: () => string;
  now?: () => number;
  defaultLoopTimeoutMs: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createMemoryRuntime(opts: MemoryAdapterOptions): HrRuntime {
  const now = opts.now ?? ((): number => Date.now());
  const state = opts.state;
  const mailboxes = new Map<string, Mailbox>();
  const metrics = new Map<string, LoopMetric>();
  let loopSeq = 0;

  function publish(type: string, producerId: string, payload: unknown): HrEvent {
    const event: HrEvent = {
      eventId: opts.newEventId(),
      runId: state.runId,
      type,
      producerId,
      occurredAt: new Date(now()).toISOString(),
      payload,
    };
    for (const mb of mailboxes.values()) mb.deliver(event);
    return event;
  }

  async function runLoop(input: LoopInput, metric: LoopMetric): Promise<LoopResult> {
    const transcript: HrInferenceRequest['transcript'] = [];
    for (let step = 0; step < 16; step++) {
      const request: HrInferenceRequest = {
        agentId: input.agentId,
        loopInputKey: input.loopInputKey,
        step,
        model: input.model,
        promptHash: input.promptHash,
        schemaHash: input.schemaHash,
        system: input.system,
        user: input.user,
        transcript: [...transcript],
        toolNames: input.tools.map((t) => t.name),
        structuredOutput: input.structuredOutput !== undefined,
      };
      const t0 = now();
      const response = await withRetry(() => opts.backend.infer(request), {
        ...DEFAULT_RETRY,
        retries: opts.maxRetries ?? DEFAULT_RETRY.retries,
        timeoutMs: input.timeoutMs ?? opts.defaultLoopTimeoutMs,
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      });
      metric.tokensIn += response.tokensIn;
      metric.tokensOut += response.tokensOut;
      opts.observer?.onResponse?.(request, response, now() - t0);
      const call = response.items.find((i) => i.type === 'function_call');
      if (call && call.type === 'function_call') {
        const veto = unsourcedVeto(call.name, call.args);
        const args = veto ? JSON.stringify({ __vetoed: veto }) : call.args;
        if (veto) {
          state.vetoedWrites.push({ agentId: input.agentId, reason: veto });
          publish('hr.write.vetoed', 'verifier', {
            agentId: input.agentId,
            loopId: metric.loopId,
            reason: veto,
          });
        }
        const tool = input.tools.find((t) => t.name === call.name);
        let output: string;
        if (!tool) output = `Error: unknown tool "${call.name}"`;
        else {
          metric.toolCalls += 1;
          try {
            output = await tool.invoke(JSON.parse(args));
          } catch (e) {
            output = `Error calling tool: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        transcript.push(
          { type: 'function_call', name: call.name, args },
          { type: 'function_call_output', output },
        );
        continue;
      }
      const msg = response.items.find((i) => i.type === 'message');
      return {
        loopId: metric.loopId,
        status: 'completed',
        answer: msg && msg.type === 'message' ? msg.text : '',
        toolCalls: metric.toolCalls,
        tokensIn: metric.tokensIn,
        tokensOut: metric.tokensOut,
      };
    }
    throw new Error('Loop exceeded 16 steps');
  }

  const unmirror = installBoardMirror(state, publish);

  return {
    runId: state.runId,
    state,
    publish,
    on(participantId: string, filter: EventFilter, handler: HrHandler): void {
      const mb = mailboxes.get(participantId);
      if (!mb) throw new Error(`Participant ${participantId} has not joined`);
      mb.subscribe(filter, handler);
    },
    join(p: HrParticipant): void {
      if (mailboxes.has(p.id)) return;
      mailboxes.set(
        p.id,
        new Mailbox(p.id, ({ participantId, event, error }) => {
          const err = error instanceof Error ? error : new Error(String(error));
          publish('hr.participant.error', 'runtime', {
            participantId,
            eventId: event.eventId,
            eventType: event.type,
            message: err.message,
          });
        }),
      );
      publish('participant.joined', p.id, { id: p.id, name: p.name });
    },
    startLoop(input: LoopInput): LoopHandle {
      if (!mailboxes.has(input.agentId)) throw new Error(`Agent ${input.agentId} has not joined`);
      const loopId = `${input.agentId}#${++loopSeq}`;
      const metric: LoopMetric = {
        loopId,
        agentId: input.agentId,
        loopInputKey: input.loopInputKey,
        startedAt: now(),
        status: 'running',
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: 0,
      };
      metrics.set(loopId, metric);
      publish('hr.loop.started', input.agentId, {
        loopId,
        agentId: input.agentId,
        loopInputKey: input.loopInputKey,
        startedAt: metric.startedAt,
      });
      const done = runLoop(input, metric).then(
        (r) => {
          metric.status = 'completed';
          metric.endedAt = now();
          publish('hr.loop.finished', input.agentId, { ...metric });
          return r;
        },
        (e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          metric.status = 'failed';
          metric.endedAt = now();
          metric.error = error;
          publish('hr.loop.failed', input.agentId, { ...metric });
          return {
            loopId,
            status: 'failed' as const,
            error,
            toolCalls: metric.toolCalls,
            tokensIn: metric.tokensIn,
            tokensOut: metric.tokensOut,
          };
        },
      );
      return { loopId, agentId: input.agentId, startedAt: metric.startedAt, done };
    },
    activity() {
      let queuedEvents = 0;
      let busyMailboxes = 0;
      for (const mb of mailboxes.values()) {
        queuedEvents += mb.queued;
        if (mb.busy) busyMailboxes += 1;
      }
      return {
        runningLoops: [...metrics.values()].filter((m) => m.status === 'running').length,
        queuedEvents,
        busyMailboxes,
      };
    },
    loopMetrics: () => [...metrics.values()].map((m) => ({ ...m })),
    async shutdown(): Promise<void> {
      unmirror();
      await Promise.all([...mailboxes.values()].map((m) => m.idle()));
    },
  };
}
