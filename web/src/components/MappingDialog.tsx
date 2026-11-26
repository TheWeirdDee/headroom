// Column mapper (PRD 12.6): when a CSV layout is not recognised, the user says which column is which.
// Nothing is guessed silently: a partial guess is shown pre-filled and must be confirmed.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { postJson, ApiError } from '../api/client.ts';
import { DECIMAL_COMMA_EXAMPLE, DECIMAL_DOT_EXAMPLE } from '../format/money.ts';
import type { CsvDetection, KpoMapping, StatementMapping, UploadedFile } from '../api/types.ts';

const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY'];
const STMT_COLS = [
  ['date', 'Date', true],
  ['amount', 'Amount (signed or with a direction column)', false],
  ['credit', 'Credit (money in)', false],
  ['debit', 'Debit (money out)', false],
  ['direction', 'Direction (in / out)', false],
  ['currency', 'Currency', false],
  ['counterparty', 'Counterparty', false],
  ['reference', 'Reference / poziv na broj', false],
  ['description', 'Description / purpose', false],
] as const;
const KPO_COLS = [
  ['date', 'Date', true],
  ['description', 'Description', true],
  ['products', 'Income from products', true],
  ['services', 'Income from services', true],
  ['total', 'Total', true],
] as const;

type Cols = Record<string, number | undefined>;

function initial(det: CsvDetection, m?: StatementMapping | KpoMapping) {
  return {
    kind: (m?.kind ?? (det.kind === 'unknown' ? 'statement' : det.kind)) as 'statement' | 'kpo',
    delimiter: m?.delimiter ?? det.delimiter,
    decimal: m?.decimal ?? (det.delimiter === ';' ? ',' : '.'),
    dateFormat: m?.dateFormat ?? 'DD.MM.YYYY',
    encoding: m?.encoding ?? det.encoding,
    headerRow: m?.headerRow ?? det.headerRow,
    columns: { ...(m?.columns ?? {}) } as Cols,
    accountCurrency: m?.kind === 'statement' ? m.accountCurrency : undefined,
  };
}

export function MappingDialog({
  uploadId,
  file,
  onClose,
  onSaved,
}: {
  uploadId: string;
  file: UploadedFile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const det = file.detection;
  const [st, setSt] = useState(() => (det ? initial(det, file.mapping ?? det.guess) : undefined));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [table, setTable] = useState(() => ({ header: det?.header ?? [], preview: det?.preview ?? [] }));
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  if (!det || !st) return null;

  /** Format changes re-read the file on the server; column choices are cleared because indexes move. */
  const reformat = (patch: Partial<Pick<typeof st, 'delimiter' | 'encoding' | 'headerRow'>>): void => {
    const next = { ...st, ...patch, columns: {} };
    setSt(next);
    setError(undefined);
    postJson<{ header: string[]; preview: string[][] }>(`/api/uploads/${uploadId}/preview`, {
      file: file.name,
      encoding: next.encoding,
      delimiter: next.delimiter,
      headerRow: next.headerRow,
    })
      .then(setTable)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'The file could not be read with these settings.'),
      );
  };

  const cols = st.kind === 'statement' ? STMT_COLS : KPO_COLS;
  const setCol = (k: string, v: string): void =>
    setSt({ ...st, columns: { ...st.columns, [k]: v === '' ? undefined : Number.parseInt(v, 10) } });

  const save = (): void => {
    const columns: Record<string, number> = {};
    for (const [k] of cols) {
      const v = st.columns[k];
      if (v !== undefined) columns[k] = v;
    }
    const missing = cols.filter(([k, , req]) => req && columns[k] === undefined).map(([, label]) => label);
    if (missing.length) return setError(`Choose a column for: ${missing.join(', ')}.`);
    if (st.kind === 'statement') {
      if (columns['amount'] === undefined && columns['credit'] === undefined)
        return setError('Choose either an Amount column or a Credit column.');
      if (columns['currency'] === undefined && !st.accountCurrency)
        return setError('Choose a Currency column or the account currency.');
    }
    const mapping = {
      kind: st.kind,
      delimiter: st.delimiter,
      decimal: st.decimal,
      dateFormat: st.dateFormat,
      encoding: st.encoding,
      headerRow: st.headerRow,
      columns,
      ...(st.kind === 'statement' && st.accountCurrency ? { accountCurrency: st.accountCurrency } : {}),
    };
    setBusy(true);
    setError(undefined);
    postJson(`/api/uploads/${uploadId}/mapping`, { file: file.name, mapping })
      .then(() => onSaved())
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError
            ? `${e.message}${Array.isArray(e.details) ? `: ${(e.details as Array<{ message?: string }>).map((d) => d.message).join('; ')}` : ''}`
            : 'Not saved.',
        ),
      )
      .finally(() => setBusy(false));
  };

  const sel = 'rounded border border-line bg-ink px-2 py-1 text-sm';
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-title"
        className="w-full max-w-4xl rounded border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="map-title" className="text-lg font-semibold">
              Which column is which?
            </h2>
            <p className="text-sm text-muted">
              {file.name}. Headroom reads only the columns you choose, and lists any row it cannot parse
              instead of guessing.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <label>
            <span className="mb-1 block text-xs text-muted">This file is</span>
            <select
              ref={first}
              className={sel}
              value={st.kind}
              onChange={(e) => setSt({ ...st, kind: e.target.value as 'statement' | 'kpo', columns: {} })}
            >
              <option value="statement">a bank statement</option>
              <option value="kpo">a KPO book</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Decimal mark</span>
            <select
              className={sel}
              value={st.decimal}
              onChange={(e) => setSt({ ...st, decimal: e.target.value as ',' | '.' })}
            >
              <option value=",">comma ({DECIMAL_COMMA_EXAMPLE})</option>
              <option value=".">dot ({DECIMAL_DOT_EXAMPLE})</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Date format</span>
            <select
              className={sel}
              value={st.dateFormat}
              onChange={(e) => setSt({ ...st, dateFormat: e.target.value })}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          {st.kind === 'statement' && (
            <label>
              <span className="mb-1 block text-xs text-muted">Account currency (if no column)</span>
              <select
                className={sel}
                value={st.accountCurrency ?? ''}
                onChange={(e) =>
                  setSt({
                    ...st,
                    accountCurrency: (e.target.value || undefined) as StatementMapping['accountCurrency'],
                  })
                }
              >
                <option value="">(from a column)</option>
                {['RSD', 'EUR', 'USD', 'GBP', 'CHF'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="mb-1 block text-xs text-muted">Header is on line</span>
            <input
              type="number"
              min={1}
              max={50}
              className={`${sel} w-20`}
              value={st.headerRow}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (n >= 1 && n <= 50) reformat({ headerRow: n });
              }}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Separator</span>
            <select
              className={sel}
              value={st.delimiter}
              onChange={(e) => reformat({ delimiter: e.target.value as ',' | ';' | '\t' })}
            >
              <option value=";">semicolon</option>
              <option value=",">comma</option>
              <option value={'\t'}>tab</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Encoding</span>
            <select
              className={sel}
              value={st.encoding}
              onChange={(e) => reformat({ encoding: e.target.value as 'utf-8' | 'windows-1250' })}
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1250">Windows-1250</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cols.map(([k, label, req]) => (
            <label key={k} className="text-sm">
              <span className="mb-1 block text-xs text-muted">
                {label}
                {req ? ' (required)' : ''}
              </span>
              <select
                className={`${sel} w-full`}
                value={st.columns[k] ?? ''}
                onChange={(e) => setCol(k, e.target.value)}
              >
                <option value="">(none)</option>
                {table.header.map((h, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {h || '(empty)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded border border-line">
          <table className="w-full font-mono text-xs">
            <caption className="sr-only">First rows of the file</caption>
            <thead>
              <tr>
                {table.header.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-b border-line px-2 py-1 text-left whitespace-nowrap text-muted"
                  >
                    {i + 1}. {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.preview.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-line/50 px-2 py-1 whitespace-nowrap">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
          >
            Save mapping
          </button>
        </div>
      </div>
    </div>
  );
}
