// A live run once ended with the KPO book's amount verified over the converted invoice amount, so the card
// showed a wrong total as complete: the book's claim arrived while the conversion was still waiting for its
// rate to be verified. The stronger source must win in every order of arrival.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerVerifier } from '../../src/agents/verifier/agent.ts';
import { evidenceGate } from '../../src/agents/verifier/gate.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { loadInputSet } from '../../src/engine/load-inputs.ts';
import { createKursClient, kursUrl } from '../../src/integrations/kurs/client.ts';
import { sha256 } from '../../src/util/hash.ts';
import { locateExcerpt, type ReadableDocument } from '../../src/inputs/documents.ts';
import { makeRuntime, makeState, msg, scripted, tick } from '../helpers/runtime.ts';
import { smallProfile, writeTempProfile } from '../helpers/profiles.ts';
import type { AgentDeps } from '../../src/agents/common.ts';
import type { SourceRef } from '../../src/domain/types.ts';

const NOW = Date.parse('2026-11-26T09:00:00Z');
const DATE = '2026-11-20';

async function setup() {
  const spec = smallProfile();
  // The book states another RSD amount for the euro invoice than the conversion gives.
  const row = spec.kpo[1];
  if (!row) throw new Error('fixture');
  row.services = '470000.00';
  row.total = '470000.00';
  const { inputs } = await loadInputSet(await writeTempProfile(spec));
  const state = makeState();
  // One verification at a time and a slow judgement, so later claims wait their turn as they do on a free tier.
  state.config.concurrency.verifier = 1;
  const rt = makeRuntime(
    scripted(async () => {
      await tick(60);
      return msg(JSON.stringify({ normalizedValue: 'DE', supports: true, reason: 'the address is German' }));
    }),
    state,
  );
  const kurs = createKursClient({
    now: () => NOW,
    fetcher: async () => ({
      status: 200,
      body: readFileSync(join('test/fixtures/kurs', 'eur-2026-11-20.json'), 'utf8'),
    }),
    sleep: async () => {},
  });
  const deps: AgentDeps = {
    rt,
    gate: evidenceGate(rt, 'verifier'),
    rules: loadRules(),
    inputs,
    kurs,
    now: () => NOW,
    today: () => '2026-11-26',
  };
  registerVerifier(deps);
  const got = await kurs.rate('EUR', DATE, '2026-11-26');
  if (!got.ok) throw new Error(got.detail);
  return { state, rt, inputs, got: got.rate };
}

describe('Verifier: a weaker claim cannot overtake a stronger one that is still being checked', () => {
  it('keeps the converted amount when the book claims the same key before the rate is verified', async () => {
    const { state, rt, inputs, got } = await setup();
    const doc = inputs.documents.find((d) => d.docId === '2026-002') as ReadableDocument;
    const line = (text: string): SourceRef => locateExcerpt(doc, text);
    const post = state.postFigure.bind(state);
    const amount = post({
      key: 'invoice:2026-002:amount',
      kind: 'invoice_field',
      value: { t: 'money', amount: '4000', currency: 'EUR' },
      sources: [line('Total due: EUR 4,000.00'), line('Invoice No. 2026-002')],
      producedBy: 'invoice-reader',
      idempotencyKey: 'a',
    }).figure;
    await tick(20);
    expect(state.figures.get(amount.id)?.status).toBe('verified');

    // A judgement that keeps the Verifier busy.
    post({
      key: 'invoice:2026-002:clientCountry',
      kind: 'invoice_field',
      value: { t: 'text', text: 'DE' },
      sources: [line('Address: Probestraße 9, Berlin, Germany'), line('Invoice No. 2026-002')],
      producedBy: 'invoice-reader',
      idempotencyKey: 'country',
    });
    await tick(5);
    const url = kursUrl('EUR', DATE);
    const body = readFileSync(join('test/fixtures/kurs', 'eur-2026-11-20.json'), 'utf8');
    // The rate, the conversion that depends on it and the book's claim arrive together.
    const rate = post({
      key: `fx:EUR:${DATE}`,
      kind: 'fx_rate',
      value: {
        t: 'rate',
        rate: got.middle,
        base: 'EUR',
        quote: 'RSD',
        parity: got.parity,
        requestedDate: DATE,
        rateDate: got.rateDate,
      },
      sources: [
        {
          type: 'url',
          url,
          fetchedAt: new Date(NOW).toISOString(),
          httpStatus: 200,
          responseSha256: sha256(body),
          jsonPath: '$.exchange_middle',
        },
      ],
      producedBy: 'rate-clerk',
      idempotencyKey: 'r',
    }).figure;
    const converted = post({
      key: 'invoice:2026-002:amountRSD',
      kind: 'amount_rsd',
      value: { t: 'money', amount: '470564.80', currency: 'RSD' },
      sources: [{ type: 'derived', figureIds: [amount.id, rate.id] }],
      derivation: { ruleId: 'R-FX', inputs: [amount.id, rate.id], formula: 'amount x rate' },
      producedBy: 'rate-clerk',
      idempotencyKey: 'c',
    }).figure;
    const kpo = inputs.kpo?.rows[1];
    if (!kpo || !inputs.kpo) throw new Error('fixture');
    const book = post({
      key: 'invoice:2026-002:amountRSD',
      kind: 'invoice_field',
      value: { t: 'money', amount: '470000.00', currency: 'RSD' },
      sources: [
        {
          type: 'kpo_row',
          file: inputs.kpo.file,
          rowIndex: kpo.rowIndex,
          rawLine: kpo.rawLine,
          rawLineSha256: sha256(kpo.rawLine),
        },
      ],
      producedBy: 'kpo-reader',
      idempotencyKey: 'k',
    }).figure;
    await tick(400);
    await rt.shutdown();
    expect([state.figures.get(converted.id)?.status, state.figures.get(book.id)?.status]).toEqual([
      'verified',
      'superseded',
    ]);
    expect(state.verified('invoice:2026-002:amountRSD')?.id).toBe(converted.id);
  });
});
