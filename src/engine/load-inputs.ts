// Load an input set from a folder. Bundled samples and user uploads take this same path: profile.json,
// clients.json, draft.json, mapping.json (column mappings per CSV), invoices/*.pdf, statement CSV(s) and
// the KPO book. Ground truth (_truth/) is never read here.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readPdf } from '../inputs/documents.ts';
import { KpoMappingSchema, StatementMappingSchema, parseKpoBook, parseStatement } from '../inputs/tables.ts';
import { sha256 } from '../util/hash.ts';
import type { RunInputs } from './inputs.ts';

const IsoDate = z.iso.date();
const Decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const ProfileSchema = z.object({
  id: z.string().min(1),
  synthetic: z.boolean(),
  name: z.string().min(1),
  pib: z.string().min(1),
  activityCode: z.string(),
  registrationDate: IsoDate,
  municipality: z.string(),
  address: z.string(),
  taxpayerCode: z.string().optional(),
  activityExemptFromIndependenceTest: z.boolean(),
  year: z.number().int().min(2000).max(2100),
  asOf: IsoDate,
});

export const ClientsSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    country: z.string().regex(/^[A-Z]{2}$/),
    isBusiness: z.boolean(),
    pib: z.string().optional(),
    vatId: z.string().optional(),
    contract: z.record(z.string(), z.string()).optional(),
  }),
);

export const DraftSchema = z.object({
  clientId: z.string(),
  currency: z.enum(['RSD', 'EUR', 'USD', 'GBP', 'CHF']),
  amount: Decimal,
  issueDate: IsoDate,
  description: z.string(),
  kind: z.enum(['product', 'service']),
});

export const MappingFileSchema = z.object({
  files: z.record(z.string(), z.discriminatedUnion('kind', [StatementMappingSchema, KpoMappingSchema])),
});

export class InputSetError extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
    this.name = 'InputSetError';
  }
}

function readJson<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const path = join(dir, file);
  if (!existsSync(path)) throw new InputSetError(file, 'file is missing');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new InputSetError(file, `not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new InputSetError(file, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export interface LoadedInputSet {
  inputs: RunInputs;
  year: number;
  asOf: string;
}

export async function loadInputSet(dir: string): Promise<LoadedInputSet> {
  const profile = readJson(dir, 'profile.json', ProfileSchema);
  const clients = readJson(dir, 'clients.json', ClientsSchema);
  const draft = readJson(dir, 'draft.json', DraftSchema);
  const mapping = readJson(dir, 'mapping.json', MappingFileSchema);
  if (!clients.some((c) => c.id === draft.clientId))
    throw new InputSetError('draft.json', `client "${draft.clientId}" is not in clients.json`);
  const manifest: Record<string, string> = {};

  const invoiceDir = join(dir, 'invoices');
  const pdfs = existsSync(invoiceDir)
    ? readdirSync(invoiceDir)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .sort()
    : [];
  const documents = await Promise.all(
    pdfs.map(async (f) => {
      const bytes = readFileSync(join(invoiceDir, f));
      manifest[`invoices/${f}`] = sha256(bytes);
      return readPdf(f.replace(/\.pdf$/i, ''), f, bytes);
    }),
  );

  const statements: RunInputs['statements'] = [];
  let kpo: RunInputs['kpo'];
  for (const [file, m] of Object.entries(mapping.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (file.includes('/') || file.includes('\\') || file.startsWith('.'))
      throw new InputSetError('mapping.json', `invalid file name ${file}`);
    const path = join(dir, file);
    if (!existsSync(path) || !statSync(path).isFile())
      throw new InputSetError(file, 'mapped file is missing');
    const bytes = readFileSync(path);
    manifest[file] = sha256(bytes);
    if (m.kind === 'statement') statements.push({ file, ...parseStatement(file, bytes, m) });
    else {
      if (kpo) throw new InputSetError(file, 'only one KPO book per run');
      kpo = { file, ...parseKpoBook(file, bytes, m) };
    }
  }

  const { year, asOf, ...rest } = profile;
  return {
    year,
    asOf,
    inputs: {
      inputId: profile.id,
      synthetic: profile.synthetic,
      profile: rest,
      clients,
      draft,
      documents,
      statements,
      ...(kpo ? { kpo } : {}),
      manifest,
    },
  };
}
