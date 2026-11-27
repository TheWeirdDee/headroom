// Headroom card (PRD 16.2). Every number is the server's display string for a verified figure and opens its
// sources. The bar width is display only; the band comes from the server, computed with exact decimals.
import { Link } from 'react-router';
import { CircleAlert, CircleCheck, CircleDashed, Info, TriangleAlert } from 'lucide-react';
import type { Band, CardBand, CardVM, Crossing, Discrepancy, MoneyVM } from '../api/types.ts';
import { formatRsd, formatDateSr } from '../format/money.ts';

const SEVERITY: Band[] = ['green', 'amber', 'red', 'crossed'];

const BAND: Record<CardBand, { label: string; cls: string; bar: string; Icon: typeof CircleCheck }> = {
  incomplete: { label: 'Incomplete', cls: 'text-muted', bar: 'bg-muted', Icon: CircleDashed },
  green: { label: 'Room left', cls: 'text-accent', bar: 'bg-accent', Icon: CircleCheck },
  amber: { label: 'Getting close', cls: 'text-amber', bar: 'bg-amber', Icon: Info },
  red: { label: 'Very close', cls: 'text-danger', bar: 'bg-danger', Icon: TriangleAlert },
  crossed: { label: 'Over the line', cls: 'text-danger', bar: 'bg-danger', Icon: CircleAlert },
};

function Num({
  m,
  onOpen,
  className = '',
}: {
  m: MoneyVM;
  onOpen: (id: string) => void;
  className?: string;
}) {
  if (!m.figureId) return <span className={`num ${className}`}>{m.display}</span>;
  const id = m.figureId;
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className={`num underline decoration-line decoration-dotted underline-offset-4 hover:decoration-accent ${className}`}
      title="Show sources"
    >
      {m.display}
    </button>
  );
}

function pct(committed: string, limit: string): number {
  const c = Number.parseFloat(committed);
  const l = Number.parseFloat(limit);
  return l > 0 ? Math.max(0, Math.min(100, (c / l) * 100)) : 0;
}

function Bar({
  committed,
  withDraft,
  limit,
  band,
}: {
  committed: string;
  withDraft: string;
  limit: string;
  band: CardBand;
}) {
  const a = pct(committed, limit);
  const b = pct(withDraft, limit);
  return (
    <div className="relative mt-3 h-2 rounded bg-panel-2" aria-hidden>
      <div
        className={`absolute inset-y-0 left-0 rounded ${BAND[band].bar} opacity-90`}
        style={{ width: `${a}%` }}
      />
      <div
        className={`absolute inset-y-0 rounded-r ${BAND[band].bar} opacity-40`}
        style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%` }}
      />
      <div className="absolute inset-y-[-3px] w-px bg-muted" style={{ left: '90%' }} />
    </div>
  );
}

function BandChip({ band }: { band: CardBand }) {
  const { label, cls, Icon } = BAND[band];
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${cls}`}>
      <Icon size={14} aria-hidden /> {label}
    </span>
  );
}

const INDEP: Record<string, { label: string; cls: string; Icon: typeof CircleCheck }> = {
  passes: { label: 'Passes', cls: 'text-accent', Icon: CircleCheck },
  at_risk: { label: 'At risk', cls: 'text-amber', Icon: TriangleAlert },
  fails: { label: 'Fails', cls: 'text-danger', Icon: CircleAlert },
  not_applicable: { label: 'Not applicable', cls: 'text-muted', Icon: Info },
  pending: { label: 'Pending', cls: 'text-muted', Icon: Info },
  incomplete: { label: 'Incomplete', cls: 'text-muted', Icon: CircleDashed },
};

/** The headline when client payments have no invoice: the answer with them, then without. */
function Unbilled({ limit, onOpen }: { limit: CardVM['limit6m']; onOpen: (id: string) => void }) {
  const u = limit.unbilled;
  if (!u) return null;
  const many = u.payments.length > 1;
  return (
    <>
      <p className="mt-1 text-3xl font-semibold tracking-tight">
        <Num m={u.over ?? u.headroom} onOpen={onOpen} className={BAND[u.band].cls} />
        {u.over && <span className={`ml-2 text-xl ${BAND[u.band].cls}`}>over</span>}
      </p>
      <p className="text-sm">
        {u.over ? 'over the limit' : 'left'} if the {many ? `${u.payments.length} payments` : 'payment'} with
        no invoice {many ? 'are' : 'is'} invoiced:{' '}
        {u.payments.map((p, i) => (
          <span key={p.figureId}>
            {i > 0 && ', '}
            <button
              type="button"
              onClick={() => onOpen(p.figureId)}
              className="num underline decoration-dotted underline-offset-4"
            >
              {p.display}
            </button>{' '}
            on {formatDateSr(p.date)}
          </span>
        ))}
        .
      </p>
      <p className="mt-1 text-xs text-muted">
        On your invoices alone, after this one: <Num m={limit.headroomWithDraft} onOpen={onOpen} /> left.
      </p>
    </>
  );
}

/** Why there is no verdict yet, worst first. */
function Gaps({ card }: { card: CardVM }) {
  const order = ['failed', 'missing', 'needs_you', 'pending'];
  const gaps = [...card.completeness.gaps].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const failed = gaps.some((g) => g.kind === 'failed' || g.kind === 'missing');
  return (
    <div
      role="status"
      className={`rounded border p-3 text-sm ${failed ? 'border-danger/60 bg-danger/10' : 'border-line bg-panel-2'}`}
    >
      <p className={`flex items-center gap-1 font-medium ${failed ? 'text-danger' : ''}`}>
        <CircleDashed size={14} aria-hidden /> Incomplete: no verdict until every input is verified
      </p>
      <ul className="mt-1 space-y-0.5 text-muted">
        {gaps.slice(0, 5).map((g) => (
          <li key={g.text}>{g.text}</li>
        ))}
        {gaps.length > 5 && <li>And {gaps.length - 5} more.</li>}
      </ul>
    </div>
  );
}

function IndepStatus({
  status,
  figureId,
  onOpen,
}: {
  status: string;
  figureId?: string;
  onOpen: (id: string) => void;
}) {
  const s = INDEP[status] ?? { label: status, cls: 'text-muted', Icon: Info };
  const body = (
    <>
      <s.Icon size={12} aria-hidden /> {s.label}
    </>
  );
  return figureId ? (
    <button
      type="button"
      onClick={() => onOpen(figureId)}
      className={`inline-flex items-center gap-1 text-xs font-medium underline decoration-dotted underline-offset-4 ${s.cls}`}
    >
      {body}
    </button>
  ) : (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>{body}</span>
  );
}

function RuleChip({ id }: { id: string }) {
  return (
    <Link
      to={`/about#${id}`}
      className="inline-flex items-center gap-1 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-xs text-amber hover:bg-amber/20"
      title="An assumption: not confirmed by an official source"
    >
      <Info size={11} aria-hidden /> Assumption {id}
    </Link>
  );
}

export function HeadroomCard({
  card,
  crossings,
  discrepancies,
  onOpen,
  compact = false,
}: {
  card: CardVM | null;
  crossings: Crossing[];
  discrepancies: Record<string, Discrepancy>;
  onOpen: (figureId: string) => void;
  /** Landing-page size: per-client details and assumption chips are summarised in one line each. */
  compact?: boolean;
}) {
  if (!card)
    return (
      <section className="rounded border border-line bg-panel p-5" aria-label="Headroom">
        <h2 className="font-medium">Headroom</h2>
        <p className="mt-2 text-sm text-muted">
          Shown once the totals are verified. No number appears here before the Verifier has checked it.
        </p>
      </section>
    );
  const l = card.limit6m;
  const v = card.vat8m;
  // Every finding that flips the band is shown (latest report per finding), the most severe first: a
  // payment that pushes the total over the line must not be hidden by a later, smaller crossing.
  const shown = [...new Map(crossings.map((c) => [c.discrepancyId, c])).values()].sort(
    (a, b) => SEVERITY.indexOf(b.bandAfter) - SEVERITY.indexOf(a.bandAfter),
  );
  const over = shown.some((c) => c.bandAfter === 'crossed');
  return (
    <section className="space-y-4 rounded border border-line bg-panel p-5" aria-label="Headroom">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">Headroom</h2>
        <span className="text-xs text-muted">as of {formatDateSr(card.asOf)}</span>
      </div>

      <div className="rounded border border-line bg-ink/50 p-3 text-sm">
        <span className="text-muted">This invoice: </span>
        <span className="num font-medium">{card.draft.amount.display}</span>
        {card.draft.amountRSD && (
          <>
            <span className="text-muted"> = </span>
            <Num m={card.draft.amountRSD} onOpen={onOpen} className="font-medium" />
          </>
        )}
      </div>

      {!card.completeness.complete && <Gaps card={card} />}

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm text-muted">6M flat-rate limit, {card.asOf.slice(0, 4)}</h3>
          <BandChip band={l.unbilled?.band ?? l.band} />
        </div>
        {l.band !== 'incomplete' && l.unbilled ? (
          <Unbilled limit={l} onOpen={onOpen} />
        ) : l.band === 'incomplete' ? (
          <>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-muted">Incomplete</p>
            <p className="text-xs text-muted">
              From the figures verified so far: <Num m={l.headroomWithDraft} onOpen={onOpen} /> left. This is
              not the answer yet.
            </p>
            {l.unbilled?.crossed && (
              <p role="alert" className="mt-2 rounded border border-danger/60 bg-danger/10 p-2 text-sm">
                Already known: with the payment(s) that have no invoice, the verified figures reach{' '}
                <Num m={l.unbilled.total} onOpen={onOpen} />, at or over the limit.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tracking-tight">
              <Num m={l.headroomWithDraft} onOpen={onOpen} className={BAND[l.band].cls} />
            </p>
            <p className="text-xs text-muted">left after this invoice</p>
          </>
        )}
        <Bar
          committed={l.committed.amount}
          withDraft={l.withDraft.amount}
          limit={l.limit.amount}
          band={l.unbilled?.band ?? l.band}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Invoiced so far</dt>
          <dd className="text-right">
            <Num m={l.committed} onOpen={onOpen} />
          </dd>
          <dt className="text-muted">With this invoice</dt>
          <dd className="text-right">
            <Num m={l.withDraft} onOpen={onOpen} />{' '}
            <span className="num text-muted">({l.ratioWithDraft.display})</span>
          </dd>
          <dt className="text-muted">Limit</dt>
          <dd className="text-right">
            <Num m={l.limit} onOpen={onOpen} />
          </dd>
        </dl>
        {l.consequenceRuleId && (
          <p className="mt-2 text-xs text-muted">
            What crossing means:{' '}
            <Link to={`/about#${l.consequenceRuleId}`} className="text-accent hover:underline">
              {l.consequenceRuleId}
            </Link>
          </p>
        )}
      </div>

      {shown.length > 0 && (
        <div
          role="status"
          className={`rounded border p-3 text-sm ${over ? 'border-danger/60 bg-danger/10' : 'border-amber/50 bg-amber/10'}`}
        >
          <p className={`flex items-center gap-1 font-medium ${over ? 'text-danger' : 'text-amber'}`}>
            <TriangleAlert size={14} aria-hidden /> A correction changes the band
          </p>
          <ul className="mt-1 space-y-1">
            {shown.map((c) => (
              <li key={c.discrepancyId}>
                {discrepancies[c.discrepancyId]?.title ?? c.discrepancyType} moves the total by{' '}
                <span className="num font-medium">{formatRsd(c.deltaRSD)}</span>, from{' '}
                {BAND[c.bandBefore].label.toLowerCase()} to {BAND[c.bandAfter].label.toLowerCase()}
                {c.baseline === 'book'
                  ? ', measured from your own book.'
                  : ', measured from the corrected figures.'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm text-muted">8M VAT threshold, last 365 days</h3>
          <BandChip band={v.band} />
        </div>
        <p className="mt-1 text-xl font-semibold">
          {v.band === 'incomplete' ? (
            <span className="text-muted">Incomplete</span>
          ) : (
            <Num m={v.headroomWithDraft} onOpen={onOpen} className={BAND[v.band].cls} />
          )}
        </p>
        <Bar
          committed={v.committed.amount}
          withDraft={v.withDraft.amount}
          limit={v.threshold.amount}
          band={v.band}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Counted turnover</dt>
          <dd className="text-right">
            <Num m={v.committed} onOpen={onOpen} />
          </dd>
          <dt className="text-muted">With this invoice</dt>
          <dd className="text-right">
            <Num m={v.withDraft} onOpen={onOpen} />
          </dd>
        </dl>
        {!compact && v.assumptionRuleIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {v.assumptionRuleIds.map((id) => (
              <RuleChip key={id} id={id} />
            ))}
          </div>
        )}
      </div>

      {compact ? (
        <div className="flex items-center justify-between gap-2 border-t border-line pt-4 text-sm">
          <span className="text-muted">Independence test</span>
          <span>
            {card.independence.filter((c) => c.status === 'passes').length} of {card.independence.length}{' '}
            clients pass
          </span>
        </div>
      ) : (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm text-muted">Independence test, per client</h3>
          <ul className="mt-2 space-y-2">
            {card.independence.map((c) => (
              <li key={c.clientId} className="rounded border border-line p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.clientName}</span>
                  <IndepStatus
                    status={c.status}
                    {...(c.statusFigureId ? { figureId: c.statusFigureId } : {})}
                    onOpen={onOpen}
                  />
                </div>
                <p className="num mt-1 text-xs text-muted">
                  {c.met} of 9 criteria met · {c.notMet} not met · {c.unknown} unknown
                  {c.share12mWithDraft && (
                    <>
                      {' '}
                      · share of income{' '}
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-4"
                        onClick={() => c.share12mWithDraft && onOpen(c.share12mWithDraft.figureId)}
                      >
                        {c.share12mWithDraft.display}
                      </button>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {compact
        ? card.assumptionRuleIds.length > 0 && (
            <p className="border-t border-line pt-3 text-xs text-muted">
              {card.assumptionRuleIds.length} rules used here are assumptions still to be confirmed by an
              accountant. Not financial or tax advice.
            </p>
          )
        : card.assumptionRuleIds.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-line pt-3">
              {card.assumptionRuleIds.map((id) => (
                <RuleChip key={id} id={id} />
              ))}
            </div>
          )}
      {!compact && <p className="text-xs text-muted">{card.disclaimer}</p>}
    </section>
  );
}
