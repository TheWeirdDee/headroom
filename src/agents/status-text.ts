// The "doing now" line of each agent lane, built from the same decision object the code acts on
// (never written by a model). Plain English, short.

export type Decision =
  | { kind: 'idle' }
  | { kind: 'reading_invoice'; fileName: string }
  | { kind: 'reading_statement_chunk'; file: string; from: number; to: number }
  | { kind: 'reading_kpo_chunk'; from: number; to: number }
  | { kind: 'searching_unmatched_payments'; count: number }
  | { kind: 'fetching_rate'; currency: string; date: string; attempt: number; maxAttempts: number }
  | { kind: 'checking_book_rate'; invNo: string }
  | { kind: 'recomputing_totals'; invoices: number }
  | { kind: 'checking_book_coverage'; invoices: number }
  | { kind: 'reading_contract'; clientName: string }
  | { kind: 'computing_share'; clients: number }
  | { kind: 'verifying'; key: string; check: string }
  | { kind: 'resolving_conflict'; key: string }
  | { kind: 'waiting_for'; what: string }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };

const short = (key: string): string => key.replace(/^invoice:/, 'invoice ').replace(/:/g, ' ');

export function doingNow(d: Decision): string {
  switch (d.kind) {
    case 'idle':
      return 'Idle';
    case 'reading_invoice':
      return `Reading invoice ${d.fileName}`;
    case 'reading_statement_chunk':
      return `Reading ${d.file} rows ${d.from}-${d.to}`;
    case 'reading_kpo_chunk':
      return `Reading KPO book rows ${d.from}-${d.to}`;
    case 'searching_unmatched_payments':
      return `Looking for invoices behind ${d.count} unmatched payment${d.count === 1 ? '' : 's'}`;
    case 'fetching_rate':
      return d.attempt > 1
        ? `Waiting for the NBS rate: retry ${d.attempt - 1} of ${d.maxAttempts - 1}`
        : `Fetching NBS ${d.currency} rate for ${d.date}`;
    case 'checking_book_rate':
      return `Checking which rate the book used for invoice ${d.invNo}`;
    case 'recomputing_totals':
      return `Recomputing 6M and 8M totals from ${d.invoices} verified invoice${d.invoices === 1 ? '' : 's'}`;
    case 'checking_book_coverage':
      return `Checking the KPO book covers all ${d.invoices} invoices`;
    case 'reading_contract':
      return `Reading contract details for ${d.clientName}`;
    case 'computing_share':
      return `Computing 12-month income share for ${d.clients} client${d.clients === 1 ? '' : 's'}`;
    case 'verifying':
      return `Checking ${short(d.key)}: ${d.check}`;
    case 'resolving_conflict':
      return `Two sources disagree on ${short(d.key)}; checking both`;
    case 'waiting_for':
      return `Waiting for ${d.what}`;
    case 'done':
      return d.summary;
    case 'error':
      return `Stopped: ${d.message}`;
  }
}

export function stateOf(d: Decision): 'idle' | 'working' | 'waiting' | 'error' {
  if (d.kind === 'idle' || d.kind === 'done') return 'idle';
  if (d.kind === 'waiting_for') return 'waiting';
  if (d.kind === 'error') return 'error';
  return 'working';
}
