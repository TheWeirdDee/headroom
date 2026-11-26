// Verifier (PRD 8.6): independently re-checks every proposed figure before it counts, and settles
// conflicts against the source. Steps: source presence, integrity, derivation, fidelity, plausibility.
// Its model context holds only the claimed value and the cited excerpt, never the producer's reasoning.
import { z } from 'zod';
import { AGENTS, Semaphore, jsonSchema, loadPrompt, setStatus, type AgentDeps } from '../common.ts';
import { checkSources, type SourceContext } from './sources.ts';
import { checkDerivation } from './derive.ts';
import { checkFidelity, checkPlausibility, type ModelQuestion } from './fidelity.ts';
import { keys, parseKey } from '../../domain/keys.ts';
import { yearOf } from '../../domain/dates.ts';
import { sub } from '../../domain/money.ts';
import { postDiscrepancy } from '../discrepancy.ts';
import { sha256 } from '../../util/hash.ts';
import type { RejectionReason } from '../../runtime/state.ts';
import type { Figure, Question, SourceRef, VerificationCheck } from '../../domain/types.ts';
import type { HrEvent } from '../../runtime/types.ts';

const ID = AGENTS.verifier;
const MAX_CONTESTS_PER_KEY = 3; // the first claim plus at most two re-proposals

export const FidelityAnswer = z.object({
  normalizedValue: z.string().max(100),
  supports: z.boolean(),
  reason: z.string().max(400),
});

/** Source authority for invoice facts: document > statement row > KPO row (derived = from documents). */
export function authority(f: Figure, keyKind: 'invoice' | 'payment' | 'other'): number {
  const t = f.sources[0]?.type;
  if (keyKind === 'payment') return t === 'statement_row' ? 2 : t === 'document' ? 1 : 0;
  if (keyKind === 'invoice')
    return t === 'document' || t === 'derived' ? 3 : t === 'statement_row' ? 2 : t === 'kpo_row' ? 1 : 0;
  return 0;
}

const DERIVED_KINDS = new Set(['total', 'headroom', 'ratio', 'share12m', 'indep', 'draft']);

type Outcome =
  | { pass: true; checks: VerificationCheck[] }
  | { pass: false; reason: RejectionReason; detail: string; checks: VerificationCheck[] }
  | { wait: true; inputs: string[] }
  | { stale: true };

export function registerVerifier(deps: AgentDeps): void {
  const { rt, rules, inputs, kurs } = deps;
  const state = rt.state;
  const ctx: SourceContext = { inputs, rules, kurs, state };
  const prompt = loadPrompt('verifier');
  const schema = jsonSchema(FidelityAnswer);
  const limit = new Semaphore(state.config.concurrency.verifier);
  const contests = new Map<string, number>();
  const waiting = new Map<string, Set<string>>(); // input figure id -> figures waiting on it
  const inFlight = new Set<string>();

  rt.join({ id: ID, name: 'Verifier', kind: 'agent' });

  async function askModel(
    q: ModelQuestion,
    key: string,
  ): Promise<{ supports: boolean; normalized: string; reason: string } | undefined> {
    const user = [
      `Claim is about: ${q.field}`,
      `Claimed value: ${q.claimed}`,
      ...(q.allowed.length ? [`Allowed values: ${q.allowed.join(', ')}`] : []),
      '<source>',
      q.excerpt,
      '</source>',
    ].join('\n');
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await rt.startLoop({
        agentId: ID,
        loopInputKey: `fidelity:${key}:${q.claimed}:${q.excerptSha256 || sha256(q.excerpt)}:a${attempt}`,
        system: prompt.text,
        promptHash: prompt.hash,
        user,
        model: state.config.models.verifier,
        maxOutputTokens: 400,
        tools: [],
        structuredOutput: { name: 'fidelity_answer', schema: schema.schema },
        schemaHash: schema.hash,
      }).done;
      if (result.status !== 'completed' || !result.answer) continue;
      try {
        const parsed = FidelityAnswer.safeParse(JSON.parse(result.answer));
        if (parsed.success)
          return {
            supports: parsed.data.supports,
            normalized: parsed.data.normalizedValue,
            reason: parsed.data.reason,
          };
      } catch {
        // not JSON: try once more
      }
    }
    return undefined;
  }

  async function evaluate(f: Figure): Promise<Outcome> {
    const checks: VerificationCheck[] = [];
    const src = checkSources(f, ctx);
    checks.push({
      name: 'source_presence',
      passed: src.ok || src.code !== 'UNSOURCED',
      ...(!src.ok && src.code === 'UNSOURCED' ? { detail: src.detail } : {}),
    });
    if (!src.ok && src.code === 'UNSOURCED')
      return { pass: false, reason: 'UNSOURCED', detail: src.detail, checks };
    checks.push({ name: 'integrity', passed: src.ok, ...(!src.ok ? { detail: src.detail } : {}) });
    if (!src.ok) return { pass: false, reason: 'SOURCE_MISMATCH', detail: src.detail, checks };

    const der = checkDerivation(f, ctx);
    if (der.kind === 'waiting') return { wait: true, inputs: der.inputs };
    if (der.kind === 'stale') return { stale: true };
    if (der.kind === 'mismatch') {
      checks.push({
        name: 'derivation',
        passed: false,
        detail: `expected ${der.expected}, posted ${der.posted}`,
      });
      return {
        pass: false,
        reason: 'DERIVATION_MISMATCH',
        detail: `expected ${der.expected}, posted ${der.posted}`,
        checks,
      };
    }
    if (der.kind === 'ok') checks.push({ name: 'derivation', passed: true });

    const fid = checkFidelity(f, ctx);
    if (fid.kind === 'fail') {
      checks.push({ name: 'fidelity', passed: false, detail: fid.detail });
      return { pass: false, reason: 'NOT_SUPPORTED_BY_SOURCE', detail: fid.detail, checks };
    }
    if (fid.kind === 'model') {
      setStatus(rt, ID, { kind: 'verifying', key: f.key, check: 'does the source say this?' });
      const ans = await askModel(fid.question, f.key);
      const agrees =
        ans !== undefined &&
        ans.supports &&
        ans.normalized.trim().toLowerCase() === fid.question.claimed.trim().toLowerCase();
      const detail = ans
        ? `checker read "${ans.normalized}": ${ans.reason}`
        : 'the fidelity check returned no usable answer';
      checks.push({ name: 'fidelity', passed: agrees, detail });
      if (!agrees) return { pass: false, reason: 'NOT_SUPPORTED_BY_SOURCE', detail, checks };
    } else if (der.kind === 'not_derived') {
      checks.push({ name: 'fidelity', passed: true });
    }

    const implausible = checkPlausibility(f, state.config.year);
    checks.push({
      name: 'plausibility',
      passed: implausible === undefined,
      ...(implausible ? { detail: implausible } : {}),
    });
    if (implausible) return { pass: false, reason: 'IMPLAUSIBLE', detail: implausible, checks };
    return { pass: true, checks };
  }

  function current(id: string): Figure | undefined {
    const f = state.figures.get(id);
    return f && f.status === 'proposed' ? f : undefined;
  }

  function contest(f: Figure, reason: RejectionReason, detail: string, checks: VerificationCheck[]): void {
    state.countRejection(reason);
    const n = (contests.get(f.key) ?? 0) + 1;
    contests.set(f.key, n);
    if (n >= MAX_CONTESTS_PER_KEY) {
      state.setFigureStatus(f.id, 'needs_user', ID, checks, `${reason}: ${detail}`);
      askUser(
        f.key,
        `The value for ${f.key} was disputed ${n} times (${detail}). Please check the source document.`,
      );
      return;
    }
    state.setFigureStatus(f.id, 'contested', ID, checks, `${reason}: ${detail}`);
  }

  function askUser(subjectKey: string, text: string): void {
    const id = `q-verifier-${sha256(subjectKey).slice(0, 12)}`;
    if (state.questions.has(id)) return;
    const q: Question = { id, askedBy: ID, subjectKey, text, options: ['Checked'] };
    state.questions.set(id, q);
    rt.publish('hr.question.asked', ID, { question: q });
  }

  function park(f: Figure, inputIds: string[]): void {
    for (const id of inputIds) {
      const set = waiting.get(id) ?? new Set<string>();
      set.add(f.id);
      waiting.set(id, set);
    }
  }

  function wake(inputId: string): void {
    const set = waiting.get(inputId);
    if (!set) return;
    waiting.delete(inputId);
    for (const id of set) void verify(id);
  }

  async function verify(id: string): Promise<void> {
    if (inFlight.has(id)) return;
    const f = current(id);
    if (!f) return;
    inFlight.add(id);
    try {
      await limit.run(async () => {
        setStatus(rt, ID, { kind: 'verifying', key: f.key, check: 'sources, hashes and arithmetic' });
        const o = await evaluate(f);
        if (!current(id)) return; // superseded meanwhile
        if ('wait' in o) return park(f, o.inputs);
        if ('stale' in o) {
          state.setFigureStatus(
            f.id,
            'superseded',
            ID,
            undefined,
            'an input was replaced; a newer version follows',
          );
          return;
        }
        if (o.pass) {
          state.setFigureStatus(f.id, 'verified', ID, o.checks);
          afterVerified(f);
        } else contest(f, o.reason, o.detail, o.checks);
      });
    } finally {
      inFlight.delete(id);
      if (state.figuresWhere((x) => x.status === 'proposed').length === 0)
        setStatus(rt, ID, { kind: 'idle' });
    }
  }

  /** Follow-ups once a figure is verified: E9 country check, discrepancy records, waiting derivations. */
  function afterVerified(f: Figure): void {
    const p = parseKey(f.key);
    if (p?.kind === 'discrepancy') {
      const d = state.discrepancies.get(f.id);
      if (d) {
        d.status = 'verified';
        rt.publish('hr.discrepancy.raised', ID, { discrepancy: structuredClone(d) });
      }
    }
    if (p?.kind === 'invoice' && p.field === 'clientCountry' && f.value.t === 'text') {
      const clientFig = state
        .figuresWhere(
          (x) =>
            x.key === keys.invoice(p.invNo, 'client') &&
            x.status !== 'contested' &&
            x.status !== 'superseded',
        )
        .pop();
      const clientId = clientFig?.value.t === 'text' ? clientFig.value.text : undefined;
      const client = clientId ? inputs.clients.find((c) => c.id === clientId) : undefined;
      if (client && client.country !== f.value.text) {
        postDiscrepancy(deps, {
          type: 'E9',
          subjectKey: `invoice:${p.invNo}`,
          producedBy: ID,
          detail: `Invoice ${p.invNo} gives the client's country as ${f.value.text}; the client details say ${client.country}. This decides whether the invoice counts toward the 8M VAT threshold.`,
          sources: [
            ...f.sources.filter((s) => s.type === 'document'),
            { type: 'contract_field', clientId: client.id, field: 'country', value: client.country },
          ],
          figureIds: [f.id],
        });
      }
    }
    wake(f.id);
  }

  /** Conflict resolution: same key, different values (PRD 8.6). */
  async function resolve(existingId: string, proposedId: string): Promise<void> {
    const a = state.figures.get(existingId);
    const b = state.figures.get(proposedId);
    if (!a || !b) return;
    const p = parseKey(b.key);
    if (p && DERIVED_KINDS.has(p.kind)) return verify(b.id); // re-derivation: the newer version is checked; verifying it supersedes the old
    if (p?.kind === 'invoice' && p.field === 'amountRSD' && a.producedBy === b.producedBy)
      return verify(b.id);
    setStatus(rt, ID, { kind: 'resolving_conflict', key: b.key });
    const [oa, ob] = await Promise.all([
      a.status === 'verified'
        ? Promise.resolve<Outcome>({ pass: true, checks: a.checks ?? [] })
        : evaluate(a),
      evaluate(b),
    ]);
    if ('wait' in ob || 'stale' in ob) return 'wait' in ob ? park(b, ob.inputs) : undefined;
    if ('wait' in oa || 'stale' in oa) return verify(b.id);
    const aOk = oa.pass;
    const bOk = ob.pass;
    if (!aOk && !bOk) {
      if (state.figures.get(a.id)?.status === 'proposed') contest(a, oa.reason, oa.detail, oa.checks);
      if (state.figures.get(b.id)?.status === 'proposed') contest(b, ob.reason, ob.detail, ob.checks);
      return;
    }
    if (aOk !== bOk) {
      const [win, lose, lo] = aOk ? [a, b, ob] : [b, a, oa];
      if (state.figures.get(win.id)?.status === 'proposed') {
        state.setFigureStatus(win.id, 'verified', ID, aOk ? oa.checks : ob.checks);
        afterVerified(win);
      }
      if (!lo.pass && state.figures.get(lose.id)?.status === 'proposed')
        contest(lose, lo.reason, lo.detail, lo.checks);
      return;
    }
    // Both pass: source authority decides.
    const keyKind =
      p?.kind === 'invoice' ? 'invoice' : p?.kind === 'payment' || p?.kind === 'link' ? 'payment' : 'other';
    const ra = authority(a, keyKind);
    const rb = authority(b, keyKind);
    if (ra === rb) {
      // Equal weight: the key is ambiguous, so neither value counts until the user decides.
      state.setFigureStatus(
        b.id,
        'needs_user',
        ID,
        ob.pass ? ob.checks : [],
        'two sources of equal weight disagree',
      );
      if (state.figures.get(a.id)?.status !== 'superseded') {
        state.setFigureStatus(
          a.id,
          'needs_user',
          ID,
          oa.pass ? oa.checks : [],
          'two sources of equal weight disagree',
        );
      }
      postDiscrepancy(deps, {
        type: 'E-CONFLICT',
        subjectKey: b.key,
        producedBy: ID,
        detail: `${b.key}: ${valueText(a)} (${a.sources[0]?.type}) vs ${valueText(b)} (${b.sources[0]?.type}).`,
        sources: [...a.sources, ...b.sources],
        figureIds: [a.id, b.id],
      });
      askUser(
        b.key,
        `Two sources of equal weight disagree on ${b.key}: ${valueText(a)} or ${valueText(b)}. Which is right?`,
      );
      return;
    }
    const [win, lose] = ra > rb ? [a, b] : [b, a];
    if (state.figures.get(win.id)?.status === 'proposed') {
      state.setFigureStatus(
        win.id,
        'verified',
        ID,
        ra > rb ? (oa.pass ? oa.checks : []) : ob.pass ? ob.checks : [],
      );
      afterVerified(win);
    }
    if (state.figures.get(lose.id)?.status !== 'superseded') {
      state.setFigureStatus(
        lose.id,
        'superseded',
        ID,
        undefined,
        `outranked by ${win.sources[0]?.type ?? 'a stronger'} source`,
      );
    }
    raiseSourceDisagreement(win, lose);
  }

  function valueText(f: Figure): string {
    const v = f.value;
    return v.t === 'money'
      ? `${v.amount} ${v.currency}`
      : v.t === 'date'
        ? v.iso
        : v.t === 'text'
          ? v.text
          : JSON.stringify(v);
  }

  /** The losing KPO claim becomes E2, E4 or E7 with both sources (E5 for foreign amounts is RateClerk's). */
  function raiseSourceDisagreement(win: Figure, lose: Figure): void {
    if (lose.sources[0]?.type !== 'kpo_row') return;
    const p = parseKey(win.key);
    if (p?.kind !== 'invoice') return;
    const both: SourceRef[] = [...win.sources, ...lose.sources];
    if (p.field === 'issueDate' && win.value.t === 'date' && lose.value.t === 'date') {
      const year = state.config.year;
      const prevYear = yearOf(win.value.iso) < year && yearOf(lose.value.iso) === year;
      const amount = state.verified(keys.invoice(p.invNo, 'amountRSD'));
      postDiscrepancy(deps, {
        type: prevYear ? 'E7' : 'E2',
        subjectKey: `invoice:${p.invNo}`,
        producedBy: ID,
        detail: prevYear
          ? `Invoice ${p.invNo} was issued on ${win.value.iso}, in ${yearOf(win.value.iso)}, but the KPO book enters it on ${lose.value.iso} in ${year}.`
          : `The KPO book enters invoice ${p.invNo} on ${lose.value.iso}; the invoice is dated ${win.value.iso}.`,
        sources: both,
        figureIds: [win.id, lose.id],
        baseline: 'book',
        ...(prevYear && amount?.value.t === 'money' ? { deltaRSD: `-${amount.value.amount}` } : {}),
      });
    }
    if (p.field === 'amountRSD' && win.value.t === 'money' && lose.value.t === 'money') {
      const cur = state.verified(keys.invoice(p.invNo, 'currency'));
      if (cur?.value.t === 'text' && cur.value.text !== 'RSD') return; // RateClerk raises E5 for foreign invoices
      postDiscrepancy(deps, {
        type: 'E4',
        subjectKey: `invoice:${p.invNo}`,
        producedBy: ID,
        detail: `The KPO book records ${lose.value.amount} RSD for invoice ${p.invNo}; the invoice says ${win.value.amount} RSD.`,
        sources: both,
        figureIds: [win.id, lose.id],
        baseline: 'book',
        deltaRSD: sub(win.value.amount, lose.value.amount),
      });
    }
  }

  rt.on(ID, { types: ['hr.figure.proposed'] }, (e: HrEvent) => {
    const { figure, result } = e.payload as { figure?: Figure; result: string };
    if (figure && result === 'claimed') void verify(figure.id);
  });

  rt.on(ID, { types: ['hr.figure.conflict'] }, (e: HrEvent) => {
    const { existingId, proposedId } = e.payload as { existingId: string; proposedId: string };
    void resolve(existingId, proposedId);
  });

  rt.on(ID, { types: ['hr.figure.verified'] }, (e: HrEvent) => {
    wake((e.payload as { figureId: string }).figureId);
  });

  // An input that is replaced, disputed or sent to the user retires the derivations waiting on it.
  rt.on(
    ID,
    { types: ['hr.figure.superseded', 'hr.figure.contested', 'hr.figure.needs_user'] },
    (e: HrEvent) => {
      const p = e.payload as { oldId?: string; figureId?: string };
      const oldId = p.oldId ?? p.figureId ?? '';
      const set = waiting.get(oldId);
      if (!set) return;
      waiting.delete(oldId);
      for (const id of set) void verify(id); // re-evaluates as stale and retires it
    },
  );
}
