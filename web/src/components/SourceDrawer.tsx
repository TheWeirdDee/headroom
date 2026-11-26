// Source drawer (PRD 15.3): every figure opens to the exact line, row, URL, rule or answer it came from.
// Derived figures list their inputs as chips; clicking one drills down (a stack, with Back).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, ExternalLink, X } from 'lucide-react';
import { getJson, ApiError } from '../api/client.ts';
import type { FigureDetail, ResolvedSource } from '../api/types.ts';
import { valueText } from '../format/money.ts';
import { AGENT_NAMES } from '../state/reducer.ts';
import { StatusChip } from './StatusChip.tsx';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      <Copy size={12} aria-hidden /> {done ? 'Copied' : `Copy ${label}`}
    </button>
  );
}

function Block({ title, children, copy }: { title: string; children: ReactNode; copy?: string }) {
  return (
    <div className="rounded border border-line bg-ink/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="font-medium tracking-wide uppercase">{title}</span>
        {copy !== undefined && <CopyButton text={copy} label="" />}
      </div>
      {children}
    </div>
  );
}

function SourceView({ s, onOpen }: { s: ResolvedSource; onOpen: (id: string) => void }) {
  switch (s.type) {
    case 'document':
      return (
        <Block
          title={`${s.fileName}, page ${s.page}`}
          copy={s.lines
            .filter((l) => l.cited)
            .map((l) => l.text)
            .join('\n')}
        >
          <pre className="overflow-x-auto font-mono text-xs leading-5">
            {s.lines.map((l) => (
              <div key={l.n} className={l.cited ? 'bg-accent/15 text-text' : 'text-muted'}>
                <span className="mr-3 inline-block w-8 text-right text-muted select-none">{l.n}</span>
                {l.text}
              </div>
            ))}
          </pre>
        </Block>
      );
    case 'statement_row':
    case 'kpo_row': {
      const ref = s.source as { file: string; rowIndex: number };
      return (
        <Block
          title={`${s.type === 'statement_row' ? 'Statement' : 'KPO book'} ${ref.file}, row ${ref.rowIndex}`}
          copy={s.rawLine}
        >
          <pre className="overflow-x-auto font-mono text-xs leading-5">
            <div className="text-muted">{s.header.join(' | ')}</div>
            <div className="bg-accent/15">{s.rawLine}</div>
          </pre>
        </Block>
      );
    }
    case 'url':
      return (
        <Block title="Fetched data" copy={s.value ?? s.body}>
          <p className="text-xs">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-accent hover:underline"
            >
              {s.url} <ExternalLink size={12} aria-hidden />
            </a>
          </p>
          <p className="mt-1 text-xs text-muted">
            Fetched {s.fetchedAt} · HTTP {s.httpStatus}
            {s.value !== undefined && (
              <>
                {' '}
                · value <span className="num bg-accent/15 px-1 text-text">{s.value}</span>
              </>
            )}
          </p>
          <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs text-muted">{s.body}</pre>
        </Block>
      );
    case 'rule':
      return (
        <Block title={`Rule ${s.ruleId}`} copy={s.statementEn}>
          <div className="mb-2 flex items-center gap-2">
            <StatusChip status={s.status === 'verified' ? 'rule_verified' : s.status} />
            <span className="font-medium">{s.title}</span>
          </div>
          <p lang="sr" className="text-sm">
            {s.statementSr}
          </p>
          <p className="mt-1 text-sm text-muted">{s.statementEn}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {s.links.map((l) => (
              <li key={l.url + (l.locator ?? '')}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {l.title}
                  {l.locator ? `, ${l.locator}` : ''} <ExternalLink size={12} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Block>
      );
    case 'user_answer':
      return (
        <Block title="Your answer" copy={s.answer}>
          <p className="text-sm">{s.question}</p>
          <p className="mt-1 text-sm">
            Answer: <span className="font-medium">{s.answer}</span>{' '}
            <span className="text-xs text-muted">({s.answeredAt})</span>
          </p>
        </Block>
      );
    case 'contract_field':
      return (
        <Block title={`Contract details, ${s.clientName}`} copy={s.value}>
          <p className="text-sm">
            {s.field}: <span className="font-medium">{s.value}</span>
          </p>
        </Block>
      );
    case 'derived':
      return (
        <Block title="Computed from">
          <ul className="flex flex-wrap gap-2">
            {s.inputs.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onOpen(i.id)}
                  className="rounded border border-line bg-panel-2 px-2 py-1 text-left text-xs hover:border-accent"
                >
                  <span className="block font-mono text-muted">{i.key}</span>
                  <span className="num">{valueText(i.value)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      );
    case 'missing':
      return (
        <Block title="Source not available">
          <p className="text-sm text-danger">{s.reason}</p>
        </Block>
      );
  }
}

export function SourceDrawer({
  runId,
  figureId,
  onClose,
}: {
  runId: string;
  figureId: string;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<string[]>([figureId]);
  const [detail, setDetail] = useState<FigureDetail>();
  const [error, setError] = useState<string>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = stack[stack.length - 1] ?? figureId;

  useEffect(() => setStack([figureId]), [figureId]);
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    setError(undefined);
    getJson<FigureDetail>(`/api/runs/${runId}/figures/${current}`)
      .then((d) => live && setDetail(d))
      .catch(
        (e: unknown) => live && setError(e instanceof ApiError ? e.message : 'Could not load this figure.'),
      );
    return () => {
      live = false;
    };
  }, [runId, current]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = detail?.figure;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Figure sources"
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          {stack.length > 1 && (
            <button
              type="button"
              onClick={() => setStack(stack.slice(0, -1))}
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
            >
              <ArrowLeft size={14} aria-hidden /> Back
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted hover:text-text"
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {error && <p className="text-danger">{error}</p>}
        {!detail && !error && <p className="text-muted">Loading...</p>}
        {f && detail && (
          <div className="space-y-4">
            <div>
              <p className="font-mono text-xs break-all text-muted">{f.key}</p>
              <p className="num mt-1 text-2xl font-semibold">{valueText(f.value)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusChip status={f.status} />
                <span>by {AGENT_NAMES[f.producedBy] ?? f.producedBy}</span>
                <span>version {f.version}</span>
                <span className="font-mono">{f.id}</span>
                <CopyButton text={valueText(f.value)} label="value" />
              </div>
            </div>
            {f.derivation && (
              <Block title={`Formula (${f.derivation.ruleId})`} copy={f.derivation.formula}>
                <p className="font-mono text-sm">{f.derivation.formula}</p>
              </Block>
            )}
            {f.checks && f.checks.length > 0 && (
              <Block title="Verifier checks">
                <ul className="space-y-1 text-sm">
                  {f.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2">
                      <StatusChip
                        status={c.passed ? 'verified' : 'contested'}
                        label={c.passed ? 'Passed' : 'Failed'}
                      />
                      <span>
                        {c.name}
                        {c.detail && <span className="text-muted">: {c.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>
            )}
            {detail.sources.map((s, i) => (
              <SourceView key={i} s={s} onOpen={(id) => setStack([...stack, id])} />
            ))}
            {detail.versions.length > 1 && (
              <Block title="Versions">
                <ul className="space-y-1 text-sm">
                  {detail.versions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setStack([...stack, v.id])}
                        className="flex w-full items-center gap-2 text-left hover:text-accent"
                      >
                        <span className="text-muted">v{v.version}</span>
                        <span className="num">{valueText(v.value)}</span>
                        <StatusChip status={v.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
