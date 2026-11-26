import { HeadroomState } from '../../src/runtime/state.ts';
import { createMemoryRuntime } from '../../src/runtime/memory/adapter.ts';
import { createMozaikRuntime } from '../../src/runtime/mozaik/adapter.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { sequentialIds } from '../../src/util/hash.ts';
import type {
  HrEvent,
  HrInferenceRequest,
  HrInferenceResponse,
  HrRuntime,
  LoopInput,
  ModelBackend,
} from '../../src/runtime/types.ts';

export type AdapterKind = 'mozaik' | 'memory';

export function makeState(runId = 'run-test'): HeadroomState {
  return new HeadroomState(
    runId,
    'test-input',
    'live',
    defaultRunConfig(2026, '2026-11-26'),
    sequentialIds('f'),
  );
}

export function makeRuntime(
  kind: AdapterKind,
  backend: ModelBackend,
  state: HeadroomState = makeState(),
  extra: { loopTimeoutMs?: number } = {},
): HrRuntime {
  const common = {
    state,
    backend,
    newEventId: sequentialIds('e'),
    defaultLoopTimeoutMs: extra.loopTimeoutMs ?? 2_000,
    sleep: async () => {},
  };
  return kind === 'mozaik' ? createMozaikRuntime(common) : createMemoryRuntime(common);
}

/** A backend driven by a function of the request; records every request it sees. */
export function scripted(
  respond: (req: HrInferenceRequest) => HrInferenceResponse | Promise<HrInferenceResponse>,
): ModelBackend & { requests: HrInferenceRequest[] } {
  const requests: HrInferenceRequest[] = [];
  return {
    requests,
    async infer(req) {
      requests.push(req);
      return respond(req);
    },
  };
}

export const msg = (text: string, tokensIn = 10, tokensOut = 5): HrInferenceResponse => ({
  items: [{ type: 'message', text }],
  tokensIn,
  tokensOut,
});

export const call = (name: string, args: unknown, tokensIn = 10, tokensOut = 5): HrInferenceResponse => ({
  items: [{ type: 'function_call', name, args: JSON.stringify(args) }],
  tokensIn,
  tokensOut,
});

export function loopInput(agentId: string, overrides: Partial<LoopInput> = {}): LoopInput {
  return {
    agentId,
    loopInputKey: `${agentId}-input`,
    system: 'You are a test agent.',
    promptHash: 'sha256:test',
    user: 'Do the thing.',
    model: 'claude-sonnet-5-5',
    maxOutputTokens: 1024,
    tools: [],
    schemaHash: 'sha256:none',
    ...overrides,
  };
}

/** Collect every event delivered to an observer participant. */
export function observe(rt: HrRuntime, id = 'observer'): HrEvent[] {
  const seen: HrEvent[] = [];
  rt.join({ id, name: id, kind: 'observer' });
  rt.on(id, { includeLifecycle: true }, (e) => {
    seen.push(e);
  });
  return seen;
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
