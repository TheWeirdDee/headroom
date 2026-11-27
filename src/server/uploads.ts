// User uploads: files stay on this machine under uploads/<uploadId>/, in the same layout
// as a bundled sample, so a run on them takes exactly the same path. Nothing here is ever committed,
// recorded or sent anywhere except the extracted text the model provider reads during a live run.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { detectCsv, detectKind, type CsvDetection, type FileKind } from '../inputs/detect.ts';
import {
  KpoMappingSchema,
  StatementMappingSchema,
  decode,
  parseTable,
  type KpoMapping,
  type StatementMapping,
} from '../inputs/tables.ts';
import { ClientsSchema, DraftSchema } from '../engine/load-inputs.ts';

export const MAX_FILES = 200;

export class UploadError extends Error {
  constructor(
    readonly code:
      | 'UPLOAD_NOT_FOUND'
      | 'FILE_TOO_LARGE'
      | 'TOO_MANY_FILES'
      | 'BAD_FILE_NAME'
      | 'UNSUPPORTED_FILE'
      | 'BAD_MAPPING'
      | 'BAD_DETAILS'
      | 'NOT_READY',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadedFile {
  name: string;
  kind: FileKind;
  size: number;
  detection?: CsvDetection;
  mapping?: StatementMapping | KpoMapping;
}

export const DetailsSchema = z.object({
  name: z.string().min(1).max(200),
  pib: z.string().regex(/^\d{9}$/, 'PIB has 9 digits'),
  activityCode: z.string().max(10).default(''),
  address: z.string().max(300).default(''),
  municipality: z.string().max(100).default(''),
  activityExemptFromIndependenceTest: z.boolean().default(false),
  year: z.number().int().min(2000).max(2100),
  asOf: z.iso.date(),
  clients: ClientsSchema.min(1),
  draft: DraftSchema,
});
export type UploadDetails = z.infer<typeof DetailsSchema>;

const PreviewSchema = z.object({
  file: z.string(),
  encoding: z.enum(['utf-8', 'windows-1250']),
  delimiter: z.enum([',', ';', '\t']),
  headerRow: z.number().int().min(1).max(50),
});

const ID_RE = /^u-[0-9a-f]{12}$/;

/** Only plain file names: no directories, no hidden files, no ground-truth names. */
export function safeName(name: string): string {
  const b = basename(name)
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  if (!b || b.startsWith('.') || /_truth/i.test(b) || b.length > 120)
    throw new UploadError('BAD_FILE_NAME', `File name not accepted: ${name}`);
  return b;
}

export class UploadStore {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number,
  ) {}

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new UploadError('UPLOAD_NOT_FOUND', 'No such upload');
    const d = join(this.root, id);
    if (!existsSync(d)) throw new UploadError('UPLOAD_NOT_FOUND', 'No such upload');
    return d;
  }

  create(files: Array<{ name: string; bytes: Buffer }>): { uploadId: string; files: UploadedFile[] } {
    if (files.length === 0) throw new UploadError('UNSUPPORTED_FILE', 'No files received');
    if (files.length > MAX_FILES)
      throw new UploadError('TOO_MANY_FILES', `At most ${MAX_FILES} files per upload`);
    for (const f of files) {
      if (f.bytes.length > this.maxBytes)
        throw new UploadError(
          'FILE_TOO_LARGE',
          `${f.name} is larger than ${Math.round(this.maxBytes / 1048576)} MB`,
        );
    }
    const uploadId = `u-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const dir = join(this.root, uploadId);
    mkdirSync(join(dir, 'invoices'), { recursive: true });
    const out: UploadedFile[] = [];
    for (const f of files) {
      const name = safeName(f.name);
      const kind = detectKind(name, f.bytes);
      if (kind === 'invoice_pdf')
        writeFileSync(
          join(dir, 'invoices', name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`),
          f.bytes,
        );
      else writeFileSync(join(dir, name), f.bytes);
      const entry: UploadedFile = { name, kind, size: f.bytes.length };
      if (kind === 'statement' || kind === 'kpo' || (kind === 'unknown' && /\.(csv|tsv|txt)$/i.test(name))) {
        entry.detection = detectCsv(f.bytes);
        if (entry.detection.mapping) entry.mapping = entry.detection.mapping;
      }
      out.push(entry);
    }
    this.saveManifest(uploadId, out);
    return { uploadId, files: out };
  }

  get(uploadId: string): {
    uploadId: string;
    files: UploadedFile[];
    mappingNeeded: string[];
    detailsSaved: boolean;
  } {
    const dir = this.dir(uploadId);
    const files = JSON.parse(readFileSync(join(dir, 'upload.json'), 'utf8')) as UploadedFile[];
    return {
      uploadId,
      files,
      mappingNeeded: files
        .filter((f) => f.kind !== 'invoice_pdf' && f.kind !== 'clients' && !f.mapping)
        .map((f) => f.name),
      detailsSaved: existsSync(join(dir, 'profile.json')),
    };
  }

  setMapping(uploadId: string, file: string, mapping: unknown): void {
    const current = this.get(uploadId);
    const entry = current.files.find((f) => f.name === file);
    if (!entry || entry.kind === 'invoice_pdf')
      throw new UploadError('BAD_MAPPING', `No CSV named ${file} in this upload`);
    const parsed = z
      .discriminatedUnion('kind', [StatementMappingSchema, KpoMappingSchema])
      .safeParse(mapping);
    if (!parsed.success) throw new UploadError('BAD_MAPPING', 'Mapping is not valid', parsed.error.issues);
    entry.mapping = parsed.data;
    entry.kind = parsed.data.kind;
    this.saveManifest(uploadId, current.files);
  }

  /** Re-read a CSV with the user's format choices (header line, separator, encoding) for the mapper. */
  preview(uploadId: string, raw: unknown): { header: string[]; preview: string[][] } {
    const parsed = PreviewSchema.safeParse(raw);
    if (!parsed.success)
      throw new UploadError('BAD_MAPPING', 'Preview options are not valid', parsed.error.issues);
    const { file, encoding, delimiter, headerRow } = parsed.data;
    const entry = this.get(uploadId).files.find((f) => f.name === file);
    if (!entry?.detection) throw new UploadError('BAD_MAPPING', `No CSV named ${file} in this upload`);
    const text = decode(readFileSync(join(this.dir(uploadId), entry.name)), encoding).text;
    try {
      const t = parseTable(text, delimiter, headerRow);
      return { header: t.header, preview: t.rows.slice(0, 10).map((r) => r.cells) };
    } catch (e) {
      throw new UploadError(
        'BAD_MAPPING',
        e instanceof Error ? e.message : 'The file could not be read with these settings',
      );
    }
  }

  setDetails(uploadId: string, raw: unknown): void {
    const dir = this.dir(uploadId);
    const parsed = DetailsSchema.safeParse(raw);
    if (!parsed.success) throw new UploadError('BAD_DETAILS', 'Details are not valid', parsed.error.issues);
    const d = parsed.data;
    if (!d.clients.some((c) => c.id === d.draft.clientId))
      throw new UploadError('BAD_DETAILS', 'The draft client is not in the client list');
    const json = (f: string, v: unknown): void =>
      writeFileSync(join(dir, f), `${JSON.stringify(v, null, 2)}\n`);
    json('profile.json', {
      id: uploadId,
      synthetic: false,
      name: d.name,
      pib: d.pib,
      activityCode: d.activityCode,
      registrationDate: `${d.year}-01-01`,
      municipality: d.municipality,
      address: d.address,
      activityExemptFromIndependenceTest: d.activityExemptFromIndependenceTest,
      year: d.year,
      asOf: d.asOf,
    });
    json('clients.json', d.clients);
    json('draft.json', d.draft);
  }

  /** Write mapping.json and check the set is complete enough to run. */
  prepare(uploadId: string): string {
    const dir = this.dir(uploadId);
    const u = this.get(uploadId);
    if (!u.detailsSaved)
      throw new UploadError('NOT_READY', 'Fill in your details and the draft invoice first');
    if (u.mappingNeeded.length > 0)
      throw new UploadError('NOT_READY', `Map the columns of ${u.mappingNeeded.join(', ')} first`);
    const mapped = u.files.filter((f) => f.mapping);
    if (!u.files.some((f) => f.kind === 'invoice_pdf') && mapped.length === 0)
      throw new UploadError('NOT_READY', 'Add at least one invoice PDF or CSV');
    if (mapped.filter((f) => f.mapping?.kind === 'kpo').length > 1)
      throw new UploadError('NOT_READY', 'Only one KPO book per run');
    writeFileSync(
      join(dir, 'mapping.json'),
      `${JSON.stringify({ files: Object.fromEntries(mapped.map((f) => [f.name, f.mapping])) }, null, 2)}\n`,
    );
    return dir;
  }

  delete(uploadId: string): void {
    rmSync(this.dir(uploadId), { recursive: true, force: true });
  }

  list(): string[] {
    return existsSync(this.root) ? readdirSync(this.root).filter((d) => ID_RE.test(d)) : [];
  }

  private saveManifest(uploadId: string, files: UploadedFile[]): void {
    writeFileSync(join(this.root, uploadId, 'upload.json'), `${JSON.stringify(files, null, 2)}\n`);
  }
}
