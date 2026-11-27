import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules, RuleLoadError } from '../../src/domain/rules/loader.ts';
import { RuleBook } from '../../src/domain/rules/engine.ts';
import { buildKpoBook } from '../../src/domain/kpo.ts';
import { cmp } from '../../src/domain/money.ts';
import {
  band,
  bandAfterCorrection,
  countsForVat,
  headroom,
  ratio,
  total6m,
  total8m,
  type InvoiceFact,
  type VatScope,
} from '../../src/domain/limits.ts';

const rules = loadRules();
const bands = {
  amberFrom: rules.decimalParam('R-LIMIT-BANDS', 'amberFrom'),
  redFrom: rules.decimalParam('R-LIMIT-BANDS', 'redFrom'),
  crossedFrom: rules.decimalParam('R-LIMIT-BANDS', 'crossedFrom'),
};
const scope: VatScope = {
  includeProducts: rules.boolParam('R-VAT-8M-SCOPE', 'includeProducts'),
  includeServicesDomestic: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesDomestic'),
  includeServicesForeignNonBusiness: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesForeignNonBusiness'),
  includeServicesForeignBusiness: rules.boolParam('R-VAT-8M-SCOPE', 'includeServicesForeignBusiness'),
};

function inv(
  invNo: string,
  issueDate: string,
  amountRSD: string,
  extra: Partial<InvoiceFact> = {},
): InvoiceFact {
  return {
    invNo,
    issueDate,
    amountRSD,
    kind: 'service',
    clientId: 'c1',
    clientCountry: 'RS',
    clientIsBusiness: true,
    figureIds: [`f-${invNo}`],
    ...extra,
  };
}

describe('rule data', () => {
  it('loads every rule file and validates sources, statuses and params', () => {
    const ids = rules.all().map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['R-LIMIT-6M', 'R-VAT-8M', 'R-INDEP', 'R-FX', 'R-KPO-LAYOUT']),
    );
    for (const r of rules.all()) expect(r.sources.length).toBeGreaterThan(0);
    expect(rules.decimalParam('R-LIMIT-6M', 'limitRSD')).toBe('6000000.00');
    expect(rules.decimalParam('R-VAT-8M', 'thresholdRSD')).toBe('8000000.00');
  });

  it('marks unsettled rules as assumptions', () => {
    const assumed = rules.assumptions().map((r) => r.id);
    expect(assumed).toEqual(
      expect.arrayContaining(['R-FX-DATE', 'R-FX-ROUNDING', 'R-INDEP-C6-BASIS', 'R-KPO-DATE']),
    );
    expect(rules.get('R-INDEP-C6-HORIZON').status).toBe('product');
    // A display choice is not a legal claim, and a rule settled by the law's own words is not assumed.
    expect(rules.get('R-NUMBERING').status).toBe('product');
    expect(rules.get('R-INDEP-WHO-FILES').sources[0]?.quote).toContain('dužan je da sam obračuna');
    expect(rules.get('R-INDEP-C6-WINDOWS').params).toEqual({
      shareThreshold: '0.70',
      windowUnit: 'calendar_month',
    });
    expect(rules.isAssumption('R-VAT-8M')).toBe(false);
  });

  it('holds all nine independence criteria with Serbian text, English text and an evaluation mode', () => {
    const cs = rules.criteria();
    expect(cs.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cs[5]?.text_sr).toContain('najmanje 70% od ukupno ostvarenih prihoda');
    expect(cs[5]?.evalMode).toBe('computed');
    expect(cs[8]?.text_sr).toContain('130 ili više radnih dana');
    expect(cs[8]?.evalMode).toBe('user_answer');
    for (const c of cs.filter((x) => x.evalMode === 'contract_field')) expect(c.contractField).toBeTruthy();
    expect(rules.intParam('R-INDEP', 'metThreshold')).toBe(5);
  });

  it('refuses invalid rule files with the file name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-'));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ rules: [{ id: 'R-X', status: 'fact' }] }));
    expect(() => loadRules(dir)).toThrow(RuleLoadError);
    expect(() => loadRules(dir)).toThrow(/bad\.json/);
  });

  it('refuses duplicate ids and unknown lookups', () => {
    const r = rules.get('R-FX');
    expect(() => new RuleBook([r, r])).toThrow(/Duplicate/);
    expect(() => rules.get('R-NOPE')).toThrow(/Unknown rule/);
  });
});

describe('R-LIMIT-6M', () => {
  const facts = [
    inv('2026-001', '2026-01-10', '1000000.00'),
    inv('2026-002', '2026-06-30', '2500000.50'),
    inv('2025-099', '2025-12-31', '900000.00'),
  ];

  it('the KPO book total equals the 6M committed total for the same invoices', () => {
    const book = buildKpoBook(
      facts.map((f) => ({
        invNo: f.invNo,
        entryDate: f.issueDate,
        clientName: 'X',
        kind: f.kind,
        amountRSD: f.amountRSD,
        figureIds: f.figureIds,
      })),
      2026,
    );
    expect(cmp(book.totals.totalRSD, total6m(facts, 2026).total)).toBe(0);
  });

  it('sums the calendar year by issue date only', () => {
    const t = total6m(facts, 2026);
    expect(t.total).toBe('3500000.5');
    expect(t.included).toEqual(['2026-001', '2026-002']);
    expect(t.inputFigureIds).toEqual(['f-2026-001', 'f-2026-002']);
  });

  it('computes headroom and ratio exactly', () => {
    expect(headroom('6000000.00', '5412300.00')).toBe('587700');
    expect(ratio('5412300', '6000000.00')).toBe('0.902050');
  });

  it('bands at 80 / 90 / 100 percent from exact amounts, boundaries inclusive', () => {
    const L = '6000000.00';
    expect(band('4799999.99', L, bands)).toBe('green');
    expect(band('4800000.00', L, bands)).toBe('amber');
    expect(band('5399999.99', L, bands)).toBe('amber');
    expect(band('5400000.00', L, bands)).toBe('red');
    // 5,999,999.99 rounds to a ratio of 1.000000 but has not crossed the limit.
    expect(ratio('5999999.99', L)).toBe('1.000000');
    expect(band('5999999.99', L, bands)).toBe('red');
    expect(band('6000000.00', L, bands)).toBe('crossed');
  });

  it('attributes a band flip to a correction', () => {
    expect(bandAfterCorrection('5850000', '200000', '6000000.00', bands)).toEqual({
      before: 'red',
      after: 'crossed',
    });
    expect(bandAfterCorrection('5000000', '10000', '6000000.00', bands)).toEqual({
      before: 'amber',
      after: 'amber',
    });
    expect(bandAfterCorrection('6000000.01', '-0.01', '6000000.00', bands)).toEqual({
      before: 'crossed',
      after: 'crossed',
    });
    expect(bandAfterCorrection('6000000.01', '-0.02', '6000000.00', bands)).toEqual({
      before: 'crossed',
      after: 'red',
    });
  });
});

describe('R-VAT-8M', () => {
  it('scope: goods always, services in Serbia, services to foreign non-businesses; not foreign business services', () => {
    expect(countsForVat({ kind: 'product', clientCountry: 'DE', clientIsBusiness: true }, scope)).toBe(true);
    expect(countsForVat({ kind: 'service', clientCountry: 'RS', clientIsBusiness: true }, scope)).toBe(true);
    expect(countsForVat({ kind: 'service', clientCountry: 'DE', clientIsBusiness: false }, scope)).toBe(true);
    expect(countsForVat({ kind: 'service', clientCountry: 'DE', clientIsBusiness: true }, scope)).toBe(false);
  });

  it('reproduces the Tax Administration example window and counts only what is in scope', () => {
    const facts = [
      inv('A', '2022-08-18', '1000000'), // one day before the window
      inv('B', '2022-08-19', '3000000'), // first day of the window
      inv('C', '2023-03-01', '4895560'),
      inv('D', '2023-08-18', '200000'), // the invoice in the example
      inv('E', '2023-05-05', '9000000', { clientCountry: 'US' }), // foreign business service: excluded
    ];
    const t = total8m(facts, '2023-08-18', '365d', scope);
    expect(t.window).toEqual({ from: '2022-08-19', to: '2023-08-18' });
    expect(t.total).toBe('8095560');
    expect(t.included).toEqual(['B', 'C', 'D']);
    expect(t.excluded).toEqual(['E']);
  });

  it('12-calendar-month alternative window', () => {
    const facts = [inv('A', '2025-11-30', '1'), inv('B', '2025-12-01', '2'), inv('C', '2026-11-26', '3')];
    const t = total8m(facts, '2026-11-26', '12m', scope);
    expect(t.window).toEqual({ from: '2025-12-01', to: '2026-11-26' });
    expect(t.total).toBe('5');
  });
});
