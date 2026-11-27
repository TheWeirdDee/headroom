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
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error('the offline server did not start');
}, 30_000);

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
  it('replays the sample: 65 loops, 0 failed, all five planted errors, then completed', async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'p07', mode: 'replay' }),
    });
    const { runId } = (await res.json()) as { runId: string };
    const first = await settled(runId);
    expect(first.loops.filter((l) => l.status === 'failed')).toEqual([]);
    expect(first.summary).toMatchObject({
      loops: 65,
      failedLoops: 0,
      participantErrors: 0,
      unsourcedFigures: 0,
    });
    expect(
      first.discrepancies
        .filter((d) => d.status === 'verified')
        .map((d) => d.type)
        .sort(),
    ).toEqual(['E1', 'E2', 'E3', 'E5', 'E9']);
    // The sample asks six independence questions only the user can answer.
    expect(first.status).toBe('awaiting_user');
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
    expect(done.summary).toMatchObject({ loops: 65, failedLoops: 0 });
  }, 90_000);
});
