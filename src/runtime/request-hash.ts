import { canonicalJson, sha256 } from '../util/hash.ts';
import type { HrInferenceRequest } from './types.ts';

/**
 * requestHash: built from the loop's own input only, never from arrival order,
 * timestamps, loop ids or another agent's output. `step` and the loop's own tool transcript keep the
 * hash unique per inference inside one loop and are themselves deterministic given the same responses.
 */
export function requestHash(r: HrInferenceRequest): string {
  return sha256(
    canonicalJson({
      agentId: r.agentId,
      promptHash: r.promptHash,
      schemaHash: r.schemaHash,
      model: r.model,
      loopInputKey: r.loopInputKey,
      step: r.step,
      transcript: r.transcript,
    }),
  );
}
