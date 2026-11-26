// Write a sample profile folder (PRD 12.2) from a spec: the same layout and mapping.json an upload has.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderInvoicePdf,
  renderKpoCsv,
  renderStatementCsv,
  type InvoiceSpec,
  type KpoRowSpec,
  type StatementRowSpec,
} from './render.ts';

export interface ProfileSpec {
  profile: {
    id: string;
    name: string;
    pib: string;
    activityCode: string;
    registrationDate: string;
    municipality: string;
    address: string;
    taxpayerCode?: string;
    activityExemptFromIndependenceTest: boolean;
    year: number;
    asOf: string;
  };
  clients: Array<{
    id: string;
    name: string;
    country: string;
    isBusiness: boolean;
    pib?: string;
    vatId?: string;
    contract?: Record<string, string>;
  }>;
  draft: {
    clientId: string;
    currency: string;
    amount: string;
    issueDate: string;
    description: string;
    kind: 'product' | 'service';
  };
  invoices: InvoiceSpec[];
  statement: StatementRowSpec[];
  kpo: KpoRowSpec[];
  truth?: unknown;
}

export const SYNTHETIC_STATEMENT_MAPPING = {
  kind: 'statement',
  delimiter: ',',
  decimal: '.',
  dateFormat: 'YYYY-MM-DD',
  encoding: 'utf-8',
  headerRow: 2,
  columns: { date: 0, description: 2, counterparty: 3, reference: 4, amount: 5, currency: 6, direction: 7 },
} as const;

export const SYNTHETIC_KPO_MAPPING = {
  kind: 'kpo',
  delimiter: ',',
  decimal: '.',
  dateFormat: 'YYYY-MM-DD',
  encoding: 'utf-8',
  headerRow: 2,
  columns: { date: 1, description: 2, products: 3, services: 4, total: 5 },
} as const;

const SYNTHETIC_HEADER =
  '# SYNTHETIC SAMPLE DATA. Not a real bank or taxpayer. Format is synthetic, not a real bank export.\n';

export async function writeProfile(dir: string, spec: ProfileSpec): Promise<void> {
  mkdirSync(join(dir, 'invoices'), { recursive: true });
  const json = (file: string, v: unknown): void =>
    writeFileSync(join(dir, file), `${JSON.stringify(v, null, 2)}\n`);
  json('profile.json', { ...spec.profile, synthetic: true });
  json('clients.json', spec.clients);
  json('draft.json', spec.draft);
  json('mapping.json', {
    files: { 'statement.csv': SYNTHETIC_STATEMENT_MAPPING, 'kpo.csv': SYNTHETIC_KPO_MAPPING },
  });
  writeFileSync(join(dir, 'statement.csv'), SYNTHETIC_HEADER + renderStatementCsv(spec.statement));
  writeFileSync(join(dir, 'kpo.csv'), SYNTHETIC_HEADER + renderKpoCsv(spec.kpo));
  for (const inv of spec.invoices) {
    writeFileSync(join(dir, 'invoices', `${inv.number}.pdf`), await renderInvoicePdf(inv));
  }
  if (spec.truth !== undefined) {
    mkdirSync(join(dir, '_truth'), { recursive: true });
    writeFileSync(join(dir, '_truth', 'truth.json'), `${JSON.stringify(spec.truth, null, 2)}\n`);
  }
}
