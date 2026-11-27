// The Verifier inside the other agents' loops: a Mozaik InterceptionHandler on every reading loop. It sees
// each tool call after the model decides on it and before it runs; a submission that reports a value
// without the text it was read from is replaced by an explicit refusal, so the write never happens.
import { FunctionCallItem, type ExecutableTransition, type InterceptionHandler } from '@mozaik-ai/core';
import { unsourcedVeto } from '../../runtime/veto.ts';
import type { HeadroomRuntime, LoopGate } from '../../runtime/mozaik/runtime.ts';

export function evidenceGate(rt: HeadroomRuntime, verifierId: string): LoopGate {
  return ({ agentId, loopId }): InterceptionHandler => ({
    isSatisfiedBy: (t: ExecutableTransition): boolean => t.nextStateId === 'function_call',
    async handle(t: ExecutableTransition): Promise<ExecutableTransition> {
      if (t.nextStateId !== 'function_call') return t;
      const veto = unsourcedVeto(t.input.call.name, t.input.call.args);
      if (!veto) return t;
      rt.state.vetoedWrites.push({ agentId, reason: veto });
      rt.publish('hr.write.vetoed', verifierId, { agentId, loopId, reason: veto });
      // The tool receives the refusal instead of the unsourced write.
      const call = FunctionCallItem.rehydrate({
        callId: t.input.call.callId,
        name: t.input.call.name,
        args: JSON.stringify({ __vetoed: veto }),
      });
      return { nextStateId: 'function_call', input: { ...t.input, call } };
    },
  });
}
