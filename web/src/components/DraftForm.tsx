// What-if editing of the invoice about to be sent. A change re-opens the run; agents recompute from it.
import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { changeDraft } from '../api/runs.ts';
import { AMOUNT_EXAMPLE, normaliseAmount } from '../format/money.ts';
import { ApiError } from '../api/client.ts';
import type { Draft } from '../api/types.ts';

const CURRENCIES: Draft['currency'][] = ['RSD', 'EUR', 'USD', 'GBP', 'CHF'];

export function DraftFields({
  draft,
  clients,
  onChange,
}: {
  draft: Draft;
  clients: Array<{ id: string; name: string }>;
  onChange: (d: Draft) => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => onChange({ ...draft, [k]: v });
  const input = 'w-full rounded border border-line bg-ink px-2 py-1.5';
  return (
    <>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Client</span>
        <select
          className={input}
          value={draft.clientId}
          onChange={(e) => set('clientId', e.target.value)}
          required
        >
          <option value="" disabled>
            Choose a client
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Amount</span>
        <input
          className={`${input} num`}
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => set('amount', e.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Currency</span>
        <select
          className={input}
          value={draft.currency}
          onChange={(e) => set('currency', e.target.value as Draft['currency'])}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Issue date</span>
        <input
          className={input}
          type="date"
          value={draft.issueDate}
          onChange={(e) => set('issueDate', e.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Kind</span>
        <select
          className={input}
          value={draft.kind}
          onChange={(e) => set('kind', e.target.value as Draft['kind'])}
        >
          <option value="service">Service</option>
          <option value="product">Goods</option>
        </select>
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-muted">Description</span>
        <input
          className={input}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={200}
        />
      </label>
    </>
  );
}

/** Validates and normalises the amount; returns an error message or the cleaned draft. */
export function cleanDraft(d: Draft): { ok: true; draft: Draft } | { ok: false; error: string } {
  const amount = normaliseAmount(d.amount);
  if (!amount)
    return {
      ok: false,
      error: `Enter the amount as a number with at most two decimals, for example ${AMOUNT_EXAMPLE}.`,
    };
  if (!d.clientId) return { ok: false, error: 'Choose a client.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate)) return { ok: false, error: 'Enter the issue date.' };
  return { ok: true, draft: { ...d, amount } };
}

export function DraftForm({
  runId,
  draft,
  clients,
}: {
  runId: string;
  draft: Draft;
  clients: Array<{ id: string; name: string }>;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string }>();
  useEffect(() => setD(draft), [draft]);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const c = cleanDraft(d);
    if (!c.ok) {
      setMsg({ kind: 'err', text: c.error });
      return;
    }
    setBusy(true);
    setMsg(undefined);
    changeDraft(runId, c.draft)
      .then(() => setMsg({ kind: 'ok', text: 'Sent. The agents are recomputing.' }))
      .catch((e2: unknown) =>
        setMsg({ kind: 'err', text: e2 instanceof ApiError ? e2.message : 'The change was not saved.' }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <form
      onSubmit={submit}
      className="rounded border border-line bg-panel p-3"
      aria-label="Invoice you are about to send"
    >
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <DraftFields draft={d} clients={clients} onChange={setD} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
        >
          <RefreshCw size={14} aria-hidden /> Recheck with this invoice
        </button>
        {msg && (
          <span
            role={msg.kind === 'err' ? 'alert' : 'status'}
            className={`text-sm ${msg.kind === 'err' ? 'text-danger' : 'text-muted'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
