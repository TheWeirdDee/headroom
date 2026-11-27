// Workaround for a Mozaik 6.0.0 gap: Gemini 3 models return a `thoughtSignature` on function-call parts
// and reject the next request (HTTP 400 "Function call is missing a thought_signature") unless it is sent
// back unchanged. Mozaik's GeminiGenerateContentMapper drops it on the way in and out. This patches the
// mapper of a Gemini endpoint once: signatures are remembered per FunctionCallItem when a response is
// mapped, and attached to the matching functionCall parts when the next request is built.
import { FunctionCallItem, supportedModels } from '@mozaik-ai/core';

interface GeminiPart {
  functionCall?: { id?: string; name?: string; args?: unknown };
  thoughtSignature?: string;
  [k: string]: unknown;
}
interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}
interface Mapper {
  toRequest(input: { context: { getItems(): unknown[] } }): { contents?: GeminiContent[] };
  toResponse(response: unknown): { items: unknown[] };
  __hrSignatures?: true;
}

const MAX_BY_KEY = 5000;
// Shared by every patched endpoint: a loop that moves to a backup model keeps its signatures.
const byItem = new WeakMap<object, string>();
// Fallback when the loop stores a copy of the item (e.g. a rewritten call): same id, name and args.
const byKey = new Map<string, string>();

/** Patches `endpoint.endpointMapper` if it is a Gemini mapper; other endpoints are left as they are. */
export function patchGeminiSignatures(endpoint: unknown): void {
  const mapper = (endpoint as { endpointMapper?: Mapper } | undefined)?.endpointMapper;
  if (!mapper || mapper.__hrSignatures || mapper.constructor?.name !== 'GeminiGenerateContentMapper') return;
  mapper.__hrSignatures = true;

  const keyOf = (callId: string, name: string, args: string): string => `${callId}\u0000${name}\u0000${args}`;

  const toResponse = mapper.toResponse.bind(mapper);
  mapper.toResponse = (response: unknown) => {
    const out = toResponse(response);
    const parts =
      (response as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }).candidates?.[0]?.content
        ?.parts ?? [];
    const signed = parts.filter((p) => p.functionCall);
    const calls = out.items.filter((i): i is FunctionCallItem => i instanceof FunctionCallItem);
    calls.forEach((item, i) => {
      const sig = signed[i]?.thoughtSignature;
      if (!sig) return;
      byItem.set(item, sig);
      if (byKey.size >= MAX_BY_KEY) byKey.delete(byKey.keys().next().value as string);
      byKey.set(keyOf(item.callId, item.name, item.args), sig);
    });
    return out;
  };

  const toRequest = mapper.toRequest.bind(mapper);
  mapper.toRequest = (input) => {
    const request = toRequest(input);
    // The mapper emits one functionCall part per FunctionCallItem, in context order.
    const calls = input.context
      .getItems()
      .filter((i): i is FunctionCallItem => i instanceof FunctionCallItem);
    let n = 0;
    for (const content of request.contents ?? []) {
      for (const part of content.parts) {
        if (!part.functionCall) continue;
        const item = calls[n++];
        if (!item) continue;
        const sig = byItem.get(item) ?? byKey.get(keyOf(item.callId, item.name, item.args));
        if (sig) part.thoughtSignature = sig;
      }
    }
    return request;
  };
}

/** A new, unpatched endpoint of the class Mozaik uses for `model` (tests patch this, not the shared one). */
export function newEndpointLike(model: string): unknown {
  const found = supportedModels.find((m) => m.specification.name === model);
  if (!found) throw new Error(`${model} is not a Mozaik model`);
  const Endpoint = (found.endpoint as object).constructor as new () => unknown;
  return new Endpoint();
}
