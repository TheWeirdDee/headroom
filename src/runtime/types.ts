// The plain data the engine, the recorder and the tests exchange about a run: events, loops, model
// requests and responses. The runtime itself is Mozaik (src/runtime/mozaik/runtime.ts).

export interface HrEvent<P = unknown> {
  eventId: string;
  runId: string;
  type: string;
  producerId: string;
  occurredAt: string; // ISO 8601 with ms
  payload: P;
}

/** A participant's reaction to one event. */
export type HrHandler = (event: HrEvent) => void | Promise<void>;

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
  /** Recorded answers cannot hang or be rate limited: no timeout or retry applies to them. */
  readonly recorded?: boolean;
  infer(request: HrInferenceRequest): Promise<HrInferenceResponse>;
}

export interface InferenceObserver {
  /**
   * Called when a request is sent to the model, after any wait for the rate limit; the returned function is
   * called when it is answered or fails.
   */
  onRequest?(request: HrInferenceRequest): () => void;
  /** Called after every successful inference, with the wall time it took (for replay timing). */
  onResponse?(request: HrInferenceRequest, response: HrInferenceResponse, latencyMs: number): void;
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}
