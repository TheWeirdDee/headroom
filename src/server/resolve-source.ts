// Source drawer content (PRD 15.3): every source of a figure resolved to what the user should see.
import type { Figure, SourceRef } from '../domain/types.ts';
import type { RunInputs } from '../engine/inputs.ts';
import type { RuleBook } from '../domain/rules/engine.ts';
import type { KursClient } from '../integrations/kurs/client.ts';
import type { HeadroomState } from '../runtime/state.ts';

export type ResolvedSource =
  | {
      type: 'document';
      source: SourceRef;
      fileName: string;
      page: number;
      lines: Array<{ n: number; text: string; cited: boolean }>;
    }
  | { type: 'statement_row' | 'kpo_row'; source: SourceRef; header: string[]; rawLine: string }
  | {
      type: 'url';
      source: SourceRef;
      url: string;
      fetchedAt: string;
      httpStatus: number;
      body: string;
      value: string | undefined;
    }
  | {
      type: 'rule';
      source: SourceRef;
      ruleId: string;
      title: string;
      status: string;
      statementSr: string;
      statementEn: string;
      links: Array<{ url: string; title: string; locator?: string; quote?: string }>;
    }
  | { type: 'user_answer'; source: SourceRef; question: string; answer: string; answeredAt: string }
  | { type: 'contract_field'; source: SourceRef; clientName: string; field: string; value: string }
  | {
      type: 'derived';
      source: SourceRef;
      inputs: Array<{ id: string; key: string; value: Figure['value']; status: string }>;
    }
  | { type: 'missing'; source: SourceRef; reason: string };

export interface ResolveContext {
  state: HeadroomState;
  inputs: RunInputs;
  rules: RuleBook;
  kurs: KursClient;
}

export function resolveSource(s: SourceRef, ctx: ResolveContext): ResolvedSource {
  switch (s.type) {
    case 'document': {
      const doc = ctx.inputs.documents.find((d) => d.docId === s.docId);
      if (!doc || doc.kind !== 'readable')
        return { type: 'missing', source: s, reason: 'document not available' };
      const lines = (doc.pages[s.page - 1] ?? '').split('\n');
      const from = Math.max(1, s.lineStart - 3);
      const to = Math.min(lines.length, s.lineEnd + 3);
      const shown: Array<{ n: number; text: string; cited: boolean }> = [];
      for (let n = from; n <= to; n++)
        shown.push({ n, text: lines[n - 1] ?? '', cited: n >= s.lineStart && n <= s.lineEnd });
      return { type: 'document', source: s, fileName: doc.fileName, page: s.page, lines: shown };
    }
    case 'statement_row':
    case 'kpo_row':
      return { type: s.type, source: s, header: [], rawLine: s.rawLine };
    case 'url': {
      const r = ctx.kurs.response(s.responseSha256);
      if (!r) return { type: 'missing', source: s, reason: 'response not recorded' };
      let pretty = r.body;
      try {
        pretty = JSON.stringify(JSON.parse(r.body), null, 2);
      } catch {
        // keep the raw body
      }
      const m = /"exchange_middle"\s*:\s*(-?\d+(?:\.\d+)?)/.exec(r.body);
      return {
        type: 'url',
        source: s,
        url: r.url,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        body: pretty,
        value: m?.[1],
      };
    }
    case 'rule': {
      if (!ctx.rules.has(s.ruleId)) return { type: 'missing', source: s, reason: 'unknown rule' };
      const rule = ctx.rules.get(s.ruleId);
      return {
        type: 'rule',
        source: s,
        ruleId: rule.id,
        title: rule.title,
        status: rule.status,
        statementSr: rule.statement_sr,
        statementEn: rule.statement_en,
        links: rule.sources.map((x) => ({
          url: x.url,
          title: x.title,
          ...(x.locator ? { locator: x.locator } : {}),
          ...(x.quote ? { quote: x.quote } : {}),
        })),
      };
    }
    case 'user_answer': {
      const q = s.questionId === 'draft-form' ? undefined : ctx.state.questions.get(s.questionId);
      return {
        type: 'user_answer',
        source: s,
        question: q?.text ?? 'The draft invoice you entered',
        answer: s.answer,
        answeredAt: s.answeredAt,
      };
    }
    case 'contract_field': {
      const client = ctx.inputs.clients.find((c) => c.id === s.clientId);
      return {
        type: 'contract_field',
        source: s,
        clientName: client?.name ?? s.clientId,
        field: s.field,
        value: s.value,
      };
    }
    case 'derived':
      return {
        type: 'derived',
        source: s,
        inputs: s.figureIds.map((id) => {
          const f = ctx.state.figures.get(id);
          return f
            ? { id, key: f.key, value: f.value, status: f.status }
            : { id, key: '(missing)', value: { t: 'text', text: '' }, status: 'missing' };
        }),
      };
  }
}

/** Header row of the CSV a statement_row / kpo_row came from, for the drawer. */
export function withHeaders(r: ResolvedSource, headers: Map<string, string[]>): ResolvedSource {
  if (
    (r.type === 'statement_row' || r.type === 'kpo_row') &&
    (r.source.type === 'statement_row' || r.source.type === 'kpo_row')
  ) {
    return { ...r, header: headers.get(r.source.file) ?? [] };
  }
  return r;
}
