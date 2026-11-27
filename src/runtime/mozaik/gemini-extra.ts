// Gemini models Google serves that Mozaik 6.0.0 does not list yet, such as gemini-3.1-flash-lite (a free
// backup when the default model's daily quota is used up). They are sent through Mozaik's own Gemini
// endpoint class with their own model id, with the same thought-signature patch as the listed models.
import type { InferenceInput, InferenceOutput } from '@mozaik-ai/core';
import { newEndpointLike, patchGeminiSignatures } from './gemini-signatures.ts';

/** A listed Gemini model whose endpoint and request format the unlisted ones share. */
const LIKE = 'gemini-3.5-flash-lite';

export function isExtraGeminiModel(model: string): boolean {
  return /^gemini-3(\.\d)?-flash(-lite)?(-preview)?$/.test(model);
}

let endpoint: { infer(input: InferenceInput): Promise<InferenceOutput> } | undefined;

export function extraGeminiInfer(input: InferenceInput): Promise<InferenceOutput> {
  if (!endpoint) {
    const e = newEndpointLike(LIKE);
    patchGeminiSignatures(e);
    endpoint = e as { infer(i: InferenceInput): Promise<InferenceOutput> };
  }
  return endpoint.infer(input);
}
