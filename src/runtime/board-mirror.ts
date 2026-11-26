// The single board.onChange subscriber that turns claim changes into hr.figure.* events (PRD 9.3).
// Domain code never publishes figure events directly.
import type { ClaimEvent } from '@headroom/claims';
import type { HeadroomState } from './state.ts';

type Publish = (type: string, producerId: string, payload: unknown) => void;

export function installBoardMirror(state: HeadroomState, publish: Publish): () => void {
  return state.board.onChange((e: ClaimEvent) => {
    const figure = state.figures.get(e.recordId);
    const snapshot = figure ? structuredClone(figure) : undefined;
    switch (e.type) {
      case 'claimed':
        publish('hr.figure.proposed', e.by, { figure: snapshot, result: 'claimed' });
        return;
      case 'conflict':
        publish('hr.figure.proposed', e.by, { figure: snapshot, result: 'conflict' });
        publish('hr.figure.conflict', e.by, { key: e.key, existingId: e.relatedId, proposedId: e.recordId });
        return;
      case 'corroborated': {
        const list = state.corroborations.get(e.recordId) ?? [];
        publish('hr.figure.corroborated', e.by, {
          key: e.key,
          figureId: e.recordId,
          by: e.by,
          sources: list.find((c) => c.by === e.by)?.sources ?? [],
        });
        return;
      }
      case 'superseded':
        publish('hr.figure.superseded', e.by, {
          key: e.key,
          oldId: e.recordId,
          newId: e.relatedId,
          reason: e.reason,
        });
        return;
      case 'status':
        if (e.status === 'verified') {
          publish('hr.figure.verified', e.by, {
            key: e.key,
            figureId: e.recordId,
            checks: snapshot?.checks ?? [],
            figure: snapshot,
          });
        } else if (e.status === 'contested') {
          const [reasonCode = 'IMPLAUSIBLE', ...detail] = (e.reason ?? '').split(': ');
          publish('hr.figure.contested', e.by, {
            key: e.key,
            figureId: e.recordId,
            reasonCode,
            detail: detail.join(': '),
            producerId: snapshot?.producedBy,
          });
        } else if (e.status === 'needs_user') {
          publish('hr.figure.needs_user', e.by, { key: e.key, figureId: e.recordId, reason: e.reason });
        } else if (e.status === 'superseded') {
          // A status change to superseded (conflict lost, or the user chose another value) is announced like a
          // replacement, so every view of the board drops the figure (found by the web reducer test).
          publish('hr.figure.superseded', e.by, {
            key: e.key,
            oldId: e.recordId,
            ...(e.reason !== undefined ? { reason: e.reason } : {}),
          });
        }
        return;
    }
  });
}
