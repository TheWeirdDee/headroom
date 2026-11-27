// Test participants on a real Mozaik runtime; only the model is scripted.
import { createAgent, createHuman, type Agent, type SituationHandler } from '@mozaik-ai/core';
import { HeadroomState } from '../../src/runtime/state.ts';
import { createRuntime, type HeadroomRuntime, type ThinkInput } from '../../src/runtime/mozaik/runtime.ts';
import { AnyEvent } from '../../src/agents/situations.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { sequentialIds } from '../../src/util/hash.ts';
import type {
  HrEvent,
  HrInferenceRequest,
  HrInferenceResponse,
  ModelBackend,
} from '../../src/runtime/types.ts';

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
  backend: ModelBackend,
  state: HeadroomState = makeState(),
  extra: { loopTimeoutMs?: number } = {},
): HeadroomRuntime {
  return createRuntime({
    state,
    backend,
    newEventId: sequentialIds('e'),
    defaultLoopTimeoutMs: extra.loopTimeoutMs ?? 2_000,
    sleep: async () => {},
  });
}

/** Join a Mozaik agent that follows its own loops. */
export function agentNamed(rt: HeadroomRuntime, name: string, handlers: SituationHandler[] = []): Agent {
  const agent = createAgent({
    name,
    capabilities: ['inference'],
    instruction: 'You are a test agent.',
    tools: [],
    handlers: [...rt.ownLoops(), ...handlers],
  });
  rt.join(agent);
  return agent;
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

export function thinkInput(overrides: Partial<ThinkInput> = {}): ThinkInput {
  return {
    loopInputKey: 'test-input',
    promptHash: 'sha256:test',
    user: 'Do the thing.',
    model: 'claude-sonnet-5-5',
    maxOutputTokens: 1024,
    tools: [],
    schemaHash: 'sha256:none',
    ...overrides,
  };
}

/** Collect every event delivered to a participant that reacts to all of them. */
export function observe(rt: HeadroomRuntime, name = 'observer'): HrEvent[] {
  const seen: HrEvent[] = [];
  rt.join(
    createHuman({
      name,
      capabilities: [],
      handlers: [
        rt.when(new AnyEvent(), (e) => {
          seen.push(e);
        }),
      ],
    }),
  );
  return seen;
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
