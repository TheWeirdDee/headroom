import { describe, expect, it } from 'vitest';
import { registerVerifier } from '../../src/agents/verifier/agent.ts';
import { checkPlausibility } from '../../src/agents/verifier/fidelity.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { createKursClient } from '../../src/integrations/kurs/client.ts';
import { sha256 } from '../../src/util/hash.ts';
import { makeRuntime, makeState, msg, scripted, tick } from '../helpers/runtime.ts';
import type { RunInputs } from '../../src/engine/inputs.ts';
import type { SourceRef } from '../../src/domain/types.ts';
import type { AgentDeps } from '../../src/agents/common.ts';
import type { PostFigureInput } from '../../src/runtime/state.ts';

const PAGE = [
  'FAKTURA',
  'Broj fakture: 2026-041',
  'Datum izdavanja: 14.03.2026.',
  'Ukupno za uplatu: 4.000,00 EUR',
].join('\n');
const KPO_LINE = '1,2026-03-20,Faktura 2026-041,0.00,470000.00,470000.00';

function inputs(): RunInputs {
  return {
    inputId: 't',
    synthetic: true,
    profile: {
      id: 't',
      synthetic: true,
      name: 'X',
      pib: '1',
      activityCode: '6201',
      registrationDate: '2020-01-01',
      municipality: 'B',
      address: 'A',
      activityExemptFromIndependenceTest: false,
    },
    clients: [],
    draft: {
      clientId: 'c',
      currency: 'RSD',
      amount: '1',
      issueDate: '2026-11-26',
      description: '',
      kind: 'service',
    },
    documents: [
      { kind: 'readable', docId: 'inv-041', fileName: 'inv-041.pdf', sha256: 'x', pages: [PAGE] },
      {
        kind: 'readable',
        docId: 'inv-041-copy',
        fileName: 'inv-041-copy.pdf',
        sha256: 'y',
        pages: [PAGE.replace('14.03.2026.', '15.03.2026.')],
      },
    ],
    statements: [],
    kpo: {
      file: 'kpo.csv',
      rows: [
        {
          rowIndex: 1,
          rawLine: KPO_LINE,
          entryDate: '2026-03-20',
          description: 'Faktura 2026-041',
          productsRSD: '0',
          servicesRSD: '470000',
          totalRSD: '470000',
        },
      ],
      errors: [],
    },
    manifest: {},
  };
}

const docSrc = (excerpt: string): Extract<SourceRef, { type: 'document' }> => ({
  type: 'document',
  docId: 'inv-041',
  page: 1,
  lineStart: 1,
  lineEnd: 1,
  excerpt,
  excerptSha256: sha256(excerpt),
});
const numberSrc = docSrc('Broj fakture: 2026-041');
const kpoSrc: SourceRef = {
  type: 'kpo_row',
  file: 'kpo.csv',
  rowIndex: 1,
  rawLine: KPO_LINE,
  rawLineSha256: sha256(KPO_LINE),
};

function setup() {
  const state = makeState();
  const rt = makeRuntime(
    'memory',
    scripted(() => msg('{}')),
    state,
  );
  const deps: AgentDeps = {
    rt,
    rules: loadRules(),
    inputs: inputs(),
    kurs: createKursClient({
      fetcher: async () => ({ status: 503, body: '' }),
      now: () => 0,
      sleep: async () => {},
    }),
    now: () => Date.parse('2026-11-26T09:00:00Z'),
    today: () => '2026-11-26',
  };
  registerVerifier(deps);
  const post = (p: Omit<PostFigureInput, 'idempotencyKey' | 'kind'> & { kind?: PostFigureInput['kind'] }) =>
    state.postFigure({
      kind: 'invoice_field',
      idempotencyKey: `${p.producedBy}/${p.key}/${JSON.stringify(p.value)}`,
      ...p,
    }).figure;
  return { state, rt, post };
}

const settle = () => tick(30);

describe('Verifier reason codes', () => {
  it('verifies a correct document figure', async () => {
    const { state, post } = setup();
    const f = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect(state.figures.get(f.id)?.status).toBe('verified');
    expect(state.figures.get(f.id)?.checks?.map((c) => c.name)).toEqual([
      'source_presence',
      'integrity',
      'fidelity',
      'plausibility',
    ]);
  });

  it('UNSOURCED: a source that does not resolve', async () => {
    const { state, post } = setup();
    const f = post({
      key: 'invoice:2026-041:amountRSD',
      value: { t: 'money', amount: '1', currency: 'RSD' },
      sources: [{ type: 'derived', figureIds: ['f999'] }],
      producedBy: 'rate-clerk',
    });
    await settle();
    expect(state.figures.get(f.id)?.status).toBe('contested');
    expect(state.rejections.get('UNSOURCED')).toBe(1);
  });

  it('SOURCE_MISMATCH: an excerpt hash that does not match, or text not in the page', async () => {
    const { state, post } = setup();
    const bad = { ...docSrc('Datum izdavanja: 14.03.2026.'), excerptSha256: sha256('something else') };
    const a = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [bad],
      producedBy: 'invoice-reader',
    });
    const b = post({
      key: 'invoice:2026-041:supplyDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [docSrc('Datum prometa: 14.03.2026.')],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect([state.figures.get(a.id)?.status, state.figures.get(b.id)?.status]).toEqual([
      'contested',
      'contested',
    ]);
    expect(state.rejections.get('SOURCE_MISMATCH')).toBe(2);
  });

  it('DERIVATION_MISMATCH: a conversion that does not recompute to the cent', async () => {
    const { state, post } = setup();
    const amount = post({
      key: 'invoice:2026-041:amount',
      value: { t: 'money', amount: '4000', currency: 'EUR' },
      sources: [docSrc('Ukupno za uplatu: 4.000,00 EUR'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect(state.figures.get(amount.id)?.status).toBe('verified');
    const rsd = post({
      key: 'invoice:2026-041:amountRSD',
      kind: 'amount_rsd',
      value: { t: 'money', amount: '4000.01', currency: 'RSD' },
      sources: [{ type: 'derived', figureIds: [amount.id] }],
      derivation: { ruleId: 'R-FX', inputs: [amount.id], formula: 'test' },
      producedBy: 'rate-clerk',
    });
    await settle();
    expect(state.figures.get(rsd.id)?.status).toBe('contested');
    expect(state.rejections.get('DERIVATION_MISMATCH')).toBe(1);
    // An EUR amount with no rate among the inputs cannot produce an RSD amount.
    expect(state.figures.get(rsd.id)?.checks?.find((c) => c.name === 'derivation')?.passed).toBe(false);
  });

  it('NOT_SUPPORTED_BY_SOURCE: the excerpt does not show the claimed value', async () => {
    const { state, post } = setup();
    const f = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-15' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect(state.figures.get(f.id)?.status).toBe('contested');
    expect(state.rejections.get('NOT_SUPPORTED_BY_SOURCE')).toBe(1);
  });

  it('IMPLAUSIBLE: dates outside the tax year +-1, non-positive amounts, unknown currencies', () => {
    const fig = (key: string, value: object) =>
      ({
        id: 'f',
        key,
        kind: 'invoice_field',
        value,
        sources: [numberSrc],
        producedBy: 'x',
        version: 1,
        status: 'proposed',
        createdAt: '',
        scope: 'committed',
      }) as never;
    expect(
      checkPlausibility(fig('invoice:2026-041:issueDate', { t: 'date', iso: '2019-03-14' }), 2026),
    ).toMatch(/outside 2025-2027/);
    expect(
      checkPlausibility(fig('invoice:2026-041:amount', { t: 'money', amount: '0', currency: 'EUR' }), 2026),
    ).toMatch(/not positive/);
    expect(checkPlausibility(fig('invoice:2026-041:currency', { t: 'text', text: 'BTC' }), 2026)).toMatch(
      /not supported/,
    );
    expect(
      checkPlausibility(fig('invoice:2026-041:issueDate', { t: 'date', iso: '2026-03-14' }), 2026),
    ).toBeUndefined();
  });
});

describe('Verifier conflict resolution', () => {
  it('both sources check out: the invoice outranks the KPO book, which is superseded and becomes E2', async () => {
    const { state, post } = setup();
    const doc = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    const book = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-20' },
      sources: [kpoSrc],
      producedBy: 'kpo-reader',
    });
    await settle();
    expect(state.figures.get(doc.id)?.status).toBe('verified');
    expect(state.figures.get(book.id)?.status).toBe('superseded');
    const e2 = [...state.discrepancies.values()].find((d) => d.type === 'E2');
    expect(e2?.sources.map((s) => s.type)).toEqual(['document', 'document', 'kpo_row']);
  });

  it('the book arrives first and is verified; the document still wins when it arrives', async () => {
    const { state, post } = setup();
    const book = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-20' },
      sources: [kpoSrc],
      producedBy: 'kpo-reader',
    });
    await settle();
    expect(state.figures.get(book.id)?.status).toBe('verified');
    const doc = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect(state.verified('invoice:2026-041:issueDate')?.id).toBe(doc.id);
    expect(state.figures.get(book.id)?.status).toBe('superseded');
  });

  it('only one claim checks out: it wins and the other is contested', async () => {
    const { state, post } = setup();
    const wrongDoc = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-04-01' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    const book = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-20' },
      sources: [kpoSrc],
      producedBy: 'kpo-reader',
    });
    await settle();
    expect(state.figures.get(book.id)?.status).toBe('verified');
    expect(state.figures.get(wrongDoc.id)?.status).toBe('contested');
  });

  it('equal authority: two invoice documents disagree; both go to the user, E-CONFLICT and a question', async () => {
    const { state, post } = setup();
    const copy = (excerpt: string): SourceRef => ({ ...docSrc(excerpt), docId: 'inv-041-copy' });
    const a = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-14' },
      sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    const b = post({
      key: 'invoice:2026-041:issueDate',
      value: { t: 'date', iso: '2026-03-15' },
      sources: [copy('Datum izdavanja: 15.03.2026.'), copy('Broj fakture: 2026-041')],
      producedBy: 'invoice-reader-2',
    });
    await settle();
    expect([state.figures.get(a.id)?.status, state.figures.get(b.id)?.status]).toEqual([
      'needs_user',
      'needs_user',
    ]);
    expect(state.verified('invoice:2026-041:issueDate')).toBeUndefined();
    expect([...state.discrepancies.values()].map((d) => d.type)).toContain('E-CONFLICT');
    expect([...state.questions.values()].some((q) => q.askedBy === 'verifier')).toBe(true);
  });

  it('a currency the excerpt does not show is not supported', async () => {
    const { state, post } = setup();
    const f = post({
      key: 'invoice:2026-041:amount',
      value: { t: 'money', amount: '4000', currency: 'RSD' },
      sources: [docSrc('Ukupno za uplatu: 4.000,00 EUR'), numberSrc],
      producedBy: 'invoice-reader',
    });
    await settle();
    expect(state.figures.get(f.id)?.status).toBe('contested');
  });

  it('a key disputed three times goes to the user instead of being contested again', async () => {
    const { state, post } = setup();
    const ids = [];
    for (const day of ['15', '16', '17']) {
      ids.push(
        post({
          key: 'invoice:2026-041:issueDate',
          value: { t: 'date', iso: `2026-03-${day}` },
          sources: [docSrc('Datum izdavanja: 14.03.2026.'), numberSrc],
          producedBy: 'invoice-reader',
        }).id,
      );
      await settle();
    }
    expect(ids.map((id) => state.figures.get(id)?.status)).toEqual(['contested', 'contested', 'needs_user']);
  });
});
