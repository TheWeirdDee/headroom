// Headroom is a team of Mozaik participants: nothing calls an agent. This checks the shape of a real run,
// so an agent turned back into a function that something invokes would fail here.
import { beforeAll, describe, expect, it } from 'vitest';
import { Agent, Human, SituationSpecification } from '@mozaik-ai/core';
import { loadInputSet } from '../../src/engine/load-inputs.ts';
import { startRun, type Run } from '../../src/engine/run-engine.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../../src/config/defaults.ts';
import { AnyEvent } from '../../src/agents/situations.ts';
import { MyLoopEvent } from '../../src/runtime/mozaik/runtime.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import { fixtureKurs, smallProfile, writeTempProfile } from '../helpers/profiles.ts';

const AGENT_NAMES = [
  'independence-checker',
  'invoice-reader',
  'kpo-reader',
  'limit-keeper',
  'rate-clerk',
  'statement-reader',
  'verifier',
];
const WITH_MODEL = ['independence-checker', 'invoice-reader', 'kpo-reader', 'statement-reader', 'verifier'];

let run: Run;

beforeAll(async () => {
  const { inputs, year, asOf } = await loadInputSet(await writeTempProfile(smallProfile()));
  const started = Date.now();
  const clock = (): number => Date.parse('2026-11-26T09:00:00Z') + (Date.now() - started);
  run = startRun({
    runId: 'run-mozaik',
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf),
    mode: 'live',
    kurs: fixtureKurs(clock),
    backend: fakeModel({ delayMs: 10 }),
    now: clock,
    quietMs: 400,
    runTimeoutMs: 30_000,
  });
  await run.done;
}, 60_000);

const participants = () => run.rt.state.getParticipants();
const named = (name: string) => participants().find((p) => p.getManifest().name === name);

describe('a run is a Mozaik team', () => {
  it('has seven agents, the user and the transcript as participants of one runtime', () => {
    expect(
      participants()
        .filter((p) => p instanceof Agent)
        .map((p) => p.getManifest().name)
        .sort(),
    ).toEqual(AGENT_NAMES);
    expect(
      participants()
        .filter((p) => p instanceof Human)
        .map((p) => p.getManifest().name)
        .sort(),
    ).toEqual(['human', 'runtime', 'transcript']);
  });

  it('gives every agent its own situations; none reacts to everything', () => {
    for (const name of AGENT_NAMES) {
      const handlers = named(name)?.getHandlers() ?? [];
      const reactions = handlers.filter((h) => !(h.specification instanceof MyLoopEvent));
      expect([name, reactions.length > 0]).toEqual([name, true]);
      for (const h of handlers) {
        expect(h.specification).toBeInstanceOf(SituationSpecification);
        expect([name, h.specification instanceof AnyEvent]).toEqual([name, false]);
      }
    }
  });

  it('runs each model loop as that participant, under the instruction it holds', () => {
    const thinking = new Set(run.rt.loopMetrics().map((l) => l.agentId));
    expect([...thinking].sort()).toEqual(WITH_MODEL);
    for (const name of WITH_MODEL) {
      const agent = named(name) as Agent;
      expect(agent.getDeveloperMessage().length).toBeGreaterThan(100);
      expect(agent.getHandlers().filter((h) => h.specification instanceof MyLoopEvent)).toHaveLength(2);
    }
    // The two that only apply rules run no model.
    for (const name of ['limit-keeper', 'rate-clerk'])
      expect(named(name)?.getManifest().capabilities).toContain('rules');
  });

  it('starts with one event from the user that several readers react to at once', () => {
    const start = run.events.find((e) => e.type === 'hr.run.started');
    expect(start?.producerId).toBe('human');
    const firstLoops = run.events.filter((e) => e.type === 'hr.loop.started').slice(0, 6);
    expect(new Set(firstLoops.map((e) => e.producerId)).size).toBeGreaterThanOrEqual(3);
  });
});
