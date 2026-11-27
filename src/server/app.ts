// HTTP API (PRD 14.2). Errors are {error:{code,message,details?}} with the right status code.
import type { RunSummary } from '../engine/run-engine.ts';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RunError, type RunManager } from './run-manager.ts';
import { UploadError, type UploadStore } from './uploads.ts';
import { ExportError, correctionsCsv, kpoCsv } from '../exporters/kpo.ts';
import { kpoPdf } from '../exporters/kpo-pdf.ts';
import { DraftSchema } from '../engine/load-inputs.ts';
import { MOZAIK_PACKAGE } from '../runtime/mozaik/runtime.ts';
import { AUTHORITY_BOUNDARY, DISCLAIMER } from '../domain/copy.ts';
import type { AppEnv } from '../config/env.ts';
import type { RuleBook } from '../domain/rules/engine.ts';

export interface AppDeps {
  env: AppEnv;
  runs: RunManager;
  uploads: UploadStore;
  rules: RuleBook;
  webDist?: string;
  evidenceFile: string;
  version: string;
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply
    .status(status)
    .send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

const StartRun = z
  .object({
    profileId: z.string().optional(),
    uploadId: z.string().optional(),
    draft: DraftSchema.optional(),
    mode: z.enum(['live', 'replay']),
    fault: z.literal('misread-amount').optional(),
  })
  .refine(
    (b) => (b.profileId === undefined) !== (b.uploadId === undefined),
    'Give either profileId or uploadId',
  );

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(multipart, { limits: { fileSize: d.env.uploadMaxMb * 1024 * 1024, files: 200 } });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof RunError) return sendError(reply, err.status, err.code, err.message);
    if (err instanceof UploadError)
      return sendError(
        reply,
        err.code === 'UPLOAD_NOT_FOUND' ? 404 : err.code === 'FILE_TOO_LARGE' ? 413 : 400,
        err.code,
        err.message,
        err.details,
      );
    if (err instanceof ExportError) return sendError(reply, 409, err.code, err.message);
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE')
      return sendError(reply, 413, 'FILE_TOO_LARGE', `A file is larger than ${d.env.uploadMaxMb} MB`);
    if (e.code === 'FST_FILES_LIMIT')
      return sendError(reply, 400, 'TOO_MANY_FILES', 'At most 200 files per upload');
    if (typeof e.statusCode === 'number' && e.statusCode < 500)
      return sendError(reply, e.statusCode, e.code ?? 'BAD_REQUEST', e.message ?? 'Bad request');
    return sendError(reply, 500, 'INTERNAL', err instanceof Error ? err.message : 'Internal error');
  });

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success)
      throw Object.assign(
        new Error(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')),
        { statusCode: 400, code: 'BAD_REQUEST' },
      );
    return r.data;
  };

  // A frontend hosted on another origin (HEADROOM_CORS_ORIGINS) may call the API; nobody else.
  const corsOrigins = new Set(d.env.corsOrigins ?? []);
  // A public sample instance is read-only (no uploads, no key), so any site may show its samples.
  const allowedOrigin = (o: unknown): string | undefined =>
    typeof o === 'string' && (d.env.publicDemo === true || corsOrigins.has(o)) ? o : undefined;
  if (corsOrigins.size > 0 || d.env.publicDemo)
    app.addHook('onRequest', async (req, reply) => {
      const origin = allowedOrigin(req.headers.origin);
      if (!origin) return;
      reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      if (req.method === 'OPTIONS')
        return reply
          .status(204)
          .header('access-control-allow-methods', 'GET, POST, DELETE')
          .header('access-control-allow-headers', 'content-type, last-event-id')
          .header('access-control-max-age', '600')
          .send();
    });

  // A public sample instance takes no files: only the bundled synthetic samples run there.
  if (d.env.publicDemo)
    app.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/api/uploads'))
        return sendError(
          reply,
          403,
          'UPLOADS_DISABLED',
          'This public instance runs the recorded synthetic samples only. To check your own files, run Headroom on your computer (see the README).',
        );
    });

  app.get('/api/health', async () => ({
    ok: true,
    publicDemo: d.env.publicDemo === true,
    version: d.version,
    mozaikVersion: MOZAIK_PACKAGE.version,
    mode: d.env.offline ? 'offline' : 'live',
    hasModelKey: d.env.hasModelKey,
    keyEnv: d.env.keyEnv,
    maxRpm: d.env.maxRpm,
    models: d.env.models,
    disclaimer: DISCLAIMER,
    authorityBoundary: AUTHORITY_BOUNDARY,
  }));

  app.get('/api/rules', async () => d.rules.all());

  app.get('/api/profiles', async () => d.runs.profiles());

  app.get<{ Params: { id: string } }>('/api/profiles/:id', async (req) => {
    const p = d.runs.profiles().find((x) => x.id === req.params.id);
    if (!p) throw new RunError('PROFILE_NOT_FOUND', 'No such sample profile', 404);
    const dir = join('data', 'profiles', p.id);
    const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { ...p, profile: read('profile.json'), clients: read('clients.json'), draft: read('draft.json') };
  });

  app.post('/api/uploads', async (req, reply) => {
    const files: Array<{ name: string; bytes: Buffer }> = [];
    for await (const part of req.files()) files.push({ name: part.filename, bytes: await part.toBuffer() });
    return reply.status(201).send(d.uploads.create(files));
  });

  app.get<{ Params: { uploadId: string } }>('/api/uploads/:uploadId', async (req) =>
    d.uploads.get(req.params.uploadId),
  );

  app.post<{ Params: { uploadId: string } }>('/api/uploads/:uploadId/mapping', async (req) => {
    const body = parse(z.object({ file: z.string(), mapping: z.unknown() }), req.body);
    d.uploads.setMapping(req.params.uploadId, body.file, body.mapping);
    return { ok: true };
  });

  app.post<{ Params: { uploadId: string } }>('/api/uploads/:uploadId/preview', async (req) =>
    d.uploads.preview(req.params.uploadId, req.body),
  );

  app.post<{ Params: { uploadId: string } }>('/api/uploads/:uploadId/details', async (req) => {
    d.uploads.setDetails(req.params.uploadId, req.body);
    return { ok: true };
  });

  app.delete<{ Params: { uploadId: string } }>('/api/uploads/:uploadId', async (req, reply) => {
    d.uploads.dir(req.params.uploadId);
    d.runs.forgetUpload(req.params.uploadId);
    d.uploads.delete(req.params.uploadId);
    return reply.status(204).send();
  });

  app.post('/api/runs', async (req, reply) => {
    const b = parse(StartRun, req.body);
    const runId = b.profileId
      ? await d.runs.start({
          profileId: b.profileId,
          mode: b.mode,
          ...(b.draft ? { draft: b.draft } : {}),
          ...(b.fault ? { fault: b.fault } : {}),
        })
      : await d.runs.start({
          uploadId: b.uploadId ?? '',
          uploadDir: d.uploads.prepare(b.uploadId ?? ''),
          mode: b.mode,
          ...(b.draft ? { draft: b.draft } : {}),
        });
    return reply.status(201).send({ runId });
  });

  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (req) =>
    d.runs.snapshot(req.params.runId),
  );

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/stream', (req, reply) => {
    const r = d.runs.get(req.params.runId);
    const raw = req.headers['last-event-id'];
    const last = typeof raw === 'string' && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : undefined;
    reply.hijack();
    // The stream writes its own headers, so the CORS header is set on the raw response first.
    const origin = allowedOrigin(req.headers.origin);
    if (origin) {
      reply.raw.setHeader('access-control-allow-origin', origin);
      reply.raw.setHeader('vary', 'Origin');
    }
    r.hub.attach(reply.raw, last);
  });

  app.post<{ Params: { runId: string } }>('/api/runs/:runId/draft', async (req, reply) => {
    d.runs.changeDraft(req.params.runId, req.body);
    return reply.status(202).send({ ok: true });
  });

  app.post<{ Params: { runId: string; qid: string } }>(
    '/api/runs/:runId/questions/:qid/answer',
    async (req, reply) => {
      const b = parse(z.object({ answer: z.string() }), req.body);
      d.runs.answer(req.params.runId, req.params.qid, b.answer);
      return reply.status(202).send({ ok: true });
    },
  );

  app.get<{ Params: { runId: string; figureId: string } }>(
    '/api/runs/:runId/figures/:figureId',
    async (req) => d.runs.figure(req.params.runId, req.params.figureId),
  );

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/kpo', async (req) => d.runs.kpo(req.params.runId));

  app.get<{ Params: { runId: string }; Querystring: { locale?: string } }>(
    '/api/runs/:runId/export/kpo.csv',
    async (req, reply) => {
      const x = d.runs.kpo(req.params.runId);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="kpo-${x.book.year}.csv"`)
        .send(kpoCsv(x, req.query.locale === 'sr' ? 'sr' : 'default'));
    },
  );

  app.get<{ Params: { runId: string } }>(
    '/api/runs/:runId/export/kpo_corrections.csv',
    async (req, reply) => {
      const x = d.runs.kpo(req.params.runId);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="kpo-corrections-${x.book.year}.csv"`)
        .send(correctionsCsv(x));
    },
  );

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/export/kpo.pdf', async (req, reply) => {
    const x = d.runs.kpo(req.params.runId);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="kpo-${x.book.year}.pdf"`)
      .send(await kpoPdf(x));
  });

  app.get<{ Params: { runId: string } }>('/api/runs/:runId/export/report.json', async (req, reply) =>
    reply
      .header('content-disposition', 'attachment; filename="report.json"')
      .send(d.runs.report(req.params.runId)),
  );

  // The landing page's hero card and proof excerpt come from a replay of the committed demo recording.
  app.get('/api/showcase', async () => {
    // No recording yet is a normal state (null), not an error: the landing page then leaves the sections out.
    const runId = (await d.runs.showcase('p07')) ?? null;
    const s = runId ? (d.runs.recordedSummary('p07') as Partial<RunSummary> | undefined) : undefined;
    // The figures of the recorded live run itself (the showcase replays it without its delays).
    const recorded = s
      ? {
          models: s.models,
          wallTimeMs: s.wallTimeMs,
          sumLoopTimeMs: s.sumLoopTimeMs,
          maxConcurrentLoops: s.maxConcurrentLoops,
          loops: s.loops,
          failedLoops: s.failedLoops,
          verified: s.figures?.verified,
          unsourcedFigures: s.unsourcedFigures,
          agentConflicts: d.runs.recordedAgentConflicts('p07') ?? null,
          loopTimes: d.runs.recordedLoops('p07'),
        }
      : null;
    return { runId, recorded };
  });

  app.get('/api/evidence', async (_req, reply) => {
    if (!existsSync(d.evidenceFile))
      return sendError(reply, 404, 'NO_EVIDENCE', 'No evaluation results yet. Run npm run eval.');
    return reply.header('content-type', 'application/json').send(readFileSync(d.evidenceFile, 'utf8'));
  });

  app.all('/api/*', async (_req, reply) => sendError(reply, 404, 'NOT_FOUND', 'No such API route'));

  if (d.webDist && existsSync(join(d.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: d.webDist, prefix: '/' });
    app.setNotFoundHandler((_req, reply) => reply.type('text/html').sendFile('index.html'));
  }
  return app;
}
