// A run on Mozaik (@mozaik-ai/core 6.0.0): defineRuntime/initializeRuntime per run, with the Figure Board
// as the RuntimeState. The agents are Mozaik participants (src/agents/) that react through their own
// situation specifications; this module gives them what they share: publishing events, following their
// own runLoop calls to an answer, and a custom InferenceRunner (timeouts, retries, pacing, replay).
import {
  createHuman,
  defineRuntime,
  DeveloperMessageItem,
  FunctionCallItem,
  FunctionCallOutputItem,
  InputTokenDetails,
  ModelContext,
  ModelMessageItem,
  OutputTokenDetails,
  SemanticEvent,
  SituationSpecification,
  supportedModels,
  TokenUsage,
  type Agent,
  type InferenceInput,
  type InferenceOutput,
  type InferenceRunner,
  type InterceptionHandler,
  type Participant,
  type SituationContext,
  type SituationHandler,
  type Tool,
} from '@mozaik-ai/core';
import { Inbox } from '../inbox.ts';
import { patchGeminiSignatures } from './gemini-signatures.ts';
import { groqInfer, isGroqModel } from './groq.ts';
import { extraGeminiInfer, isExtraGeminiModel } from './gemini-extra.ts';
import { createBackups } from '../backup.ts';
import { installBoardMirror } from '../board-mirror.ts';
import { DEFAULT_RETRY, withRetry } from '../loop.ts';
import { acquire as paceRequest, pacerRpm } from '../pacer.ts';
import type { HeadroomState } from '../state.ts';
import type {
  HrEvent,
  HrHandler,
  HrInferenceRequest,
  HrInferenceResponse,
  InferenceObserver,
  LoopHandle,
  LoopInput,
  LoopMetric,
  LoopResult,
  ModelBackend,
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

/** Marker returned as the model answer when inference failed: runLoop reports no failure of its own. */
const FAIL_MARK = '\u0000HEADROOM_INFERENCE_FAILED\u0000';

/** An event of one of the participant's own loops. Every thinking agent follows these two. */
export class MyLoopEvent extends SituationSpecification {
  constructor(readonly type: 'message_received.started' | 'model.answer') {
    super();
  }

  isSatisfiedBy({ event, participant }: SituationContext): boolean {
    return event.type === this.type && event.producerId === participant.getId();
  }
}

/** The InterceptionHandler for one loop (the Verifier's evidence gate). */
export type LoopGate = (loop: { agentId: string; loopId: string }) => InterceptionHandler;

/** What an agent asks its model; who asks and under which instruction come from the participant. */
export type ThinkInput = Omit<LoopInput, 'agentId' | 'system'> & { gate?: LoopGate };

export interface HeadroomRuntime {
  readonly runId: string;
  /** The RuntimeState every participant shares: the Figure Board. */
  readonly state: HeadroomState;
  join(participant: Participant): void;
  /** A situation handler: when the specification is satisfied, `apply` runs, one at a time per participant. */
  when(specification: SituationSpecification, apply: HrHandler): SituationHandler;
  /** The handlers an agent needs to hear the answers of its own loops. */
  ownLoops(): SituationHandler[];
  /** Send a semantic event as the named participant (as the runtime itself if there is none). */
  publish(type: string, producerId: string, payload: unknown): HrEvent;
  /** The transcript's view of any Mozaik event, with names instead of ids. */
  asHrEvent(event: SemanticEvent): HrEvent;
  /** runLoop for this agent, with a fresh context; `done` resolves with its answer or failure. */
  think(agent: Agent, input: ThinkInput): LoopHandle;
  /** Backup models that answered at least one request of this run. */
  backupsUsed(): string[];
  /** For the quiescence detector. */
  activity(): { runningLoops: number; queuedEvents: number; busyMailboxes: number };
  loopMetrics(): LoopMetric[];
  shutdown(): Promise<void>;
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

export interface RuntimeOptions {
  state: HeadroomState;
  /** Scripted fakes or recorded responses; omit to call the live provider through Mozaik's endpoints. */
  backend?: ModelBackend;
  observer?: InferenceObserver;
  newEventId: () => string;
  now?: () => number;
  defaultLoopTimeoutMs: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Models to move to when a model's daily quota is used up, in order. */
  backupModels?: readonly string[];
}

/** The provider's own words for a failed request, on one line and short (HTTP status and message). */
function retryReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const message = /"message"\s*:\s*"([^"]{0,160})/.exec(text)?.[1] ?? text;
  return message.replace(/\s+/g, ' ').slice(0, 160);
}

export function createRuntime(opts: RuntimeOptions): HeadroomRuntime {
  disableMozaikCloud();
  filterCloudWarnings();
  const now = opts.now ?? ((): number => Date.now());
  const runId = opts.state.runId;

  const loopsByContext = new Map<string, LoopRecord>();
  const loopsById = new Map<string, LoopRecord>();
  const participants = new Map<string, Participant>(); // by manifest name
  const inboxes = new Map<Participant, Inbox>();
  const converted = new WeakMap<object, HrEvent>();
  let loopSeq = 0;
  const backups = createBackups(opts.backupModels ?? [], (from, to) =>
    process.stderr.write(`Daily quota of ${from} used up: continuing on backup model ${to}.\n`),
  );

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
    if (!model && isExtraGeminiModel(input.model)) return extraGeminiInfer(input);
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

  const failed = (reason: string): InferenceOutput => ({
    items: [ModelMessageItem.rehydrate({ text: `${FAIL_MARK}${reason}` })],
    tokenUsage: undefined,
    rowResponse: null,
  });

  const runner: InferenceRunner = {
    async run(input: InferenceInput): Promise<InferenceOutput> {
      const rec = loopsByContext.get(input.context.id);
      if (!rec) return failed('unknown loop context');
      if (rec.cancelled) return failed('loop cancelled');
      const request = toRequest(rec, input);
      try {
        const t0 = now();
        const send = async (model: string): Promise<InferenceOutput> => {
          const asked = model === request.model ? request : { ...request, model };
          const answered = opts.observer?.onRequest?.(asked);
          try {
            if (opts.backend) return toMozaikOutput(await opts.backend.infer(asked), request.step);
            return await providerInfer(model === input.model ? input : { ...input, model });
          } finally {
            answered?.();
          }
        };
        const attempt = (model: string): Promise<InferenceOutput> =>
          withRetry(() => send(model), {
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
        const out = opts.backend?.recorded
          ? await send(request.model)
          : await backups.run(request.model, attempt);
        const neutral = fromMozaikOutput(out);
        rec.metric.tokensIn += neutral.tokensIn;
        rec.metric.tokensOut += neutral.tokensOut;
        opts.observer?.onResponse?.(request, neutral, now() - t0);
        // An output with neither a function call nor an assistant message (reasoning only) leaves the loop
        // without a next state, as an unhandled rejection. Guarantee a terminal item.
        const callable = out.items.some(
          (i) => i instanceof FunctionCallItem || i instanceof ModelMessageItem,
        );
        return callable ? out : { ...out, items: [...out.items, ModelMessageItem.rehydrate({ text: '' })] };
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    },
    async *stream(input: InferenceInput) {
      yield SemanticEvent.create('inference.output', input.model, await runner.run(input));
    },
  };

  // --- runtime --------------------------------------------------------------------------------------
  const mozaik = defineRuntime<HeadroomState>();
  mozaik.initializeRuntime({ state: opts.state, inferenceRunnerConfig: { runner } });
  const state = (): HeadroomState => mozaik.resolveRuntime().state;

  const self = createHuman({ name: 'runtime', capabilities: [], handlers: [] });
  mozaik.join(self);

  function publish(type: string, producerId: string, payload: unknown): HrEvent {
    const sender = participants.get(producerId) ?? self;
    const semantic = new SemanticEvent(type, sender.getId(), new Date(now()), payload);
    const event: HrEvent = {
      eventId: opts.newEventId(),
      runId,
      type,
      producerId,
      occurredAt: semantic.occurredAt.toISOString(),
      payload,
    };
    converted.set(semantic, event);
    mozaik.sendEvent(semantic, sender.getId());
    return event;
  }

  function asHrEvent(e: SemanticEvent): HrEvent {
    const known = converted.get(e);
    if (known) return known;
    const p = (e.payload ?? {}) as { loopId?: string };
    const event: HrEvent = {
      eventId: opts.newEventId(),
      runId,
      type: e.type,
      producerId: state().getParticipant(e.producerId)?.getManifest().name ?? e.producerId,
      occurredAt: e.occurredAt.toISOString(),
      // Native payloads hold whole model contexts; only the loop id is forwarded.
      payload: p.loopId ? { loopId: loopsById.get(p.loopId)?.metric.loopId ?? p.loopId } : {},
    };
    converted.set(e, event);
    return event;
  }

  function reportHandlerError(participantId: string, event: HrEvent, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    state().handlerErrors.push(`${participantId}: ${err.message}`);
    publish('hr.participant.error', 'runtime', {
      participantId,
      eventId: event.eventId,
      eventType: event.type,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    });
  }

  function inboxOf(p: Participant): Inbox {
    let inbox = inboxes.get(p);
    if (!inbox) {
      inbox = new Inbox(p.getManifest().name, ({ participantId, event, error }) =>
        reportHandlerError(participantId, event, error),
      );
      inboxes.set(p, inbox);
    }
    return inbox;
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
      state().failedLoops.push({
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

  /** The agent learns which Mozaik loop id belongs to the context it started. */
  function onLoopStarted({ event }: SituationContext): void {
    const payload = event.payload as { loopId?: string; input?: { context?: ModelContext } };
    const rec = payload.input?.context ? loopsByContext.get(payload.input.context.id) : undefined;
    if (rec && payload.loopId) loopsById.set(payload.loopId, rec);
  }

  /** The agent hears the answer to one of its loops. */
  function onAnswer({ event }: SituationContext): void {
    const payload = event.payload as { loopId?: string; answer?: ModelMessageItem };
    const rec = loopsById.get(payload.loopId ?? '');
    if (!rec || rec.answered) return;
    rec.answered = true;
    const text = payload.answer?.content.text ?? '';
    if (text.startsWith(FAIL_MARK)) finishLoop(rec, 'failed', undefined, text.slice(FAIL_MARK.length));
    else finishLoop(rec, 'completed', text);
  }

  function think(agent: Agent, request: ThinkInput): LoopHandle {
    const agentId = agent.getManifest().name;
    if (participants.get(agentId) !== agent) throw new Error(`Agent ${agentId} has not joined`);
    if (
      !agent
        .getHandlers()
        .some((h) => h.specification instanceof MyLoopEvent && h.specification.type === 'model.answer')
    )
      throw new Error(`Agent ${agentId} does not listen to its own loops (rt.ownLoops())`);
    const { gate, ...rest } = request;
    const input: LoopInput = { ...rest, agentId, system: agent.getDeveloperMessage() };
    const loopId = `${agentId}#${++loopSeq}`;
    const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(input.system));
    let resolve!: (r: LoopResult) => void;
    const done = new Promise<LoopResult>((r) => (resolve = r));
    const metric: LoopMetric = {
      loopId,
      agentId,
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
    publish('hr.loop.started', agentId, {
      loopId,
      agentId,
      loopInputKey: input.loopInputKey,
      startedAt: metric.startedAt,
    });
    mozaik.runLoop(
      agent.getId(),
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
      gate?.({ agentId, loopId }),
    );
    return { loopId, agentId, startedAt: metric.startedAt, done };
  }

  const unmirror = installBoardMirror(opts.state, publish);

  return {
    runId,
    get state() {
      return state();
    },
    join(participant) {
      const name = participant.getManifest().name;
      if (participants.has(name)) throw new Error(`A participant named ${name} has already joined`);
      participants.set(name, participant);
      mozaik.join(participant);
    },
    when(specification, apply) {
      return {
        specification,
        processor: {
          apply: ({ event, participant }) => inboxOf(participant).push(asHrEvent(event), apply),
        },
      };
    },
    ownLoops: () => [
      { specification: new MyLoopEvent('message_received.started'), processor: { apply: onLoopStarted } },
      { specification: new MyLoopEvent('model.answer'), processor: { apply: onAnswer } },
    ],
    publish,
    asHrEvent,
    think,
    backupsUsed: () => backups.used(),
    activity() {
      let queuedEvents = 0;
      let busyMailboxes = 0;
      for (const inbox of inboxes.values()) {
        queuedEvents += inbox.queued;
        if (inbox.busy) busyMailboxes += 1;
      }
      const runningLoops = [...loopsByContext.values()].filter((r) => r.metric.status === 'running').length;
      return { runningLoops, queuedEvents, busyMailboxes };
    },
    loopMetrics: () => [...loopsByContext.values()].map((r) => ({ ...r.metric })),
    async shutdown() {
      for (const rec of loopsByContext.values()) {
        if (rec.metric.status === 'running') finishLoop(rec, 'failed', undefined, 'Run shut down');
      }
      unmirror();
      await Promise.all([...inboxes.values()].map((i) => i.idle()));
    },
  };
}
