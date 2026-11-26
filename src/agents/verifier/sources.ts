// Verifier steps 1 and 2 (PRD 8.6): every source resolves against the run's inputs, and its integrity
// hash recomputes. Code only.
import { sha256 } from '../../util/hash.ts';
import type { Figure, SourceRef } from '../../domain/types.ts';
import type { RunInputs } from '../../engine/inputs.ts';
import type { RuleBook } from '../../domain/rules/engine.ts';
import type { KursClient } from '../../integrations/kurs/client.ts';
import type { HeadroomState } from '../../runtime/state.ts';

export interface SourceContext {
  inputs: RunInputs;
  rules: RuleBook;
  kurs: KursClient;
  state: HeadroomState;
}

export type SourceCheck = { ok: true } | { ok: false; code: 'UNSOURCED' | 'SOURCE_MISMATCH'; detail: string };

export function checkSource(s: SourceRef, ctx: SourceContext): SourceCheck {
  const missing = (detail: string): SourceCheck => ({ ok: false, code: 'UNSOURCED', detail });
  const mismatch = (detail: string): SourceCheck => ({ ok: false, code: 'SOURCE_MISMATCH', detail });
  switch (s.type) {
    case 'document': {
      const doc = ctx.inputs.documents.find((d) => d.docId === s.docId);
      if (!doc) return missing(`document ${s.docId} is not in this run`);
      if (doc.kind !== 'readable') return missing(`document ${s.docId} has no readable text`);
      const page = doc.pages[s.page - 1];
      if (page === undefined) return missing(`document ${s.docId} has no page ${s.page}`);
      if (sha256(s.excerpt) !== s.excerptSha256)
        return mismatch(`excerpt hash does not match its text in ${s.docId}`);
      if (!page.includes(s.excerpt)) return mismatch(`excerpt is not in ${s.docId} page ${s.page}`);
      return { ok: true };
    }
    case 'statement_row': {
      const st = ctx.inputs.statements.find((x) => x.file === s.file);
      const row = st?.rows.find((r) => r.rowIndex === s.rowIndex);
      if (!row) return missing(`${s.file} has no row ${s.rowIndex}`);
      if (row.rawLine !== s.rawLine || sha256(row.rawLine) !== s.rawLineSha256)
        return mismatch(`${s.file} row ${s.rowIndex} differs from the cited line`);
      return { ok: true };
    }
    case 'kpo_row': {
      const row =
        ctx.inputs.kpo?.file === s.file
          ? ctx.inputs.kpo.rows.find((r) => r.rowIndex === s.rowIndex)
          : undefined;
      if (!row) return missing(`${s.file} has no KPO row ${s.rowIndex}`);
      if (row.rawLine !== s.rawLine || sha256(row.rawLine) !== s.rawLineSha256)
        return mismatch(`KPO row ${s.rowIndex} differs from the cited line`);
      return { ok: true };
    }
    case 'url': {
      const r = ctx.kurs.response(s.responseSha256);
      if (!r) return missing(`no recorded response for ${s.url}`);
      if (r.url !== s.url || r.httpStatus !== s.httpStatus)
        return mismatch(`recorded response does not match ${s.url}`);
      if (sha256(r.body) !== s.responseSha256) return mismatch(`response body hash differs for ${s.url}`);
      return { ok: true };
    }
    case 'contract_field': {
      const client = ctx.inputs.clients.find((c) => c.id === s.clientId);
      if (!client) return missing(`client ${s.clientId} is not in clients.json`);
      const actual = s.field === 'country' ? client.country : (client.contract?.[s.field] ?? '');
      if (actual !== s.value)
        return mismatch(`clients.json ${s.clientId}.${s.field} differs from the cited value`);
      return { ok: true };
    }
    case 'user_answer': {
      if (s.questionId === 'draft-form') return { ok: true };
      const q = ctx.state.questions.get(s.questionId);
      if (!q) return missing(`question ${s.questionId} does not exist`);
      if (q.answer !== s.answer) return mismatch(`question ${s.questionId} was answered differently`);
      return { ok: true };
    }
    case 'rule': {
      if (!ctx.rules.has(s.ruleId)) return missing(`rule ${s.ruleId} does not exist`);
      if (!ctx.rules.get(s.ruleId).sources.some((x) => x.url === s.url))
        return mismatch(`rule ${s.ruleId} does not cite ${s.url}`);
      return { ok: true };
    }
    case 'derived': {
      const gone = s.figureIds.filter((id) => !ctx.state.figures.has(id));
      if (gone.length > 0) return missing(`input figures ${gone.join(', ')} do not exist`);
      return { ok: true };
    }
  }
}

export function checkSources(f: Figure, ctx: SourceContext): SourceCheck {
  if (f.sources.length === 0) return { ok: false, code: 'UNSOURCED', detail: 'no sources' };
  for (const s of f.sources) {
    const r = checkSource(s, ctx);
    if (!r.ok) return r;
  }
  return { ok: true };
}
