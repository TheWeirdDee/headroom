// "Type your next invoice": starts the recorded sample with the visitor's own amount as the invoice about to
// be sent, so the answer on the run screen is computed for that number.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { getJson, postJson, ApiError } from '../api/client.ts';
import type { Draft } from '../api/types.ts';
import { useApp } from '../state/app.ts';
import { AMOUNT_EXAMPLE, normaliseAmount } from '../format/money.ts';

export function TryAmount({ profileId }: { profileId: string }) {
  const health = useApp((s) => s.health);
  const navigate = useNavigate();
  const [amount, setAmount] = useState('6000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const clean = normaliseAmount(amount);
    if (!clean)
      return setError(
        `Enter the amount as a number with at most two decimals, for example ${AMOUNT_EXAMPLE}.`,
      );
    setBusy(true);
    setError(undefined);
    try {
      const { draft } = await getJson<{ draft: Draft }>(`/api/profiles/${profileId}`);
      const { runId } = await postJson<{ runId: string }>('/api/runs', {
        profileId,
        mode: 'replay',
        draft: { ...draft, amount: clean },
      });
      navigate(`/runs/${runId}`);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'The run could not be started.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Try an invoice amount on the sample"
      className="rounded-xl border border-line bg-panel/80 p-4"
    >
      <label htmlFor="try-amount" className="text-sm">
        Try it: how big is the next invoice?
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-line bg-ink focus-within:border-muted">
          <input
            id="try-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num w-full min-w-0 bg-transparent px-3 py-2 text-lg outline-none"
          />
          <span className="px-3 text-sm text-muted">EUR</span>
        </div>
        <button
          type="submit"
          disabled={busy || !health}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Starting...' : 'Show my headroom'} <ArrowRight size={16} aria-hidden />
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Added to a synthetic freelancer’s year, to their main client. The agents read the files and answer for
        your amount.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
