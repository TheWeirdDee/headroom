// HTTP API (PRD 14.2): every route and error code, a full sample run through the API with the
// deterministic model, SSE resume, figure sources and the exports.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PDFParse } from 'pdf-parse';
import { buildApp } from '../../src/server/app.ts';
import { RunManager } from '../../src/server/run-manager.ts';
import { UploadStore } from '../../src/server/uploads.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import type { AppEnv } from '../../src/config/env.ts';

const rates = JSON.parse(readFileSync('data/rates/kurs.json', 'utf8')) as Record<
  string,
  { status: number; body: string }
>;
const rules = loadRules();
const NOW = Date.parse('2026-11-26T09:00:00Z');

function env(over: Partial<AppEnv> = {}): AppEnv {
  return {
    port: 0,
    uploadMaxMb: 1,
    offline: false,
    hasModelKey: true,
    models: { reader: 'claude-sonnet-5-5', verifier: 'claude-sonnet-5-5' },
    root: '.',
    keyEnv: 'GEMINI_API_KEY',
    maxRpm: 0,
    ...over,
  };
}

async function app(over: Partial<AppEnv> = {}): Promise<{ app: FastifyInstance; uploadsDir: string }> {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'headroom-uploads-'));
  const t0 = Date.now();
  const e = env(over);
  const runs = new RunManager({
    env: e,
    rules,
    profilesDir: 'data/profiles',
    liveFetcher: async (u) => rates[u] ?? { status: 503, body: '' },
    modelBackend: () => fakeModel(),
    now: () => NOW + Date.now() - t0,
    quietMs: 300,
  });
  const a = await buildApp({
    env: e,
    runs,
    uploads: new UploadStore(uploadsDir, e.uploadMaxMb * 1024 * 1024),
    rules,
    evidenceFile: join(uploadsDir, 'none.json'),
    version: 'test',
  });
  return { app: a, uploadsDir };
}

async function waitDone(
  a: FastifyInstance,
  runId: string,
): Promise<{ status: string; summary: { status: string } }> {
  for (let i = 0; i < 300; i++) {
    const r = await a.inject({ url: `/api/runs/${runId}` });
    const s = r.json() as { status: string; summary: { status: string } };
    if (s.status !== 'running') return s;
    await new Promise((res) => setTimeout(res, 100));
  }
  const snap = (await a.inject({ url: `/api/runs/${runId}` })).json() as {
    figures: Array<{ key: string; status: string; producedBy: string }>;
    loops: Array<{ status: string; agentId: string }>;
  };
  const stuck = snap.figures.filter((f) => f.status === 'proposed').map((f) => `${f.key}@${f.producedBy}`);
  const running = snap.loops.filter((l) => l.status === 'running').map((l) => l.agentId);
  throw new Error(
    `run did not finish: proposed ${stuck.slice(0, 8).join(', ')} running ${running.join(', ')}`,
  );
}

function multipart(files: Array<{ name: string; body: Buffer }>): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = '----headroomtestboundary';
  const parts = files.flatMap((f) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    f.body,
    Buffer.from('\r\n'),
  ]);
  return {
    payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('API basics and errors', () => {
  let a: FastifyInstance;
  beforeAll(async () => ({ app: a } = await app()));
  afterAll(async () => a.close());

  it('health reports versions and the disclaimer', async () => {
    const r = await a.inject({ url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, mozaikVersion: '6.0.0', mode: 'live', hasModelKey: true });
    expect((r.json() as { disclaimer: string }).disclaimer).toContain('Not financial or tax advice');
  });

  it('lists the 14 synthetic profiles and serves one without ground truth', async () => {
    const list = (await a.inject({ url: '/api/profiles' })).json() as Array<{
      id: string;
      synthetic: boolean;
    }>;
    expect(list.map((p) => p.id)).toHaveLength(14);
    expect(list.every((p) => p.synthetic)).toBe(true);
    const one = await a.inject({ url: '/api/profiles/p07' });
    expect(one.statusCode).toBe(200);
    expect(one.body).not.toContain('plantedErrors');
    expect((await a.inject({ url: '/api/profiles/zz' })).json()).toMatchObject({
      error: { code: 'PROFILE_NOT_FOUND' },
    });
  });

  it('validates run requests and reports unknown runs, figures and routes', async () => {
    expect((await a.inject({ method: 'POST', url: '/api/runs', payload: { mode: 'live' } })).statusCode).toBe(
      400,
    );
    expect(
      (
        await a.inject({ method: 'POST', url: '/api/runs', payload: { profileId: 'p07', mode: 'replay' } })
      ).json(),
    ).toMatchObject({ error: { code: 'REPLAY_NOT_AVAILABLE' } });
    expect((await a.inject({ url: '/api/runs/run-nope' })).json()).toMatchObject({
      error: { code: 'RUN_NOT_FOUND' },
    });
    expect((await a.inject({ url: '/api/nope' })).json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await a.inject({ url: '/api/evidence' })).json()).toMatchObject({
      error: { code: 'NO_EVIDENCE' },
    });
  });

  it('has no showcase without a recording', async () => {
    const r = await a.inject({ url: '/api/showcase' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ runId: null });
  });

  it('serves the rules with their status', async () => {
    const r = (await a.inject({ url: '/api/rules' })).json() as Array<{ id: string; status: string }>;
    expect(r.find((x) => x.id === 'R-FX-DATE')?.status).toBe('assumption');
  });
});

describe('public sample instance', () => {
  it('refuses every upload route and says so in health', async () => {
    const { app: a } = await app({ offline: true, hasModelKey: false, publicDemo: true });
    const h = (await a.inject({ url: '/api/health' })).json() as { publicDemo: boolean; mode: string };
    expect(h).toMatchObject({ publicDemo: true });
    for (const [method, url] of [
      ['POST', '/api/uploads'],
      ['GET', '/api/uploads/u1'],
      ['DELETE', '/api/uploads/u1'],
    ] as const) {
      const r = await a.inject({ method, url });
      expect(r.statusCode).toBe(403);
      expect((r.json() as { error: { code: string } }).error.code).toBe('UPLOADS_DISABLED');
    }
    const live = await a.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { profileId: 'p07', mode: 'live' },
    });
    expect(live.statusCode).toBeGreaterThanOrEqual(400);
    await a.close();
  });
});

describe('NO_MODEL_KEY and offline', () => {
  it('a live run without a key is refused with a message that fits sample or upload', async () => {
    const { app: a } = await app({ hasModelKey: false });
    const r = await a.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { profileId: 'p07', mode: 'live' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({
      error: {
        code: 'NO_MODEL_KEY',
        message: 'No model key found. Run the recorded offline version instead.',
      },
    });
    await a.close();
  });

  it('offline mode refuses live runs', async () => {
    const { app: a } = await app({ offline: true, hasModelKey: false });
    expect(
      (
        await a.inject({ method: 'POST', url: '/api/runs', payload: { profileId: 'p07', mode: 'live' } })
      ).json(),
    ).toMatchObject({ error: { code: 'OFFLINE' } });
    await a.close();
  });
});

describe('a sample run through the API (c01)', () => {
  let a: FastifyInstance;
  let runId: string;
  beforeAll(async () => {
    ({ app: a } = await app());
    const r = await a.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { profileId: 'c01', mode: 'live' },
    });
    expect(r.statusCode).toBe(201);
    runId = (r.json() as { runId: string }).runId;
    await waitDone(a, runId);
  }, 90_000);
  afterAll(async () => a.close());

  it('snapshot holds figures, questions, the card and the summary', async () => {
    const s = (await a.inject({ url: `/api/runs/${runId}` })).json() as {
      status: string;
      figures: Array<{ status: string; sources: unknown[] }>;
      card: { limit6m: { withDraft: { display: string } } } | null;
      summary: { unsourcedFigures: number; maxConcurrentLoops: number };
      synthetic: boolean;
    };
    expect(s.status).toBe('awaiting_user');
    expect(s.synthetic).toBe(true);
    expect(s.figures.filter((f) => f.status === 'verified').every((f) => f.sources.length > 0)).toBe(true);
    expect(s.card?.limit6m.withDraft.display).toMatch(/RSD$/);
    expect(s.summary.unsourcedFigures).toBe(0);
    expect(s.summary.maxConcurrentLoops).toBeGreaterThanOrEqual(4);
  });

  it('streams events over SSE and resumes after Last-Event-ID', async () => {
    const address = await a.listen({ port: 0, host: '127.0.0.1' });
    const read = async (headers: Record<string, string> = {}): Promise<string> => {
      const ctl = new AbortController();
      const res = await fetch(`${address}/api/runs/${runId}/stream`, { headers, signal: ctl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let text = '';
      while (!text.includes('"type":"hr.run.completed"')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      ctl.abort();
      return text;
    };
    const all = await read();
    const ids = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number.parseInt(m[1] ?? '0', 10));
    expect(ids.length).toBeGreaterThan(50);
    const resumed = await read({ 'last-event-id': String(ids.at(-3)) });
    expect([...resumed.matchAll(/^id: (\d+)$/gm)].map((m) => m[1])).toEqual(ids.slice(-2).map(String));
  });

  it('resolves a figure to its sources, drilling into derived inputs', async () => {
    const s = (await a.inject({ url: `/api/runs/${runId}` })).json() as {
      figures: Array<{ id: string; key: string; status: string }>;
    };
    const total = s.figures.find((f) => f.key === 'total:limit6m:withDraft' && f.status === 'verified');
    const r = (await a.inject({ url: `/api/runs/${runId}/figures/${total?.id}` })).json() as {
      sources: Array<{ type: string }>;
    };
    expect(r.sources.map((x) => x.type)).toEqual(['derived', 'rule', 'rule']);
    const doc = s.figures.find(
      (f) => f.key.startsWith('invoice:') && f.key.endsWith(':issueDate') && f.status === 'verified',
    );
    const d = (await a.inject({ url: `/api/runs/${runId}/figures/${doc?.id}` })).json() as {
      sources: Array<{ type: string; lines?: Array<{ cited: boolean }> }>;
    };
    expect(d.sources[0]?.type).toBe('document');
    expect(d.sources[0]?.lines?.some((l) => l.cited)).toBe(true);
    expect((await a.inject({ url: `/api/runs/${runId}/figures/f999999` })).json()).toMatchObject({
      error: { code: 'FIGURE_NOT_FOUND' },
    });
  });

  it('exports the KPO book as CSV (BOM, official columns, totals equal to the verified 6M total) and PDF', async () => {
    const csv = await a.inject({ url: `/api/runs/${runId}/export/kpo.csv` });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('Svega prihodi od delatnosti (3 + 4)');
    expect(csv.body).toContain('SYNTHETIC DATA');
    expect(csv.body).toContain('Not financial or tax advice');
    const s = (await a.inject({ url: `/api/runs/${runId}` })).json() as {
      figures: Array<{ key: string; status: string; value: { amount: string } }>;
    };
    const committed =
      s.figures.find((f) => f.key === 'total:limit6m:committed' && f.status === 'verified')?.value.amount ??
      '';
    const totalLine = csv.body.split('\r\n').find((l) => l.startsWith(',Ukupno')) ?? '';
    expect(Number.parseFloat(totalLine.split(',').at(-1) ?? 'NaN')).toBe(Number.parseFloat(committed));
    const sr = await a.inject({ url: `/api/runs/${runId}/export/kpo.csv?locale=sr` });
    expect(sr.body).toMatch(/;\d+,\d{2}\r\n/);
    const pdf = await a.inject({ url: `/api/runs/${runId}/export/kpo.pdf` });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const parser = new PDFParse({ data: new Uint8Array(pdf.rawPayload) });
    const text = (await parser.getText()).text;
    await parser.destroy();
    expect(text).toContain('KNJIGA O OSTVARENOM PROMETU');
    expect(text).toContain('Ukupno');
    expect(text).toContain('Correction log');
    const corr = await a.inject({ url: `/api/runs/${runId}/export/kpo_corrections.csv` });
    expect(corr.statusCode).toBe(200);
    const kpo = (await a.inject({ url: `/api/runs/${runId}/kpo` })).json() as {
      book: { rows: unknown[] };
      corrections: Array<{ type: string }>;
    };
    expect(kpo.book.rows.length).toBeGreaterThan(0);
    // Only discrepancies that change a book row belong in the correction log (E1, E8, E9 stay in the report).
    for (const c of kpo.corrections) expect(['E2', 'E3', 'E4', 'E5', 'E6', 'E7']).toContain(c.type);
    const report = (await a.inject({ url: `/api/runs/${runId}/export/report.json` })).json() as {
      summary: unknown;
      discrepancies: unknown[];
    };
    expect(report.summary).toBeTruthy();
  });

  it('answers questions and rejects bad answers', async () => {
    const s = (await a.inject({ url: `/api/runs/${runId}` })).json() as {
      questions: Array<{ id: string; options: string[] }>;
    };
    const q = s.questions[0];
    expect(q).toBeDefined();
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/runs/${runId}/questions/${q?.id}/answer`,
          payload: { answer: 'Maybe' },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_ANSWER' } });
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/runs/${runId}/questions/${q?.id}/answer`,
          payload: { answer: 'No' },
        })
      ).statusCode,
    ).toBe(202);
  });

  it('accepts a what-if draft change and rejects an invalid one', async () => {
    const s = (await a.inject({ url: `/api/runs/${runId}` })).json() as { draft: Record<string, string> };
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/runs/${runId}/draft`,
          payload: { ...s.draft, amount: 'abc' },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_DRAFT' } });
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/runs/${runId}/draft`,
          payload: { ...s.draft, amount: '1000.00' },
        })
      ).statusCode,
    ).toBe(202);
  });
});

describe('uploads: detect, map, details, run, delete', () => {
  it('runs on uploaded files and deletes them on request', async () => {
    const { app: a, uploadsDir } = await app({ uploadMaxMb: 5 });
    const dir = 'data/profiles/c02';
    const invoices = (await import('node:fs')).readdirSync(join(dir, 'invoices'));
    const body = multipart([
      ...invoices.map((f) => ({ name: f, body: readFileSync(join(dir, 'invoices', f)) })),
      { name: 'izvod.csv', body: readFileSync(join(dir, 'statement.csv')) },
      { name: 'kpo.csv', body: readFileSync(join(dir, 'kpo.csv')) },
    ]);
    const up = await a.inject({
      method: 'POST',
      url: '/api/uploads',
      payload: body.payload,
      headers: body.headers,
    });
    expect(up.statusCode).toBe(201);
    const { uploadId, files } = up.json() as {
      uploadId: string;
      files: Array<{ name: string; kind: string }>;
    };
    expect(files.filter((f) => f.kind === 'invoice_pdf')).toHaveLength(invoices.length);
    expect(files.find((f) => f.name === 'izvod.csv')?.kind).toBe('statement');
    expect(files.find((f) => f.name === 'kpo.csv')?.kind).toBe('kpo');
    const got = (await a.inject({ url: `/api/uploads/${uploadId}` })).json() as { mappingNeeded: string[] };
    expect(got.mappingNeeded).toEqual([]);
    expect(
      (await a.inject({ method: 'POST', url: '/api/runs', payload: { uploadId, mode: 'live' } })).json(),
    ).toMatchObject({ error: { code: 'NOT_READY' } });
    const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8')) as Record<string, unknown>;
    const details = {
      name: profile['name'],
      pib: profile['pib'],
      activityCode: profile['activityCode'],
      address: profile['address'],
      municipality: profile['municipality'],
      activityExemptFromIndependenceTest: false,
      year: 2026,
      asOf: '2026-11-26',
      clients: JSON.parse(readFileSync(join(dir, 'clients.json'), 'utf8')),
      draft: JSON.parse(readFileSync(join(dir, 'draft.json'), 'utf8')),
    };
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/uploads/${uploadId}/details`,
          payload: { ...details, pib: '12' },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_DETAILS' } });
    expect(
      (await a.inject({ method: 'POST', url: `/api/uploads/${uploadId}/details`, payload: details }))
        .statusCode,
    ).toBe(200);
    const run = await a.inject({ method: 'POST', url: '/api/runs', payload: { uploadId, mode: 'live' } });
    expect(run.statusCode).toBe(201);
    const runId = (run.json() as { runId: string }).runId;
    const done = (await waitDone(a, runId)) as unknown as {
      synthetic: boolean;
      summary: { headroom: { disclaimer: string } };
    };
    expect(done.synthetic).toBe(false);
    expect(done.summary.headroom.disclaimer.startsWith('Not financial or tax advice')).toBe(true);
    expect((await a.inject({ method: 'DELETE', url: `/api/uploads/${uploadId}` })).statusCode).toBe(204);
    expect(existsSync(join(uploadsDir, uploadId))).toBe(false);
    expect((await a.inject({ url: `/api/runs/${runId}` })).json()).toMatchObject({
      error: { code: 'RUN_NOT_FOUND' },
    });
    expect((await a.inject({ url: `/api/uploads/${uploadId}` })).json()).toMatchObject({
      error: { code: 'UPLOAD_NOT_FOUND' },
    });
    await a.close();
  }, 120_000);

  it('refuses files over the size limit, bad names and bad mappings', async () => {
    const { app: a } = await app({ uploadMaxMb: 1 });
    const big = multipart([{ name: 'big.csv', body: Buffer.alloc(2 * 1024 * 1024, 65) }]);
    expect(
      (
        await a.inject({ method: 'POST', url: '/api/uploads', payload: big.payload, headers: big.headers })
      ).json(),
    ).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
    const hidden = multipart([{ name: '.env', body: Buffer.from('x') }]);
    expect(
      (
        await a.inject({
          method: 'POST',
          url: '/api/uploads',
          payload: hidden.payload,
          headers: hidden.headers,
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_FILE_NAME' } });
    const ok = multipart([{ name: 'notes.csv', body: Buffer.from('a,b\n1,2\n') }]);
    const up = (
      await a.inject({ method: 'POST', url: '/api/uploads', payload: ok.payload, headers: ok.headers })
    ).json() as { uploadId: string };
    expect((await a.inject({ url: `/api/uploads/${up.uploadId}` })).json()).toMatchObject({
      mappingNeeded: ['notes.csv'],
    });
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/api/uploads/${up.uploadId}/mapping`,
          payload: { file: 'notes.csv', mapping: { kind: 'statement' } },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_MAPPING' } });
    expect((await a.inject({ url: '/api/uploads/u-000000000000' })).json()).toMatchObject({
      error: { code: 'UPLOAD_NOT_FOUND' },
    });
    await a.close();
  });

  it('re-reads a CSV with the header line, separator and encoding the user chooses', async () => {
    const { app: a } = await app();
    const body = Buffer.from('Banka Probna\nDatum;Opis;Iznos\n05.01.2026;Uplata;120.000,00\n');
    const f = multipart([{ name: 'izvod.csv', body }]);
    const up = (
      await a.inject({ method: 'POST', url: '/api/uploads', payload: f.payload, headers: f.headers })
    ).json() as { uploadId: string };
    const url = `/api/uploads/${up.uploadId}/preview`;
    const res = await a.inject({
      method: 'POST',
      url,
      payload: { file: 'izvod.csv', encoding: 'utf-8', delimiter: ';', headerRow: 2 },
    });
    expect(res.json()).toEqual({
      header: ['Datum', 'Opis', 'Iznos'],
      preview: [['05.01.2026', 'Uplata', '120.000,00']],
    });
    expect(
      (
        await a.inject({
          method: 'POST',
          url,
          payload: { file: 'izvod.csv', encoding: 'utf-8', delimiter: ';', headerRow: 40 },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_MAPPING' } });
    expect(
      (
        await a.inject({
          method: 'POST',
          url,
          payload: { file: 'other.csv', encoding: 'utf-8', delimiter: ';', headerRow: 1 },
        })
      ).json(),
    ).toMatchObject({ error: { code: 'BAD_MAPPING' } });
    await a.close();
  });
});
