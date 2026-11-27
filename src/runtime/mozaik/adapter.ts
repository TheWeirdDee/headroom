// The ONLY module that imports Mozaik (@mozaik-ai/core 6.0.0). Implements HrRuntime on Mozaik's
// runtime: defineRuntime/initializeRuntime per run, RuntimeState subclass holding the Figure Board,
// createAgent/createHuman participants with situation handlers, runLoop for every agent loop, a custom
// InferenceRunner (timeouts, retries, replay, recording) and an InterceptionHandler that vetoes board
// writes without sources. Workarounds for the behaviour read in the 6.0.0 source are marked GAP.
import {
  createAgent,
  createHuman,
  defineRuntime,
  DeveloperMessageItem,
  FunctionCallItem,
  FunctionCallOutputItem,
  InputTokenDetails,
  ModelContext,
  ModelMessageItem,
  OutputTokenDetails,
  RuntimeState,
  SemanticEvent,
  SituationSpecification,
  supportedModels,
  TokenUsage,
  type ExecutableTransition,
  type Tool,
  type InferenceInput,
  type InferenceOutput,
  type InferenceRunner,
  type InterceptionHandler,
  type Participant,
  type SituationContext,
} from '@mozaik-ai/core';
import { Mailbox } from '../mailbox.ts';
import { unsourcedVeto } from '../veto.ts';
import { patchGeminiSignatures } from './gemini-signatures.ts';
import { groqInfer, isGroqModel } from './groq.ts';
import { installBoardMirror } from '../board-mirror.ts';
import { DEFAULT_RETRY, withRetry } from '../loop.ts';
import { acquire as paceRequest, pacerRpm } from '../pacer.ts';
import type { HeadroomState } from '../state.ts';
import {
  type EventFilter,
  type HrEvent,
  type HrHandler,
  type HrInferenceRequest,
  type HrInferenceResponse,
  type HrParticipant,
  type HrRuntime,
  type InferenceObserver,
  type LoopHandle,
  type LoopInput,
  type LoopMetric,
  type LoopResult,
  type ModelBackend,
} from '../types.ts';

// ---------------------------------------------------------------------------------------------------
// Mozaik Cloud observability is opt-in: with a Cloud key or credentials file, @mozaik-ai/cloud-sdk sends
// each loop's events, including the agent's context, to Mozaik Cloud. Headroom's agents read the user's
// financial documents, and Headroom promises that only the model provider sees that text, so it keeps
// Cloud off for its runs.
// ---------------------------------------------------------------------------------------------------
export const CLOUD_ENV_VARS = ['MOZAIK_API_KEY', 'MOZAIK_PROJECT_KEY'] as const;

export function disableMozaikCloud(env: NodeJS.ProcessEnv = process.env): void {
  for (const k of CLOUD_ENV_VARS) Reflect.deleteProperty(env, k);
  env['MOZAIK_CREDENTIALS_FILE'] = '/nonexistent/headroom-disables-mozaik-cloud/credentials.json';
  env['MOZAIK_CLOUD_ENDPOINT'] = 'http://127.0.0.1:9/disabled';
}

let warnFilterInstalled = false;
function filterCloudWarnings(): void {
  if (warnFilterInstalled) return;
  warnFilterInstalled = true;
  // The cloud SDK prints a warning for every loop when telemetry is off; drop only that line.
  // eslint-disable-next-line no-console -- wrapping console.warn is the only way to filter the SDK's line
  const original = console.warn.bind(console);
  // eslint-disable-next-line no-console -- see above
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].startsWith('mozaik cloud:')) return;
    original(...args);
  };
}

export const MOZAIK_PACKAGE = { name: '@mozaik-ai/core', version: '6.0.0' } as const;

/** Marker returned as the model answer when inference failed after retries (GAP: runLoop never rejects). */
const FAIL_MARK = '\u0000HEADROOM_INFERENCE_FAILED\u0000';

class HeadroomRuntimeState extends RuntimeState {
  constructor(readonly hr: HeadroomState) {
    super();
  }
}

class EveryEvent extends SituationSpecification {
  isSatisfiedBy(_ctx: SituationContext): boolean {
    return true;
  }
}

interface LoopRecord {
  input: LoopInput;
  metric: LoopMetric;
  context: ModelContext;
  cancelled: boolean;
  resolve: (r: LoopResult) => void;
  timer: NodeJS.Timeout | undefined;
  answered: boolean;
}

export interface MozaikAdapterOptions {
  state: HeadroomState;
  /** Scripted fakes or recorded responses; omit to call the live provider through Mozaik's endpoints. */
  backend?: ModelBackend;
  observer?: InferenceObserver;
  newEventId: () => string;
  now?: () => number;
  defaultLoopTimeoutMs: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The provider's own words for a failed request, on one line and short (HTTP status and message). */
function retryReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const message = /"message"\s*:\s*"([^"]{0,160})/.exec(text)?.[1] ?? text;
  return message.replace(/\s+/g, ' ').slice(0, 160);
}

export function createMozaikRuntime(opts: MozaikAdapterOptions): HrRuntime {
  disableMozaikCloud();
  filterCloudWarnings();
  const now = opts.now ?? ((): number => Date.now());
  const hrState = opts.state;
  const runId = hrState.runId;

  const loopsByContext = new Map<string, LoopRecord>();
  const loopsById = new Map<string, LoopRecord>();
  const mailboxes = new Map<string, Mailbox>();
  const mozaikIdToHr = new Map<string, string>();
  const hrToMozaik = new Map<string, Participant>();
  const converted = new WeakMap<object, HrEvent>();
  let loopSeq = 0;

  // --- inference ------------------------------------------------------------------------------------
  function toRequest(rec: LoopRecord, input: InferenceInput): HrInferenceRequest {
    const transcript: HrInferenceRequest['transcript'] = [];
    for (const item of input.context.getItems()) {
      if (item instanceof FunctionCallItem)
        transcript.push({ type: 'function_call', name: item.name, args: item.args });
      if (item instanceof FunctionCallOutputItem)
        transcript.push({ type: 'function_call_output', output: item.output.text });
    }
    return {
      agentId: rec.input.agentId,
      loopInputKey: rec.input.loopInputKey,
      step: transcript.filter((t) => t.type === 'function_call_output').length,
      model: input.model,
      promptHash: rec.input.promptHash,
      schemaHash: rec.input.schemaHash,
      system: rec.input.system,
      user: rec.input.user,
      transcript,
      toolNames: (input.tools ?? []).map((t) => t.name),
      structuredOutput: input.structuredOutput !== undefined,
    };
  }

  function toMozaikOutput(res: HrInferenceResponse, step: number): InferenceOutput {
    const items = res.items.map((it, i) =>
      it.type === 'function_call'
        ? FunctionCallItem.rehydrate({
            callId: it.callId ?? `call_${step}_${i}`,
            name: it.name,
            args: it.args,
          })
        : ModelMessageItem.rehydrate({ text: it.text }),
    );
    return {
      items,
      tokenUsage: new TokenUsage(
        res.tokensIn,
        res.tokensOut,
        res.tokensIn + res.tokensOut,
        new InputTokenDetails(0),
        new OutputTokenDetails(0),
      ),
      rowResponse: { headroom: 'backend' },
    };
  }

  function fromMozaikOutput(out: InferenceOutput): HrInferenceResponse {
    const items: HrInferenceResponse['items'] = [];
    for (const it of out.items) {
      if (it instanceof FunctionCallItem)
        items.push({ type: 'function_call', name: it.name, args: it.args, callId: it.callId });
      if (it instanceof ModelMessageItem) items.push({ type: 'message', text: it.content.text });
    }
    return {
      items,
      tokensIn: out.tokenUsage?.inputTokens ?? 0,
      tokensOut: out.tokenUsage?.outputTokens ?? 0,
    };
  }

  async function providerInfer(input: InferenceInput): Promise<InferenceOutput> {
    if (isGroqModel(input.model)) return groqInfer(input);
    const model = supportedModels.find((m) => m.specification.name === input.model);
    if (!model)
      throw new Error(
        `Model ${input.model} is not supported by ${MOZAIK_PACKAGE.name} ${MOZAIK_PACKAGE.version}`,
      );
    if (input.structuredOutput && !model.specification.supportsStructuredOutput) {
      throw new Error(`Model ${input.model} does not support structured output`);
    }
    patchGeminiSignatures(model.endpoint);
    return model.endpoint.infer(input);
  }

  const runner: InferenceRunner = {
    async run(input: InferenceInput): Promise<InferenceOutput> {
      const rec = loopsByContext.get(input.context.id);
      if (!rec)
        return {
          items: [ModelMessageItem.rehydrate({ text: `${FAIL_MARK}unknown loop context` })],
          tokenUsage: undefined,
          rowResponse: null,
        };
      if (rec.cancelled)
        return {
          items: [ModelMessageItem.rehydrate({ text: `${FAIL_MARK}loop cancelled` })],
          tokenUsage: undefined,
          rowResponse: null,
        };
      const request = toRequest(rec, input);
      try {
        const t0 = now();
        const answer = async (): Promise<InferenceOutput> => {
          if (opts.backend) return toMozaikOutput(await opts.backend.infer(request), request.step);
          return providerInfer(input);
        };
        const out = opts.backend?.recorded
          ? await answer()
          : await withRetry(answer, {
              ...DEFAULT_RETRY,
              retries: opts.maxRetries ?? DEFAULT_RETRY.retries,
              timeoutMs: rec.input.timeoutMs ?? opts.defaultLoopTimeoutMs,
              ...(opts.sleep ? { sleep: opts.sleep } : {}),
              // Live waits are reported on stderr (agent, attempt, the provider's reason), never with keys.
              ...(!opts.backend
                ? {
                    onRetry: (attempt: number, error: unknown) =>
                      process.stderr.write(
                        `Model request retry ${attempt} for ${rec.input.agentId}: ${retryReason(error)}\n`,
                      ),
                  }
                : {}),
              // Only live provider calls are paced; each granted slot restarts the loop's overall timer, so
              // waiting in the quota queue is never mistaken for a hung loop.
              ...(!opts.backend && pacerRpm() > 0
                ? {
                    before: async () => {
                      await paceRequest(now);
                      rec.timer?.refresh();
                    },
                    rateLimitRetries: 6,
                  }
                : {}),
            });
        const neutral = fromMozaikOutput(out);
        rec.metric.tokensIn += neutral.tokensIn;
        rec.metric.tokensOut += neutral.tokensOut;
        opts.observer?.onResponse(request, neutral, now() - t0);
        // GAP: the loop's TransitionResolver throws (an unhandled rejection) when an output holds neither
        // a function call nor an assistant message (e.g. only reasoning). Guarantee a terminal item.
        const callable = out.items.some(
          (i) => i instanceof FunctionCallItem || i instanceof ModelMessageItem,
        );
        return callable ? out : { ...out, items: [...out.items, ModelMessageItem.rehydrate({ text: '' })] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          items: [ModelMessageItem.rehydrate({ text: `${FAIL_MARK}${message}` })],
          tokenUsage: undefined,
          rowResponse: null,
        };
      }
    },
    async *stream(input: InferenceInput) {
      yield SemanticEvent.create('inference.output', input.model, await runner.run(input));
    },
  };

  // --- runtime --------------------------------------------------------------------------------------
  const {
    initializeRuntime,
    join: mozaikJoin,
    runLoop,
    resolveRuntime,
  } = defineRuntime<HeadroomRuntimeState>();
  initializeRuntime({ state: new HeadroomRuntimeState(hrState), inferenceRunnerConfig: { runner } });

  function publish(type: string, producerId: string, payload: unknown): HrEvent {
    const event: HrEvent = {
      eventId: opts.newEventId(),
      runId,
      type,
      producerId,
      occurredAt: new Date(now()).toISOString(),
      payload,
    };
    const semantic = new SemanticEvent(type, producerId, new Date(now()), event);
    converted.set(semantic, event);
    resolveRuntime().publish(semantic);
    return event;
  }

  function finishLoop(
    rec: LoopRecord,
    status: 'completed' | 'failed',
    answer: string | undefined,
    error?: string,
  ): void {
    if (rec.metric.status !== 'running') return;
    rec.metric.status = status;
    rec.metric.endedAt = now();
    if (error !== undefined) rec.metric.error = error;
    if (rec.timer) clearTimeout(rec.timer);
    rec.cancelled = true;
    if (status === 'failed')
      hrState.failedLoops.push({
        agentId: rec.input.agentId,
        loopId: rec.metric.loopId,
        error: error ?? 'failed',
      });
    const result: LoopResult = {
      loopId: rec.metric.loopId,
      status,
      ...(answer !== undefined ? { answer } : {}),
      ...(error !== undefined ? { error } : {}),
      toolCalls: rec.metric.toolCalls,
      tokensIn: rec.metric.tokensIn,
      tokensOut: rec.metric.tokensOut,
    };
    publish(status === 'completed' ? 'hr.loop.finished' : 'hr.loop.failed', rec.input.agentId, {
      ...rec.metric,
    });
    rec.resolve(result);
  }

  /** Native Mozaik events seen by the runtime itself (loop bookkeeping). */
  function onNative(e: SemanticEvent): void {
    const payload = e.payload as {
      loopId?: string;
      input?: { context?: ModelContext };
      answer?: ModelMessageItem;
    };
    if (e.type === 'message_received.started' && payload.input?.context && payload.loopId) {
      const rec = loopsByContext.get(payload.input.context.id);
      if (rec) loopsById.set(payload.loopId, rec);
    }
    if (e.type === 'model.answer' && payload.loopId) {
      const rec = loopsById.get(payload.loopId);
      if (!rec || rec.answered) return;
      rec.answered = true;
      const text = payload.answer?.content.text ?? '';
      if (text.startsWith(FAIL_MARK)) finishLoop(rec, 'failed', undefined, text.slice(FAIL_MARK.length));
      else finishLoop(rec, 'completed', text);
    }
  }

  function toHrEvent(e: SemanticEvent): HrEvent {
    const known = converted.get(e);
    if (known) return known;
    const p = (e.payload ?? {}) as { loopId?: string };
    const ev: HrEvent = {
      eventId: opts.newEventId(),
      runId,
      type: e.type,
      producerId: mozaikIdToHr.get(e.producerId) ?? e.producerId,
      occurredAt: e.occurredAt.toISOString(),
      // Native payloads hold whole model contexts; only the loop id is forwarded.
      payload: p.loopId ? { loopId: loopsById.get(p.loopId)?.metric.loopId ?? p.loopId } : {},
    };
    converted.set(e, ev);
    return ev;
  }

  const system = createHuman({
    name: 'runtime',
    capabilities: [],
    handlers: [{ specification: new EveryEvent(), processor: { apply: ({ event }) => onNative(event) } }],
  });
  mozaikJoin(system);

  function reportHandlerError(participantId: string, event: HrEvent, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    hrState.handlerErrors.push(`${participantId}: ${err.message}`);
    publish('hr.participant.error', 'runtime', {
      participantId,
      eventId: event.eventId,
      eventType: event.type,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    });
  }

  function join(p: HrParticipant): void {
    if (mailboxes.has(p.id)) return;
    const mailbox = new Mailbox(p.id, ({ participantId, event, error }) =>
      reportHandlerError(participantId, event, error),
    );
    mailboxes.set(p.id, mailbox);
    const handlers = [
      {
        specification: new EveryEvent(),
        processor: { apply: ({ event }: SituationContext) => mailbox.deliver(toHrEvent(event)) },
      },
    ];
    const participant =
      p.kind === 'agent'
        ? createAgent({ name: p.id, capabilities: ['inference'], instruction: '', tools: [], handlers })
        : createHuman({ name: p.id, capabilities: [], handlers });
    mozaikIdToHr.set(participant.getId(), p.id);
    hrToMozaik.set(p.id, participant);
    mozaikJoin(participant);
  }

  function interception(rec: LoopRecord): InterceptionHandler {
    return {
      isSatisfiedBy(t: ExecutableTransition): boolean {
        return t.nextStateId === 'function_call';
      },
      async handle(t: ExecutableTransition): Promise<ExecutableTransition> {
        if (t.nextStateId !== 'function_call') return t;
        const veto = unsourcedVeto(t.input.call.name, t.input.call.args);
        if (!veto) return t;
        hrState.vetoedWrites.push({ agentId: rec.input.agentId, reason: veto });
        publish('hr.write.vetoed', 'verifier', {
          agentId: rec.input.agentId,
          loopId: rec.metric.loopId,
          reason: veto,
        });
        // Rewrite the call so the tool receives an explicit refusal instead of the unsourced write.
        const call = FunctionCallItem.rehydrate({
          callId: t.input.call.callId,
          name: t.input.call.name,
          args: JSON.stringify({ __vetoed: veto }),
        });
        return { nextStateId: 'function_call', input: { ...t.input, call } };
      },
    };
  }

  function startLoop(input: LoopInput): LoopHandle {
    const participant = hrToMozaik.get(input.agentId);
    if (!participant) throw new Error(`Agent ${input.agentId} has not joined`);
    const loopId = `${input.agentId}#${++loopSeq}`;
    const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(input.system));
    let resolve!: (r: LoopResult) => void;
    const done = new Promise<LoopResult>((r) => (resolve = r));
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
    const rec: LoopRecord = {
      input,
      metric,
      context,
      cancelled: false,
      resolve,
      timer: undefined,
      answered: false,
    };
    loopsByContext.set(context.id, rec);
    const tools: Tool[] = input.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
      invoke: async (args: unknown): Promise<string> => {
        if (rec.cancelled) return 'Refused: this loop has ended.';
        rec.metric.toolCalls += 1;
        return tool.invoke(args);
      },
    }));
    const overall =
      (input.timeoutMs ?? opts.defaultLoopTimeoutMs) * ((opts.maxRetries ?? DEFAULT_RETRY.retries) + 1) * 3;
    if (!opts.backend?.recorded)
      rec.timer = setTimeout(
        () => finishLoop(rec, 'failed', undefined, `Loop timed out after ${overall} ms`),
        overall,
      );
    publish('hr.loop.started', input.agentId, {
      loopId,
      agentId: input.agentId,
      loopInputKey: input.loopInputKey,
      startedAt: metric.startedAt,
    });
    runLoop(
      participant.getId(),
      input.user,
      {
        model: input.model,
        maxOutputTokens: input.maxOutputTokens,
        tools,
        context,
        ...(input.structuredOutput
          ? {
              structuredOutput: {
                name: input.structuredOutput.name,
                schema: input.structuredOutput.schema,
                strict: true,
              },
            }
          : {}),
      },
      interception(rec),
    );
    return { loopId, agentId: input.agentId, startedAt: metric.startedAt, done };
  }

  const unmirror = installBoardMirror(hrState, publish);

  return {
    runId,
    state: hrState,
    publish,
    on(participantId: string, filter: EventFilter, handler: HrHandler): void {
      const mb = mailboxes.get(participantId);
      if (!mb) throw new Error(`Participant ${participantId} has not joined`);
      mb.subscribe(filter, handler);
    },
    join,
    startLoop,
    activity() {
      let queuedEvents = 0;
      let busyMailboxes = 0;
      for (const mb of mailboxes.values()) {
        queuedEvents += mb.queued;
        if (mb.busy) busyMailboxes += 1;
      }
      const runningLoops = [...loopsByContext.values()].filter((r) => r.metric.status === 'running').length;
      return { runningLoops, queuedEvents, busyMailboxes };
    },
    loopMetrics(): LoopMetric[] {
      return [...loopsByContext.values()].map((r) => ({ ...r.metric }));
    },
    async shutdown(): Promise<void> {
      for (const rec of loopsByContext.values()) {
        if (rec.metric.status === 'running') finishLoop(rec, 'failed', undefined, 'Run shut down');
      }
      unmirror();
      await Promise.all([...mailboxes.values()].map((m) => m.idle()));
    },
  };
}
