import { describe, expect, it } from 'vitest';
import { createBackups } from '../../src/runtime/backup.ts';
import { DailyQuotaError } from '../../src/runtime/loop.ts';
import { isExtraGeminiModel } from '../../src/runtime/mozaik/gemini-extra.ts';
import { loadEnv } from '../../src/config/env.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const quota = (): DailyQuotaError => new DailyQuotaError(new Error('per day'));

describe('backup models', () => {
  it('moves to the next model when a daily quota is used up, and stays there', async () => {
    const asked: string[] = [];
    const switches: string[] = [];
    const b = createBackups(['second', 'third'], (from, to) => switches.push(`${from}>${to}`));
    const send = async (m: string): Promise<string> => {
      asked.push(m);
      if (m === 'first') throw quota();
      return m;
    };
    expect(await b.run('first', send)).toBe('second');
    expect(await b.run('first', send)).toBe('second');
    expect(asked).toEqual(['first', 'second', 'second']);
    expect(switches).toEqual(['first>second']);
    expect(b.used()).toEqual(['second']);
  });

  it('reports no backup while the first model answers', async () => {
    const b = createBackups(['second']);
    expect(await b.run('first', async (m) => m)).toBe('first');
    expect(b.used()).toEqual([]);
  });

  it('does not move for any other failure', async () => {
    const b = createBackups(['second']);
    await expect(
      b.run('first', async () => {
        throw new Error('bad request');
      }),
    ).rejects.toThrow('bad request');
    expect(b.used()).toEqual([]);
  });

  it('fails with the quota error once every model is used up', async () => {
    const b = createBackups(['second']);
    const send = async (): Promise<never> => {
      throw quota();
    };
    await expect(b.run('first', send)).rejects.toBeInstanceOf(DailyQuotaError);
    await expect(b.run('first', send)).rejects.toBeInstanceOf(DailyQuotaError);
  });

  it('defaults to a free Gemini model on the same key and never to another provider unasked', () => {
    const saved = { ...process.env };
    const root = mkdtempSync(join(tmpdir(), 'headroom-backup-'));
    try {
      process.env['GEMINI_API_KEY'] = 'k';
      process.env['GROQ_API_KEY'] = 'k';
      delete process.env['HEADROOM_MODEL_BACKUP'];
      delete process.env['HEADROOM_MODEL_READER'];
      delete process.env['HEADROOM_MODEL_VERIFIER'];
      expect(loadEnv(root, ['node', 'main']).backupModels).toEqual(['gemini-3.1-flash-lite']);
      process.env['HEADROOM_MODEL_BACKUP'] = 'gemini-3.1-flash-lite, groq/openai/gpt-oss-120b';
      expect(loadEnv(root, ['node', 'main']).backupModels).toHaveLength(2);
      process.env['HEADROOM_MODEL_BACKUP'] = 'none';
      expect(loadEnv(root, ['node', 'main']).backupModels).toEqual([]);
      delete process.env['GROQ_API_KEY'];
      process.env['HEADROOM_MODEL_BACKUP'] = 'groq/openai/gpt-oss-120b';
      expect(() => loadEnv(root, ['node', 'main'])).toThrow(/GROQ_API_KEY/);
    } finally {
      process.env = saved;
    }
  });

  it('knows which unlisted Gemini models Mozaik’s endpoint can be given', () => {
    expect(isExtraGeminiModel('gemini-3.1-flash-lite')).toBe(true);
    expect(isExtraGeminiModel('gemini-3-flash-preview')).toBe(true);
    expect(isExtraGeminiModel('gemini-3.1-pro-preview')).toBe(false);
    expect(isExtraGeminiModel('claude-sonnet-5-5')).toBe(false);
  });
});
