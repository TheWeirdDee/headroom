import { describe, expect, it } from 'vitest';
import { newEndpointLike, patchGeminiSignatures } from '../../src/runtime/mozaik/gemini-signatures.ts';

type AnyMapper = {
  toResponse(r: unknown): { items: Array<{ name?: string }> };
  toRequest(i: unknown): { contents: Array<{ parts: Array<Record<string, unknown>> }> };
};

describe('Gemini thought signatures (Mozaik gap)', () => {
  it('sends back the signature of a function call on the next request', () => {
    const endpoint = newEndpointLike('gemini-3.5-flash') as { endpointMapper: AnyMapper };
    patchGeminiSignatures(endpoint);
    patchGeminiSignatures(endpoint); // idempotent
    const mapper = endpoint.endpointMapper;
    const out = mapper.toResponse({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'submit', args: { a: 1 } }, thoughtSignature: 'sig-1' }],
          },
        },
      ],
    });
    const call = out.items[0];
    expect(call?.name).toBe('submit');

    const req = mapper.toRequest({ model: 'gemini-3.5-flash', context: { getItems: () => [call] } });
    const parts = req.contents.flatMap((c) => c.parts).filter((p) => p['functionCall']);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.['thoughtSignature']).toBe('sig-1');
  });

  it('leaves non-Gemini endpoints alone', () => {
    const endpoint = newEndpointLike('claude-sonnet-4-6') as { endpointMapper: AnyMapper };
    const before = endpoint.endpointMapper.toRequest;
    patchGeminiSignatures(endpoint);
    expect(endpoint.endpointMapper.toRequest).toBe(before);
  });
});
