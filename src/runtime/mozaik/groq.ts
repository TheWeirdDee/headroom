// Groq connector. Mozaik 6.0.0 has no Groq provider, but Groq serves an OpenAI-compatible chat-completions
// API, and Mozaik exports its OpenAIChatCompletions endpoint with a configurable base URL. Model ids are
// written "groq/<groq model id>" in Headroom; the prefix is removed before the request is sent. Two gaps in
// Mozaik's chat-completions mapper are closed here: structured output is sent as response_format (the
// mapper drops it), and an answer that is only JSON text is passed through as the loop's answer.
import { OpenAIChatCompletions, type InferenceInput, type InferenceOutput } from '@mozaik-ai/core';

export const GROQ_PREFIX = 'groq/';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export function isGroqModel(model: string): boolean {
  return model.startsWith(GROQ_PREFIX) && model.length > GROQ_PREFIX.length;
}

interface ChatRequest {
  model: string;
  response_format?: unknown;
  [k: string]: unknown;
}

let endpoint: OpenAIChatCompletions | undefined;

/** The shared Groq endpoint (built on first use, so the key is read from the environment then). */
export function groqEndpoint(): OpenAIChatCompletions {
  if (!endpoint) {
    const e = new OpenAIChatCompletions(undefined, {
      baseURL: GROQ_BASE_URL,
      apiKey: process.env['GROQ_API_KEY'] ?? '',
    });
    const mapper = (e as unknown as { endpointMapper: { toRequest(i: InferenceInput): ChatRequest } })
      .endpointMapper;
    const toRequest = mapper.toRequest.bind(mapper);
    mapper.toRequest = (input) => groqRequest(toRequest(input), input);
    endpoint = e;
  }
  return endpoint;
}

/** Strip the prefix and add the structured-output format Mozaik's mapper leaves out. */
export function groqRequest(request: ChatRequest, input: InferenceInput): ChatRequest {
  const out: ChatRequest = { ...request, model: request.model.slice(GROQ_PREFIX.length) };
  const so = (input as { structuredOutput?: { name: string; schema: Record<string, unknown> } })
    .structuredOutput;
  // json_object is accepted by every Groq chat model; the schema itself is enforced by Zod on our side.
  if (so) out.response_format = { type: 'json_object' };
  return out;
}

export async function groqInfer(input: InferenceInput): Promise<InferenceOutput> {
  return groqEndpoint().infer(input);
}
