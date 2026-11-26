// The parsed input set of a run (a bundled sample profile or an uploaded set after mapping). Agents read
// only from here; the Verifier resolves every SourceRef against it.
import type { InputDocument } from '../inputs/documents.ts';
import type { RowError, StatementRow } from '../inputs/tables.ts';
import type { ExistingKpoRow } from '../domain/kpo.ts';
import type { Client, Draft, Profile } from '../domain/types.ts';

export interface RunInputs {
  inputId: string; // profile id or upload id
  synthetic: boolean;
  profile: Profile;
  clients: Client[];
  draft: Draft;
  documents: InputDocument[];
  statements: Array<{ file: string; rows: StatementRow[]; errors: RowError[] }>;
  kpo?: { file: string; rows: ExistingKpoRow[]; errors: RowError[] };
  /** File name to sha256 of the bytes, for the run manifest. */
  manifest: Record<string, string>;
}

export function statementRowRef(
  row: { file: string; rowIndex: number },
  statements: RunInputs['statements'],
): string {
  const fileIdx = statements.findIndex((s) => s.file === row.file);
  return `S${fileIdx + 1}-${row.rowIndex}`;
}
