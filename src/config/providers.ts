// Which key a model needs. Mozaik 6.0.0 serves Gemini, Claude, GPT and DeepSeek models; Headroom defaults
// to Gemini (the free tier). The provider is read from the model id's prefix so this file needs no Mozaik
// import (only src/runtime/mozaik may import it).

export type Provider = 'google' | 'anthropic' | 'openai' | 'deepseek';

export function providerOf(model: string): Provider | undefined {
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('deepseek-')) return 'deepseek';
  return undefined;
}

/** Environment variables that hold each provider's key, in the order they are read. */
export const KEY_ENV: Record<Provider, string[]> = {
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
};

/** Requests per minute when HEADROOM_MAX_RPM is not set: paced for the Gemini free tier, unpaced otherwise. */
export const DEFAULT_RPM: Record<Provider, number> = { google: 10, anthropic: 0, openai: 0, deepseek: 0 };
