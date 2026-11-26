// Our runtime interface (PRD 7.3). No Mozaik imports here: agents, engine and tests depend on these
// types only, and src/runtime/mozaik/adapter.ts implements them on @mozaik-ai/core.
import type { HeadroomState } from './state.ts';

export interface HrEvent<P = unknown> {
  eventId: string;
  runId: string;
  type: string;
  producerId: string;
  occurredAt: string; // ISO 8601 with ms
  payload: P;
}

export interface EventFilter {
  /** Exact types, or prefixes ending in '*' ("hr.figure.*"). */
  types?: string[];
  producerId?: string;
  notProducerId?: string;
  /** Lifecycle events (participant.joined/left) are dropped unless this is true (gap #5). */
  includeLifecycle?: boolean;
}

export type HrHandler = (event: HrEvent) => void | Promise<void>;

export interface HrParticipant {
  id: string;
  name: string;
  kind: 'agent' | 'human' | 'observer';
}

/** A tool an agent's model may call. Arguments are validated by the tool itself (Zod). */
export interface HrTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  invoke(args: unknown): Promise<string>;
}

export interface LoopInput {
  agentId: string;
  /** Identifies the loop's own input (document id, chunk id, figure key + value + excerpt hash). */
  loopInputKey: string;
  system: string;
  promptHash: string;
  user: string;
  model: string;
  maxOutputTokens: number;
  tools: HrTool[];
  structuredOutput?: { name: string; schema: Record<string, unknown> };
  schemaHash: string;
  timeoutMs?: number;
}

export interface LoopResult {
  loopId: string;
  status: 'completed' | 'failed';
  answer?: string;
  error?: string;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface LoopHandle {
  loopId: string;
  agentId: string;
  startedAt: number;
  done: Promise<LoopResult>;
}

export interface LoopMetric {
  loopId: string;
  agentId: string;
  loopInputKey: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'failed';
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  error?: string;
}

/** What a model is asked, in provider-neutral form (used by fakes, replay and request hashing). */
export interface HrInferenceRequest {
  agentId: string;
  loopInputKey: string;
  step: number; // 0 for the first inference in a loop, +1 per tool round trip
  model: string;
  promptHash: string;
  schemaHash: string;
  system: string;
  user: string;
  /** Tool calls and their outputs so far in this loop. */
  transcript: Array<
    { type: 'function_call'; name: string; args: string } | { type: 'function_call_output'; output: string }
  >;
  toolNames: string[];
  structuredOutput: boolean;
}

export type HrInferenceItem =
  { type: 'function_call'; name: string; args: string; callId?: string } | { type: 'message'; text: string };

export interface HrInferenceResponse {
  items: HrInferenceItem[];
  tokensIn: number;
  tokensOut: number;
}

/** A model backend that is not a live provider: scripted fakes in tests, recordings in replay. */
export interface ModelBackend {
  infer(request: HrInferenceRequest): Promise<HrInferenceResponse>;
}

export interface InferenceObserver {
  /** Called after every successful inference, with the wall time it took (for replay timing). */
  onResponse(request: HrInferenceRequest, response: HrInferenceResponse, latencyMs: number): void;
}

export interface HrRuntime {
  readonly runId: string;
  readonly state: HeadroomState;
  publish(type: string, producerId: string, payload: unknown): HrEvent;
  on(participantId: string, filter: EventFilter, handler: HrHandler): void;
  join(p: HrParticipant): void;
  startLoop(input: LoopInput): LoopHandle;
  /** For the quiescence detector. */
  activity(): { runningLoops: number; queuedEvents: number; busyMailboxes: number };
  loopMetrics(): LoopMetric[];
  shutdown(): Promise<void>;
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}
