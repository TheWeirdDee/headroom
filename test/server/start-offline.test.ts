// The README's keyless command, run for real: `npm run start:offline` (the same entry point and flags),
// then the committed recording of p07 started the way the landing page's button starts it.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Snap {
  status: string;
  loops: Array<{ status: string; error?: string }>;
  questions: Array<{ id: string; answer?: string }>;
  discrepancies: Array<{ type: string; status: string }>;
  summary: { loops: number; failedLoops: number; participantErrors: number; unsourcedFigures: number } | null;
  card: { limit6m: Record<string, unknown> } | null;
}

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let server: ChildProcess;
let base: string;

beforeAll(async () => {
  const script = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> })
    .scripts['start:offline'];
  expect(script).toBe('tsx src/server/main.ts --offline');
  const port = await freePort();
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--offline'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}`;
  // Starting the server compiles it; on a busy machine that can take a while.
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error('the offline server did not start');
}, 90_000);

afterAll(() => {
  server?.kill();
});

const snapshot = async (id: string): Promise<Snap> =>
  (await (await fetch(`${base}/api/runs/${id}`)).json()) as Snap;

async function settled(id: string): Promise<Snap> {
  for (let i = 0; i < 600; i++) {
    const s = await snapshot(id);
    if (s.status !== 'running' && s.summary) return s;
    await sleep(100);
  }
  throw new Error('the replay did not finish within 60 s');
}

describe('npm run start:offline', () => {
  it('replays the sample: 66 loops, 0 failed, all six planted errors, then completed', async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'p07', mode: 'replay' }),
    });
    const { runId } = (await res.json()) as { runId: string };
    const first = await settled(runId);
    expect(first.loops.filter((l) => l.status === 'failed')).toEqual([]);
    expect(first.summary).toMatchObject({
      loops: 66,
      failedLoops: 0,
      participantErrors: 0,
      unsourcedFigures: 0,
    });
    expect(
      first.discrepancies
        .filter((d) => d.status === 'verified')
        .map((d) => d.type)
        .sort(),
    ).toEqual(['E1', 'E2', 'E3', 'E5', 'E5', 'E9']);
    // The sample asks six independence questions only the user can answer.
    expect(first.status).toBe('awaiting_user');
    // The headline: invoices alone leave room, but with the payment that has no invoice the line is crossed.
    expect(first.card?.limit6m).toMatchObject({
      band: 'red',
      headroomWithDraft: { amount: '204308.79' },
      unbilled: {
        band: 'crossed',
        total: { amount: '6035691.21' },
        over: { amount: '35691.21' },
        payments: [{ date: expect.any(String) }],
      },
    });
    const open = first.questions.filter((q) => q.answer === undefined);
    expect(open).toHaveLength(6);

    for (const q of open) {
      const a = await fetch(`${base}/api/runs/${runId}/questions/${q.id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: 'No' }),
      });
      expect(a.status).toBe(202);
    }
    let done = await snapshot(runId);
    for (let i = 0; i < 100 && done.status !== 'completed'; i++) {
      await sleep(100);
      done = await snapshot(runId);
    }
    expect(done.status).toBe('completed');
    expect(done.summary).toMatchObject({ loops: 66, failedLoops: 0 });
  }, 90_000);

  it('refuses changes to the landing page showcase over HTTP', async () => {
    const { runId } = (await (await fetch(`${base}/api/showcase`)).json()) as { runId: string };
    const shared = await settled(runId);
    const post = (path: string, body: unknown): Promise<Response> =>
      fetch(`${base}/api/runs/${runId}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const draft = await post('/draft', {
      clientId: 'heron',
      currency: 'EUR',
      amount: '999999.00',
      issueDate: '2026-11-26',
      description: 'x',
      kind: 'service',
    });
    const answer = await post(`/questions/${shared.questions[0]?.id ?? ''}/answer`, { answer: 'Yes' });
    expect([draft.status, answer.status]).toEqual([403, 403]);
    expect(((await draft.json()) as { error: { code: string } }).error.code).toBe('READ_ONLY');
  }, 30_000);
});
