import { postJson } from './client.ts';
import type { Draft, Health } from './types.ts';

/** Live when the server is live and has a model key; otherwise the recorded run (sample data only). */
export function sampleMode(health: Health | undefined): 'live' | 'replay' {
  return health && health.mode === 'live' && health.hasModelKey ? 'live' : 'replay';
}

export async function startSample(profileId: string, mode: 'live' | 'replay'): Promise<string> {
  const r = await postJson<{ runId: string }>('/api/runs', { profileId, mode });
  return r.runId;
}

export async function startUpload(uploadId: string): Promise<string> {
  const r = await postJson<{ runId: string }>('/api/runs', { uploadId, mode: 'live' });
  return r.runId;
}

export async function changeDraft(runId: string, draft: Draft): Promise<void> {
  await postJson(`/api/runs/${runId}/draft`, draft);
}

export async function answerQuestion(runId: string, questionId: string, answer: string): Promise<void> {
  await postJson(`/api/runs/${runId}/questions/${questionId}/answer`, { answer });
}
