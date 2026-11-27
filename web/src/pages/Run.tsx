// Run screen (PRD 15.2): lanes, Figure Board, Headroom card, discrepancies and questions, timeline.
import { apiUrl } from '../api/base.ts';
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BookOpen, CircleAlert, Download, FileWarning, Pencil, X } from 'lucide-react';
import { useRun, useRunConnection } from '../state/store.ts';
import { AGENT_NAMES, AGENT_ORDER, totalRejections } from '../state/reducer.ts';
import { TopBand } from '../components/TopBand.tsx';
import { AgentLane } from '../components/AgentLane.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { FigureBoard } from '../components/FigureBoard.tsx';
import { HeadroomCard } from '../components/HeadroomCard.tsx';
import { SourceDrawer } from '../components/SourceDrawer.tsx';
import { DiscrepancyList } from '../components/DiscrepancyList.tsx';
import { QuestionCard } from '../components/QuestionCard.tsx';
import { DraftForm } from '../components/DraftForm.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { VerifierCatches } from '../components/VerifierCatches.tsx';
import { formatDateSr, formatSr } from '../format/money.ts';

const RUN_STATUS: Record<string, { status: string; label: string }> = {
  running: { status: 'working', label: 'Running' },
  completed: { status: 'verified', label: 'Done' },
  awaiting_user: { status: 'needs_user', label: 'Waiting for your answers' },
  degraded: { status: 'failed', label: 'Incomplete: something failed or is missing' },
  failed: { status: 'failed', label: 'Failed' },
};

export function Run() {
  const { runId = '' } = useParams();
  useRunConnection(runId);
  const view = useRun(runId, (s) => s.view);
  const loadError = useRun(runId, (s) => s.error);
  const connected = useRun(runId, (s) => s.connected);
  const [open, setOpen] = useState<string>();
  const [tab, setTab] = useState<'discrepancies' | 'questions'>('discrepancies');
  const [editing, setEditing] = useState(false);
  const [errorsFor, setErrorsFor] = useState<string>();
  const onOpen = useCallback((id: string) => setOpen(id), []);
  const close = useCallback(() => setOpen(undefined), []);

  const discrepancies = useMemo(
    () => Object.values(view.discrepancies).filter((d) => d.status !== 'superseded'),
    [view.discrepancies],
  );
  const questions = useMemo(() => Object.values(view.questions), [view.questions]);
  const openQuestions = questions.filter((q) => q.answer === undefined).length;
  const snap = view.snapshot;

  if (loadError && !view.loaded)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <CircleAlert className="mx-auto text-danger" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">This run could not be opened</h1>
        <p className="mt-2 text-muted">{loadError}</p>
        <Link to="/check" className="mt-6 inline-block text-accent hover:underline">
          Start a new check
        </Link>
      </div>
    );
  if (!view.loaded || !snap) return <p className="px-4 py-24 text-center text-muted">Loading the run...</p>;

  const rs = RUN_STATUS[view.status] ?? { status: 'working', label: view.status };
  const laneErrors = errorsFor
    ? [
        ...view.errors
          .filter((e) => e.participantId === errorsFor)
          .map((e) => `${e.eventType}: ${e.message}`),
        ...Object.values(view.loops)
          .filter((l) => l.agentId === errorsFor && l.status === 'failed')
          .map((l) => `${l.loopId}: ${l.error ?? 'failed'}`),
      ]
    : [];

  return (
    <div>
      <TopBand
        data={snap.synthetic ? 'sample' : 'user'}
        mode={snap.mode}
        recording={snap.recording}
        rejected={totalRejections(view)}
        {...(snap.fault ? { fault: snap.fault.note } : {})}
      />
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-4">
        {view.replayMiss && (
          <div role="alert" className="rounded border border-danger/60 bg-danger/10 p-4">
            <p className="font-medium text-danger">
              This replay asked for something that wasn't recorded. Nothing was invented. Re-record the demo.
            </p>
            <p className="mt-1 font-mono text-xs break-all text-muted">
              request {view.replayMiss.requestHash || view.replayMiss.message}
            </p>
          </div>
        )}

        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-xl font-semibold">{snap.profile.name}</h1>
            <p className="text-sm text-muted">
              PIB {snap.profile.pib} · year {snap.config.year} · as of {formatDateSr(snap.config.asOf)} ·
              invoice to {snap.clients.find((c) => c.id === snap.draft.clientId)?.name ?? snap.draft.clientId}
              :{' '}
              <span className="num">
                {formatSr(snap.draft.amount)} {snap.draft.currency}
              </span>
            </p>
          </div>
          <StatusChip status={rs.status} label={rs.label} />
          {!connected && view.status === 'running' && <StatusChip status="waiting" label="Reconnecting" />}
          {snap.readOnly ? (
            <span className="text-sm text-muted">Shared sample run, read-only</span>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              aria-expanded={editing}
              className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:border-muted"
            >
              <Pencil size={14} aria-hidden /> Change the invoice
            </button>
          )}
          <Link
            to={`/runs/${runId}/kpo`}
            className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:border-muted"
          >
            <BookOpen size={14} aria-hidden /> KPO book
          </Link>
          <a
            href={apiUrl(`/api/runs/${runId}/export/report.json`)}
            className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:border-muted"
          >
            <Download size={14} aria-hidden /> Report
          </a>
        </header>
        {editing && <DraftForm runId={runId} draft={snap.draft} clients={snap.clients} />}

        <VerifierCatches figures={Object.values(view.figures)} onOpen={onOpen} />

        {(snap.parseErrors.length > 0 || snap.unreadable.length > 0) && (
          <div className="rounded border border-amber/50 bg-amber/10 p-3 text-sm">
            <p className="flex items-center gap-1 font-medium text-amber">
              <FileWarning size={14} aria-hidden /> Some input could not be read. It was skipped, not guessed.
            </p>
            <ul className="mt-1 space-y-0.5 text-muted">
              {snap.unreadable.map((u) => (
                <li key={u.fileName}>
                  {u.fileName}: {u.reason}
                </li>
              ))}
              {snap.parseErrors.slice(0, 20).map((p) => (
                <li key={`${p.file}:${p.lineNo}`}>
                  {p.file}, line {p.lineNo}: {p.message}
                </li>
              ))}
              {snap.parseErrors.length > 20 && <li>and {snap.parseErrors.length - 20} more lines</li>}
            </ul>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
          <div className="space-y-3">
            <ul className="space-y-2" aria-label="Agents">
              {AGENT_ORDER.map((a) => (
                <AgentLane key={a} view={view} agentId={a} onError={setErrorsFor} />
              ))}
            </ul>
          </div>
          <div className="min-w-0 space-y-4">
            <FigureBoard view={view} onOpen={onOpen} />
            <Timeline view={view} />
            <section className="rounded border border-line bg-panel">
              <div role="tablist" aria-label="Findings" className="flex border-b border-line">
                <button
                  role="tab"
                  type="button"
                  aria-selected={tab === 'discrepancies'}
                  onClick={() => setTab('discrepancies')}
                  className={`px-4 py-2 text-sm ${tab === 'discrepancies' ? 'border-b-2 border-accent text-text' : 'text-muted'}`}
                >
                  Discrepancies <span className="num">({discrepancies.length})</span>
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={tab === 'questions'}
                  onClick={() => setTab('questions')}
                  className={`px-4 py-2 text-sm ${tab === 'questions' ? 'border-b-2 border-accent text-text' : 'text-muted'}`}
                >
                  Questions{' '}
                  {openQuestions > 0 ? (
                    <span className="num rounded bg-amber/20 px-1.5 text-amber">{openQuestions} open</span>
                  ) : (
                    <span className="num">({questions.length})</span>
                  )}
                </button>
              </div>
              <div role="tabpanel">
                {tab === 'discrepancies' ? (
                  <DiscrepancyList items={discrepancies} onOpen={onOpen} />
                ) : questions.length === 0 ? (
                  <p className="p-4 text-sm text-muted">
                    No questions. The agents ask when a document does not settle something.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {questions.map((q) => (
                      <QuestionCard key={q.id} runId={runId} q={q} readOnly={snap.readOnly === true} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
          <div className="order-first xl:sticky xl:top-4 xl:order-none xl:self-start">
            <HeadroomCard
              card={view.card}
              crossings={view.crossings}
              discrepancies={view.discrepancies}
              onOpen={onOpen}
            />
          </div>
        </div>

        {view.summary && (
          <p className="num text-xs text-muted">
            {view.summary.loops} agent loops in {(view.summary.wallTimeMs / 1000).toFixed(1)} s wall time (
            {(view.summary.sumLoopTimeMs / 1000).toFixed(1)} s of loop time), up to{' '}
            {view.summary.maxConcurrentLoops} open at once · {view.summary.figures.verified} figures verified
            · {view.summary.unsourcedFigures} without a source · Mozaik {view.summary.mozaik.version}
          </p>
        )}
      </div>

      {open && <SourceDrawer runId={runId} figureId={open} onClose={close} />}
      {errorsFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Errors from ${AGENT_NAMES[errorsFor] ?? errorsFor}`}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setErrorsFor(undefined)}
        >
          <div
            className="w-full max-w-xl rounded border border-line bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{AGENT_NAMES[errorsFor] ?? errorsFor}: errors</h2>
              <button
                type="button"
                onClick={() => setErrorsFor(undefined)}
                aria-label="Close"
                className="text-muted hover:text-text"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <ul className="mt-3 space-y-2 font-mono text-xs">
              {laneErrors.length === 0 && <li className="text-muted">{view.agents[errorsFor]?.doingNow}</li>}
              {laneErrors.map((m, i) => (
                <li key={i} className="break-all">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
