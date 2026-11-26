// The human participant (PRD 8.7): the draft invoice, answers to questions and what-if draft changes.
// Answers and draft fields become figures sourced to user_answer.
import { AGENTS, type AgentDeps } from './common.ts';
import { keys } from '../domain/keys.ts';
import type { Draft, FigureValue, SourceRef } from '../domain/types.ts';

const ID = AGENTS.human;

export interface HumanApi {
  answer(questionId: string, answer: string): { ok: true } | { ok: false; error: string };
  changeDraft(draft: Draft): void;
}

export function registerHuman(deps: AgentDeps): HumanApi {
  const { rt, inputs } = deps;
  const state = rt.state;
  let revision = 0;

  rt.join({ id: ID, name: 'You', kind: 'human' });

  function postDraft(): void {
    revision += 1;
    const d = inputs.draft;
    const answeredAt = new Date(deps.now()).toISOString();
    const src = (answer: string): SourceRef[] => [
      { type: 'user_answer', questionId: 'draft-form', answeredAt, answer },
    ];
    const post = (
      field: 'amount' | 'currency' | 'issueDate' | 'client',
      value: FigureValue,
      answer: string,
    ): void => {
      state.postFigure({
        key: keys.draft(field),
        kind: 'draft_field',
        value,
        sources: src(answer),
        producedBy: ID,
        idempotencyKey: `${ID}/draft/${field}/${revision}`,
        scope: 'draft',
      });
    };
    post('amount', { t: 'money', amount: d.amount, currency: d.currency }, `${d.amount} ${d.currency}`);
    post('currency', { t: 'text', text: d.currency }, d.currency);
    post('issueDate', { t: 'date', iso: d.issueDate }, d.issueDate);
    post('client', { t: 'text', text: d.clientId }, d.clientId);
  }

  rt.on(ID, { types: ['hr.run.started'] }, () => postDraft());

  return {
    answer(questionId, answer) {
      const q = state.questions.get(questionId);
      if (!q) return { ok: false, error: `No question ${questionId}` };
      // Questions with options take one of them; questions without options take free text (e.g. a rate).
      if (q.options.length > 0 && !q.options.includes(answer)) {
        return { ok: false, error: `Answer must be one of: ${q.options.join(', ')}` };
      }
      q.answer = answer;
      q.answeredAt = new Date(deps.now()).toISOString();
      rt.publish('hr.question.answered', ID, { questionId, answer, answeredAt: q.answeredAt });
      return { ok: true };
    },
    changeDraft(draft) {
      inputs.draft = draft;
      rt.publish('hr.draft.changed', ID, { draft });
      postDraft();
    },
  };
}
