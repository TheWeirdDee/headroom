import { describe, expect, it } from 'vitest';
import { groqRequest, isGroqModel } from '../../src/runtime/mozaik/groq.ts';
import { providerOf, KEY_ENV, DEFAULT_RPM } from '../../src/config/providers.ts';
import { isDailyQuota, retryAfterMs } from '../../src/runtime/loop.ts';

describe('Groq connector (OpenAI-compatible, through Mozaik OpenAIChatCompletions)', () => {
  it('recognises groq/ model ids and their key', () => {
    expect(isGroqModel('groq/openai/gpt-oss-120b')).toBe(true);
    expect(isGroqModel('groq/')).toBe(false);
    expect(isGroqModel('gpt-5.4')).toBe(false);
    expect(providerOf('groq/llama-3.3-70b-versatile')).toBe('groq');
    expect(KEY_ENV.groq).toEqual(['GROQ_API_KEY']);
    expect(DEFAULT_RPM.groq).toBe(8);
  });

  it('strips the prefix and asks for JSON when the loop wants structured output', () => {
    const base = { model: 'groq/openai/gpt-oss-120b', messages: [] };
    const plain = groqRequest(base, { model: base.model } as never);
    expect(plain.model).toBe('openai/gpt-oss-120b');
    expect(plain.response_format).toBeUndefined();
    const structured = groqRequest(base, {
      model: base.model,
      structuredOutput: { name: 'fidelity_answer', schema: { type: 'object' } },
    } as never);
    expect(structured.response_format).toEqual({ type: 'json_object' });
  });

  it("reads Groq's rate-limit wait and its daily limit", () => {
    const perMinute = new Error(
      'Rate limit reached for model `x` on requests per minute (RPM): Limit 30. Please try again in 2.5s.',
    );
    expect(retryAfterMs(perMinute)).toBe(2750);
    const daily = Object.assign(
      new Error('429 Rate limit reached for model `x` on requests per day (RPD): Limit 1000, Used 1000.'),
      { status: 429 },
    );
    expect(isDailyQuota(daily)).toBe(true);
  });
});
