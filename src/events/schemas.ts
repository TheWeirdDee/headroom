// Event catalogue (PRD 10). Every hr.* event payload has a schema; the run engine validates events it
// produces in tests, and the UI reducer relies on these shapes.
import { z } from 'zod';

const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/);
const IsoDate = z.iso.date();

export const SourceRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('document'),
    docId: z.string(),
    page: z.number().int().min(1),
    lineStart: z.number().int().min(1),
    lineEnd: z.number().int().min(1),
    excerpt: z.string().min(1).max(300),
    excerptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    type: z.literal('statement_row'),
    file: z.string(),
    rowIndex: z.number().int().min(1),
    rawLine: z.string(),
    rawLineSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    type: z.literal('kpo_row'),
    file: z.string(),
    rowIndex: z.number().int().min(1),
    rawLine: z.string(),
    rawLineSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    type: z.literal('url'),
    url: z.url(),
    fetchedAt: z.string(),
    httpStatus: z.number().int(),
    responseSha256: z.string().regex(/^[0-9a-f]{64}$/),
    jsonPath: z.string(),
  }),
  z.object({ type: z.literal('contract_field'), clientId: z.string(), field: z.string(), value: z.string() }),
  z.object({
    type: z.literal('user_answer'),
    questionId: z.string(),
    answeredAt: z.string(),
    answer: z.string(),
  }),
  z.object({ type: z.literal('rule'), ruleId: z.string(), url: z.url() }),
  z.object({ type: z.literal('derived'), figureIds: z.array(z.string()).min(1) }),
]);

export const FigureValueSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('money'),
    amount: DecimalString,
    currency: z.enum(['RSD', 'EUR', 'USD', 'GBP', 'CHF']),
  }),
  z.object({
    t: z.literal('rate'),
    rate: DecimalString,
    base: z.enum(['RSD', 'EUR', 'USD', 'GBP', 'CHF']),
    quote: z.literal('RSD'),
    parity: z.number().int().min(1),
    requestedDate: IsoDate,
    rateDate: IsoDate,
  }),
  z.object({ t: z.literal('date'), iso: IsoDate }),
  z.object({ t: z.literal('text'), text: z.string() }),
  z.object({
    t: z.literal('ratio'),
    value: DecimalString,
    window: z.object({ from: IsoDate, to: IsoDate }).optional(),
  }),
  z.object({ t: z.literal('tri'), value: z.enum(['met', 'not_met', 'unknown']) }),
  z.object({
    t: z.literal('kpoRow'),
    rowNo: z.number().int().min(1),
    date: IsoDate,
    description: z.string(),
    productsRSD: DecimalString,
    servicesRSD: DecimalString,
    totalRSD: DecimalString,
  }),
]);

const ClaimStatus = z.enum(['proposed', 'verified', 'contested', 'superseded', 'needs_user']);

export const FigureSchema = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.string(),
  value: FigureValueSchema,
  sources: z.array(SourceRefSchema).min(1),
  derivation: z.object({ ruleId: z.string(), inputs: z.array(z.string()), formula: z.string() }).optional(),
  producedBy: z.string(),
  version: z.number().int().min(1),
  status: ClaimStatus,
  checks: z
    .array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string().optional() }))
    .optional(),
  createdAt: z.string(),
  scope: z.enum(['committed', 'draft']),
});

const LoopMetric = z.object({
  loopId: z.string(),
  agentId: z.string(),
  loopInputKey: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  tokensIn: z.number(),
  tokensOut: z.number(),
  toolCalls: z.number(),
  error: z.string().optional(),
});

export const PayloadSchemas = {
  'hr.agent.status': z.object({
    agentId: z.string(),
    state: z.enum(['idle', 'working', 'waiting', 'error']),
    doingNow: z.string(),
    loopId: z.string().optional(),
  }),
  'hr.loop.started': z.object({
    loopId: z.string(),
    agentId: z.string(),
    loopInputKey: z.string(),
    startedAt: z.number(),
  }),
  'hr.loop.finished': LoopMetric,
  'hr.loop.failed': LoopMetric,
  'hr.figure.proposed': z.object({ figure: FigureSchema, result: z.enum(['claimed', 'conflict']) }),
  'hr.figure.corroborated': z.object({
    key: z.string(),
    figureId: z.string(),
    by: z.string(),
    sources: z.array(SourceRefSchema),
  }),
  'hr.figure.conflict': z.object({ key: z.string(), existingId: z.string(), proposedId: z.string() }),
  'hr.figure.verified': z.object({
    key: z.string(),
    figureId: z.string(),
    checks: z.array(z.unknown()),
    figure: FigureSchema,
  }),
  'hr.figure.contested': z.object({
    key: z.string(),
    figureId: z.string(),
    reasonCode: z.enum([
      'UNSOURCED',
      'SOURCE_MISMATCH',
      'DERIVATION_MISMATCH',
      'NOT_SUPPORTED_BY_SOURCE',
      'IMPLAUSIBLE',
    ]),
    detail: z.string(),
    producerId: z.string().optional(),
    checks: z.array(z.unknown()).optional(),
  }),
  'hr.figure.superseded': z.object({
    key: z.string(),
    oldId: z.string(),
    newId: z.string().optional(),
    reason: z.string().optional(),
  }),
  'hr.figure.needs_user': z.object({ key: z.string(), figureId: z.string(), reason: z.string().optional() }),
  'hr.participant.error': z.object({
    participantId: z.string(),
    eventId: z.string(),
    eventType: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }),
  'hr.write.vetoed': z.object({ agentId: z.string(), loopId: z.string(), reason: z.string() }),
} as const;

export type KnownEventType = keyof typeof PayloadSchemas;

export function validatePayload(type: string, payload: unknown): { ok: true } | { ok: false; error: string } {
  const schema = (PayloadSchemas as Record<string, z.ZodType | undefined>)[type];
  if (!schema) return { ok: true };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true } : { ok: false, error: r.error.message };
}
