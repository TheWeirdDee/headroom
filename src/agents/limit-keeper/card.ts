// Headroom card view model (PRD 16.2), built from verified figures only. Every number carries the id of
// the figure it comes from (or the rule, for the fixed limits), so the UI can open its source.
import { keys } from '../../domain/keys.ts';
import { band, type Band, type BandThresholds } from '../../domain/limits.ts';
import { formatPercentSr, formatRsd, formatSr } from '../../domain/money.ts';
import { DISCLAIMER, DISCLAIMER_USER_FILES } from '../../domain/copy.ts';
import type { RuleBook } from '../../domain/rules/engine.ts';
import type { RunInputs } from '../../engine/inputs.ts';
import type { HeadroomState } from '../../runtime/state.ts';
import type { Figure } from '../../domain/types.ts';

export interface MoneyVM {
  display: string;
  amount: string;
  figureId?: string;
  ruleId?: string;
}

export interface CardVM {
  asOf: string;
  limit6m: {
    committed: MoneyVM;
    withDraft: MoneyVM;
    headroomWithDraft: MoneyVM;
    limit: MoneyVM;
    ratioWithDraft: { display: string; value: string; figureId: string };
    band: Band;
    consequenceRuleId?: string;
  };
  vat8m: {
    committed: MoneyVM;
    withDraft: MoneyVM;
    headroomWithDraft: MoneyVM;
    threshold: MoneyVM;
    band: Band;
    consequenceRuleId?: string;
    assumptionRuleIds: string[];
  };
  independence: Array<{
    clientId: string;
    clientName: string;
    met: number;
    notMet: number;
    unknown: number;
    status: string;
    statusFigureId?: string;
    share12mWithDraft?: {
      display: string;
      value: string;
      figureId: string;
      window?: { from: string; to: string };
    };
  }>;
  draft: {
    amount: { display: string; amount: string; currency: string; figureId?: string };
    amountRSD?: MoneyVM;
  };
  assumptionRuleIds: string[];
  disclaimer: string;
}

const moneyVM = (f: Figure | undefined): MoneyVM | undefined =>
  f?.value.t === 'money'
    ? { display: formatRsd(f.value.amount), amount: f.value.amount, figureId: f.id }
    : undefined;

export function buildCard(state: HeadroomState, rules: RuleBook, inputs: RunInputs): CardVM | undefined {
  const v = (key: string): Figure | undefined => state.verified(key);
  const c6 = moneyVM(v(keys.total('limit6m', 'committed')));
  const w6 = moneyVM(v(keys.total('limit6m', 'withDraft')));
  const h6 = moneyVM(v(keys.headroom('limit6m', 'withDraft')));
  const r6 = v(keys.ratio('limit6m', 'withDraft'));
  const c8 = moneyVM(v(keys.total('vat8m', 'committed')));
  const w8 = moneyVM(v(keys.total('vat8m', 'withDraft')));
  const h8 = moneyVM(v(keys.headroom('vat8m', 'withDraft')));
  if (!c6 || !w6 || !h6 || r6?.value.t !== 'ratio' || !c8 || !w8 || !h8) return undefined;

  const thresholds: BandThresholds = {
    amberFrom: rules.decimalParam('R-LIMIT-BANDS', 'amberFrom'),
    redFrom: rules.decimalParam('R-LIMIT-BANDS', 'redFrom'),
    crossedFrom: rules.decimalParam('R-LIMIT-BANDS', 'crossedFrom'),
  };
  const limit = rules.decimalParam('R-LIMIT-6M', 'limitRSD');
  const threshold = rules.decimalParam('R-VAT-8M', 'thresholdRSD');
  const band6 = band(w6.amount, limit, thresholds);
  const band8 = band(w8.amount, threshold, thresholds);

  const independence: CardVM['independence'] = inputs.clients.map((c) => {
    const status = v(keys.indepStatus(c.id));
    const criteria = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => v(keys.criterion(c.id, n)));
    const tri = criteria.map((f) => (f?.value.t === 'tri' ? f.value.value : 'unknown'));
    const share = v(keys.share12m(c.id, 'withDraft'));
    return {
      clientId: c.id,
      clientName: c.name,
      met: tri.filter((t) => t === 'met').length,
      notMet: tri.filter((t) => t === 'not_met').length,
      unknown: tri.filter((t) => t === 'unknown').length,
      status: status?.value.t === 'text' ? status.value.text : 'pending',
      ...(status ? { statusFigureId: status.id } : {}),
      ...(share?.value.t === 'ratio'
        ? {
            share12mWithDraft: {
              display: formatPercentSr(share.value.value),
              value: share.value.value,
              figureId: share.id,
              ...(share.value.window ? { window: share.value.window } : {}),
            },
          }
        : {}),
    };
  });

  const draftAmountFig = state
    .figuresWhere((f) => f.key === keys.draft('amount') && f.status === 'verified')
    .pop();
  const draftRsd = moneyVM(v(keys.draft('amountRSD')));
  return {
    asOf: state.config.asOf,
    limit6m: {
      committed: c6,
      withDraft: w6,
      headroomWithDraft: h6,
      limit: { display: formatRsd(limit), amount: limit, ruleId: 'R-LIMIT-6M' },
      ratioWithDraft: { display: formatPercentSr(r6.value.value), value: r6.value.value, figureId: r6.id },
      band: band6,
      ...(band6 === 'crossed' ? { consequenceRuleId: 'R-LIMIT-6M-CONSEQUENCE' } : {}),
    },
    vat8m: {
      committed: c8,
      withDraft: w8,
      headroomWithDraft: h8,
      threshold: { display: formatRsd(threshold), amount: threshold, ruleId: 'R-VAT-8M' },
      band: band8,
      ...(band8 === 'crossed' ? { consequenceRuleId: 'R-VAT-8M-REGISTRATION' } : {}),
      assumptionRuleIds: ['R-VAT-8M-BASIS'],
    },
    independence,
    draft: {
      amount: {
        display: `${formatSr(inputs.draft.amount)} ${inputs.draft.currency}`,
        amount: inputs.draft.amount,
        currency: inputs.draft.currency,
        ...(draftAmountFig ? { figureId: draftAmountFig.id } : {}),
      },
      ...(draftRsd ? { amountRSD: draftRsd } : {}),
    },
    assumptionRuleIds: rules.assumptions().map((r) => r.id),
    disclaimer: inputs.synthetic ? DISCLAIMER : DISCLAIMER_USER_FILES,
  };
}
