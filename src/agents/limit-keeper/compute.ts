// The totals LimitKeeper proposes, as a pure function of verified figures. The Verifier calls the same
// function with the cited input figures to re-derive each total to the cent (PRD 8.6 step 3).
import { add } from '../../domain/money.ts';
import { yearOf, type DateWindow } from '../../domain/dates.ts';
import { countsForVat, total6m, total8m, type InvoiceFact, type VatScope } from '../../domain/limits.ts';
import type { RuleBook } from '../../domain/rules/engine.ts';
import type { Client, Draft, RunConfig } from '../../domain/types.ts';

export interface DraftFact {
  amountRSD: string;
  figureId: string;
}

export interface Totals {
  limit6m: {
    committed: { total: string; inputs: string[]; included: string[] };
    withDraft: { total: string; inputs: string[]; draftCounted: boolean };
    limit: string;
  };
  vat8m: {
    committed: {
      total: string;
      inputs: string[];
      window: DateWindow;
      included: string[];
      excluded: string[];
    };
    withDraft: { total: string; inputs: string[]; window: DateWindow; draftCounted: boolean };
    threshold: string;
  };
}

export function vatScope(rules: RuleBook): VatScope {
  return {
    includeProducts: rules.boolParam('R-VAT-8M-SCOPE', 'includeProducts'),
    includeServicesDomestic: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesDomestic'),
    includeServicesForeignNonBusiness: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesForeignNonBusiness'),
    includeServicesForeignBusiness: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesForeignBusiness'),
  };
}

export function draftCountsForVat(draft: Draft, clients: Client[], scope: VatScope): boolean {
  const client = clients.find((c) => c.id === draft.clientId);
  return countsForVat(
    {
      kind: draft.kind,
      clientCountry: client?.country ?? 'RS',
      clientIsBusiness: client?.isBusiness ?? true,
    },
    scope,
  );
}

export function computeTotals(args: {
  facts6m: InvoiceFact[];
  facts8m: InvoiceFact[];
  draft: Draft;
  draftFact: DraftFact | undefined;
  clients: Client[];
  config: RunConfig;
  rules: RuleBook;
}): Totals {
  const { config, rules, draft, draftFact } = args;
  const limit = rules.decimalParam('R-LIMIT-6M', 'limitRSD');
  const threshold = rules.decimalParam('R-VAT-8M', 'thresholdRSD');
  const scope = vatScope(rules);
  const c6 = total6m(args.facts6m, config.year);
  const draftIn6m = draftFact !== undefined && yearOf(draft.issueDate) === config.year;
  const v8 = total8m(args.facts8m, config.asOf, config.vatWindow, scope);
  const v8d = total8m(args.facts8m, draft.issueDate, config.vatWindow, scope);
  const draftIn8m = draftFact !== undefined && draftCountsForVat(draft, args.clients, scope);
  return {
    limit6m: {
      committed: { total: c6.total, inputs: c6.inputFigureIds, included: c6.included },
      withDraft: {
        total: draftIn6m && draftFact ? add(c6.total, draftFact.amountRSD) : c6.total,
        inputs: [...c6.inputFigureIds, ...(draftFact ? [draftFact.figureId] : [])],
        draftCounted: draftIn6m,
      },
      limit,
    },
    vat8m: {
      committed: {
        total: v8.total,
        inputs: v8.inputFigureIds,
        window: v8.window,
        included: v8.included,
        excluded: v8.excluded,
      },
      withDraft: {
        total: draftIn8m && draftFact ? add(v8d.total, draftFact.amountRSD) : v8d.total,
        inputs: [...v8d.inputFigureIds, ...(draftFact ? [draftFact.figureId] : [])],
        window: v8d.window,
        draftCounted: draftIn8m,
      },
      threshold,
    },
  };
}
