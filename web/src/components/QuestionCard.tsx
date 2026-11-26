import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Link } from 'react-router';
import { answerQuestion } from '../api/runs.ts';
import { ApiError } from '../api/client.ts';
import type { Question } from '../api/types.ts';
import { AGENT_NAMES } from '../state/reducer.ts';

export function QuestionCard({ runId, q }: { runId: string; q: Question }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = (answer: string): void => {
    setBusy(true);
    setError(undefined);
    answerQuestion(runId, q.id, answer)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The answer was not saved.'))
      .finally(() => setBusy(false));
  };
  return (
    <li className="p-3">
      <p className="flex items-start gap-2">
        <CircleHelp size={16} className="mt-0.5 shrink-0 text-amber" aria-hidden />
        <span>{q.text}</span>
      </p>
      <p className="mt-1 pl-6 text-xs text-muted">
        Asked by {AGENT_NAMES[q.askedBy] ?? q.askedBy}
        {q.ruleId && (
          <>
            {' '}
            · rule{' '}
            <Link to={`/about#${q.ruleId}`} className="text-accent hover:underline">
              {q.ruleId}
            </Link>
          </>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        {q.options.map((o) => (
          <button
            key={o}
            type="button"
            disabled={busy}
            onClick={() => send(o)}
            aria-pressed={q.answer === o}
            className={`rounded border px-3 py-1 text-sm disabled:opacity-60 ${q.answer === o ? 'border-accent bg-accent/15 text-accent' : 'border-line hover:border-muted'}`}
          >
            {o}
          </button>
        ))}
        {q.answer !== undefined && (
          <span className="self-center text-xs text-muted">Answered. You can change it.</span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 pl-6 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
