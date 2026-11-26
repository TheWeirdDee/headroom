// Discrepancies are figures (key discrepancy:<type>:<subject>) so the Verifier checks their sources like
// any other figure; the Discrepancy record carries the title, detail and the effect on the 6M total.
import { DISCREPANCY_INFO } from '../domain/discrepancies.ts';
import { keys } from '../domain/keys.ts';
import type {
  Currency,
  DecimalString,
  Discrepancy,
  DiscrepancyType,
  IsoDate,
  SourceRef,
} from '../domain/types.ts';
import type { AgentDeps } from './common.ts';

export interface DiscrepancyInput {
  type: DiscrepancyType;
  subjectKey: string;
  producedBy: string;
  detail: string;
  sources: SourceRef[];
  figureIds: string[];
  deltaRSD?: DecimalString;
  baseline?: 'book' | 'corrected';
  payment?: { currency: Currency; amount: DecimalString; date: IsoDate };
}

export function postDiscrepancy(deps: AgentDeps, d: DiscrepancyInput): Discrepancy | undefined {
  const key = keys.discrepancy(d.type, d.subjectKey);
  const title = DISCREPANCY_INFO[d.type].title;
  const { figure, result } = deps.rt.state.postFigure({
    key,
    kind: 'discrepancy',
    value: { t: 'text', text: `${title}. ${d.detail}` },
    sources: d.sources,
    producedBy: d.producedBy,
    idempotencyKey: `${d.producedBy}/${key}`,
  });
  if (result.kind === 'duplicate' || result.kind === 'corroborated')
    return deps.rt.state.discrepancies.get(figure.id);
  const rec: Discrepancy = {
    id: figure.id,
    type: d.type,
    title,
    detail: d.detail,
    figureIds: d.figureIds,
    sources: d.sources,
    status: figure.status,
    subjectKey: d.subjectKey,
    producedBy: d.producedBy,
    ...(d.deltaRSD !== undefined ? { deltaRSD: d.deltaRSD } : {}),
    baseline: d.baseline ?? (d.type === 'E1' ? 'corrected' : 'book'),
    ...(d.payment ? { payment: d.payment } : {}),
  };
  deps.rt.state.discrepancies.set(figure.id, rec);
  return rec;
}
