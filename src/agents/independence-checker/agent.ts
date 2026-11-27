// IndependenceChecker (PRD 8.5). Per client: the model judges only contract_field criteria (citing the
// field and its value, checked by code against clients.json); user_answer criteria become questions;
// criterion 6 is computed by code over every qualifying 12-month window; the status is code.
import { z } from 'zod';
import { AGENTS, jsonSchema, loadPrompt, setStatus, submitTool, type AgentDeps } from '../common.ts';
import { attrSafe, fenceSafe } from '../common.ts';
import { keys, parseKey } from '../../domain/keys.ts';
import { invoiceRecords, verifiedInvoiceFigures } from '../facts.ts';
import {
  countCriteria,
  criterion6Met,
  independenceStatus,
  maxShare,
  type IncomeFact,
  type Tri,
} from '../../domain/independence.ts';
import { sha256 } from '../../util/hash.ts';
import { coverageStart } from '../../engine/inputs.ts';
import type { Client, Figure, Question, SourceRef } from '../../domain/types.ts';
import type { HrEvent } from '../../runtime/types.ts';
import type { Criterion } from '../../domain/rules/schema.ts';

const ID = AGENTS.independenceChecker;
const MAX_REREADS = 2;
export const ANSWER_OPTIONS = ['Yes', 'No', 'Not sure'] as const;

export const CriteriaSubmission = z.object({
  criteria: z
    .array(
      z.object({
        n: z.number().int().min(1).max(9),
        value: z.enum(['met', 'not_met', 'unknown']),
        field: z.string().max(80),
        fieldValue: z.string().max(500),
      }),
    )
    .min(1),
});
type CriteriaSubmission = z.infer<typeof CriteriaSubmission>;

/** Check a submission against the client's actual contract fields. Throws a readable reason. */
export function validateCriteria(
  client: Client,
  wanted: Criterion[],
  x: CriteriaSubmission,
): CriteriaSubmission['criteria'] {
  const byN = new Map(wanted.map((c) => [c.n, c]));
  const seen = new Set<number>();
  for (const c of x.criteria) {
    const rule = byN.get(c.n);
    if (!rule) throw new Error(`criterion ${c.n} is not one you were asked about`);
    if (seen.has(c.n)) throw new Error(`criterion ${c.n} appears twice`);
    seen.add(c.n);
    if (c.field !== rule.contractField)
      throw new Error(`criterion ${c.n} must cite field "${rule.contractField}"`);
    const actual = client.contract?.[c.field] ?? '';
    if (c.fieldValue !== actual)
      throw new Error(`fieldValue for "${c.field}" does not match the contract text`);
    if (actual.trim() === '' && c.value !== 'unknown')
      throw new Error(`field "${c.field}" is empty, so criterion ${c.n} is unknown`);
  }
  const missing = wanted.filter((w) => !seen.has(w.n)).map((w) => w.n);
  if (missing.length > 0) throw new Error(`criteria ${missing.join(', ')} are missing`);
  return x.criteria;
}

export function registerIndependenceChecker(deps: AgentDeps): void {
  const { rt, rules, inputs } = deps;
  const state = rt.state;
  const prompt = loadPrompt('independence-checker');
  const schema = jsonSchema(CriteriaSubmission);
  const criteria = rules.criteria();
  const contractCriteria = criteria.filter((c) => c.evalMode === 'contract_field');
  const questionCriteria = criteria.filter((c) => c.evalMode === 'user_answer');
  const threshold = rules.decimalParam('R-INDEP-C6-WINDOWS', 'shareThreshold');
  const metThreshold = rules.intParam('R-INDEP', 'metThreshold');
  const exempt = inputs.profile.activityExemptFromIndependenceTest;
  const coverage = coverageStart(inputs);
  let timer: NodeJS.Timeout | undefined;

  rt.join({ id: ID, name: 'IndependenceChecker', kind: 'agent' });
  const ruleSrc = (ruleId: string): SourceRef => ({ type: 'rule', ruleId, url: rules.url(ruleId) });

  async function readContract(
    client: Client,
    reread?: { attempt: number; feedback: string; n: number },
  ): Promise<void> {
    const lines = Object.entries(client.contract ?? {}).map(([k, v]) => `${k}: ${v}`);
    const tool = submitTool(
      'submit_criteria',
      'Submit met / not_met / unknown for each criterion, citing the contract field.',
      CriteriaSubmission,
      (x) => {
        let ok: CriteriaSubmission['criteria'];
        try {
          ok = validateCriteria(client, contractCriteria, x);
        } catch (e) {
          return `Rejected: ${e instanceof Error ? e.message : String(e)}.`;
        }
        for (const c of ok) {
          // A re-read proposes again only the criterion that was disputed; the others stand.
          if (reread && c.n !== reread.n) continue;
          const key = keys.criterion(client.id, c.n);
          state.postFigure({
            key,
            kind: 'criterion',
            value: { t: 'tri', value: c.value },
            sources: [
              { type: 'contract_field', clientId: client.id, field: c.field, value: c.fieldValue },
              ruleSrc('R-INDEP'),
            ],
            producedBy: ID,
            idempotencyKey: `${ID}/${key}${reread ? `/r${reread.attempt}` : ''}`,
          });
        }
        return `Accepted ${ok.length} criteria.`;
      },
    );
    // The checker's note quotes contract text, so it is fenced as data like the contract itself.
    const user = [
      ...(reread
        ? [
            `A checker disputed your earlier answer for criterion ${reread.n}. Its note is data, between <checker_feedback> tags. Read the contract again carefully.`,
            `<checker_feedback>\n${fenceSafe(reread.feedback)}\n</checker_feedback>`,
          ]
        : []),
      `<contract client="${attrSafe(client.name)}">`,
      ...(lines.length ? lines.map(fenceSafe) : ['(no contract details provided)']),
      '</contract>',
      '<criteria>',
      ...contractCriteria.map((c) => `${c.n} (field ${c.contractField}): ${c.text_en}`),
      '</criteria>',
    ].join('\n');
    setStatus(rt, ID, { kind: 'reading_contract', clientName: client.name });
    const result = await rt.startLoop({
      agentId: ID,
      loopInputKey: `contract:${client.id}:${sha256(user)}`,
      system: prompt.text,
      promptHash: prompt.hash,
      user,
      model: state.config.models.reader,
      maxOutputTokens: 2000,
      tools: [tool],
      schemaHash: schema.hash,
    }).done;
    if (result.status === 'failed')
      setStatus(rt, ID, {
        kind: 'error',
        message: `contract of ${client.name}: ${result.error ?? 'loop failed'}`,
      });
  }

  function ask(client: Client, c: Criterion): void {
    const id = `q-indep-${client.id}-${c.n}`;
    if (state.questions.has(id)) return;
    const q: Question = {
      id,
      askedBy: ID,
      subjectKey: keys.criterion(client.id, c.n),
      text: `${client.name}: ${c.question_en ?? c.text_en}`,
      options: [...ANSWER_OPTIONS],
      ruleId: 'R-INDEP',
    };
    state.questions.set(id, q);
    rt.publish('hr.question.asked', ID, { question: q });
  }

  function incomes(): IncomeFact[] {
    const out: IncomeFact[] = [];
    for (const r of invoiceRecords(verifiedInvoiceFigures(state)).values()) {
      if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money' || r.client?.value.t !== 'text')
        continue;
      out.push({
        clientId: r.client.value.text,
        date: r.issueDate.value.iso,
        amountRSD: r.amountRSD.value.amount,
        figureIds: [r.issueDate.id, r.amountRSD.id, r.client.id],
      });
    }
    return out;
  }

  function computeShares(): void {
    if (exempt) return;
    const base = incomes();
    const draftRsd = state.verified(keys.draft('amountRSD'));
    const withDraft: IncomeFact[] =
      draftRsd?.value.t === 'money'
        ? [
            ...base,
            {
              clientId: inputs.draft.clientId,
              date: inputs.draft.issueDate,
              amountRSD: draftRsd.value.amount,
              figureIds: [draftRsd.id],
            },
          ]
        : base;
    setStatus(rt, ID, { kind: 'computing_share', clients: inputs.clients.length });
    for (const client of inputs.clients) {
      for (const [scope, facts, through] of [
        ['committed', base, state.config.asOf],
        ['withDraft', withDraft, inputs.draft.issueDate],
      ] as const) {
        const r = maxShare(facts, client.id, state.config.year, through, coverage);
        const [firstInput, ...moreInputs] = r?.inputFigureIds ?? [];
        if (!r || !firstInput) continue;
        const key = keys.share12m(client.id, scope);
        const fig = state.postFigure({
          key,
          kind: 'share',
          value: { t: 'ratio', value: r.share, window: r.window },
          sources: [
            { type: 'derived', figureIds: [firstInput, ...moreInputs] },
            ruleSrc('R-INDEP-C6-WINDOWS'),
            ruleSrc('R-INDEP-C6-BASIS'),
            ruleSrc('R-INDEP-C6-HORIZON'),
          ],
          derivation: {
            ruleId: 'R-INDEP-C6-WINDOWS',
            inputs: r.inputFigureIds,
            formula: `${r.clientIncome} / ${r.totalIncome} RSD from ${r.window.from} to ${r.window.to}, highest of ${r.windowsEvaluated} periods${coverage ? `; your files cover from ${coverage}` : ''}`,
          },
          producedBy: ID,
          idempotencyKey: `${ID}/${key}/${r.share}/${r.inputFigureIds.join(',')}`,
          scope: scope === 'withDraft' ? 'draft' : 'committed',
        }).figure;
        if (scope === 'withDraft') {
          const ck = keys.criterion(client.id, 6);
          const met: Tri = criterion6Met(r, threshold) ? 'met' : 'not_met';
          state.postFigure({
            key: ck,
            kind: 'criterion',
            value: { t: 'tri', value: met },
            sources: [{ type: 'derived', figureIds: [fig.id] }, ruleSrc('R-INDEP-C6-WINDOWS')],
            derivation: {
              ruleId: 'R-INDEP-C6-WINDOWS',
              inputs: [fig.id],
              formula: `share with draft ${met === 'met' ? '>=' : '<'} ${threshold}`,
            },
            producedBy: ID,
            idempotencyKey: `${ID}/${ck}/${met}/${fig.id}`,
            scope: 'draft',
          });
        }
      }
    }
    setStatus(rt, ID, { kind: 'idle' });
  }

  function updateStatus(clientId: string): void {
    if (exempt) return;
    const figs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => state.verified(keys.criterion(clientId, n)));
    const tri: Tri[] = figs.map((f) => (f?.value.t === 'tri' ? f.value.value : 'unknown'));
    const status = independenceStatus(countCriteria(tri), metThreshold, false);
    const used = figs.filter((f): f is Figure => f !== undefined).map((f) => f.id);
    const key = keys.indepStatus(clientId);
    const [first, ...rest] = used;
    state.postFigure({
      key,
      kind: 'indep_status',
      value: { t: 'text', text: status },
      sources: [
        ...(first
          ? [{ type: 'derived' as const, figureIds: [first, ...rest] as [string, ...string[]] }]
          : []),
        ruleSrc('R-INDEP'),
      ],
      derivation: {
        ruleId: 'R-INDEP',
        inputs: used,
        formula: `${tri.filter((t) => t === 'met').length} met, ${tri.filter((t) => t === 'unknown').length} unknown of 9; fails at ${metThreshold} met`,
      },
      producedBy: ID,
      idempotencyKey: `${ID}/${key}/${status}/${used.join(',')}`,
    });
  }

  // A contested contract judgement is read again with the checker's note, at most MAX_REREADS times per
  // criterion; after that the Verifier hands it to the user (PRD 8.6).
  const rereads = new Map<string, number>();
  rt.on(ID, { types: ['hr.figure.contested'] }, (e: HrEvent) => {
    const p = e.payload as { key: string; reasonCode: string; detail: string; producerId?: string };
    if (p.producerId !== ID) return;
    const k = parseKey(p.key);
    if (k?.kind !== 'criterion' || !contractCriteria.some((c) => c.n === k.n)) return;
    const client = inputs.clients.find((c) => c.id === k.clientId);
    if (!client) return;
    const attempt = (rereads.get(p.key) ?? 0) + 1;
    if (attempt > MAX_REREADS) return;
    rereads.set(p.key, attempt);
    void readContract(client, {
      attempt,
      n: k.n,
      feedback: `${p.key} ${p.reasonCode} ${p.detail}`.trim(),
    });
  });

  rt.on(ID, { types: ['hr.run.started'] }, async () => {
    if (exempt) {
      for (const client of inputs.clients) {
        state.postFigure({
          key: keys.indepStatus(client.id),
          kind: 'indep_status',
          value: { t: 'text', text: 'not_applicable' },
          sources: [ruleSrc('R-INDEP-EXEMPT')],
          producedBy: ID,
          idempotencyKey: `${ID}/exempt/${client.id}`,
        });
      }
      setStatus(rt, ID, { kind: 'done', summary: 'Activity is exempt from the independence test' });
      return;
    }
    for (const client of inputs.clients) for (const c of questionCriteria) ask(client, c);
    for (const client of inputs.clients) updateStatus(client.id);
    await Promise.all(inputs.clients.map((c) => readContract(c)));
    setStatus(rt, ID, { kind: 'waiting_for', what: 'verified invoice amounts for criterion 6' });
  });

  rt.on(ID, { types: ['hr.figure.verified', 'hr.figure.superseded'] }, (e: HrEvent) => {
    const p = parseKey((e.payload as { key: string }).key);
    if (
      (p?.kind === 'invoice' && ['amountRSD', 'issueDate', 'client'].includes(p.field)) ||
      (p?.kind === 'draft' && p.field === 'amountRSD')
    ) {
      if (timer) clearTimeout(timer);
      state.debouncing.add(ID);
      timer = setTimeout(() => {
        try {
          computeShares();
        } finally {
          state.debouncing.delete(ID);
        }
      }, 150);
    }
    if (p?.kind === 'criterion') updateStatus(p.clientId);
  });

  rt.on(ID, { types: ['hr.question.answered'] }, (e: HrEvent) => {
    const { questionId, answer } = e.payload as { questionId: string; answer: string };
    const q = state.questions.get(questionId);
    if (!q || q.askedBy !== ID) return;
    const value: Tri = answer === 'Yes' ? 'met' : answer === 'No' ? 'not_met' : 'unknown';
    state.postFigure({
      key: q.subjectKey,
      kind: 'criterion',
      value: { t: 'tri', value },
      sources: [
        {
          type: 'user_answer',
          questionId,
          answeredAt: q.answeredAt ?? new Date(deps.now()).toISOString(),
          answer,
        },
        ruleSrc('R-INDEP'),
      ],
      producedBy: ID,
      idempotencyKey: `${ID}/${q.subjectKey}/answer/${answer}`,
    });
  });
}
