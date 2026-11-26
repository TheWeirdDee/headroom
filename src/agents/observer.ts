// Transcript observer (PRD 8.8): receives every event, forwards a serialised copy to its sinks (SSE hub,
// recorder, in-memory log). It never writes to the board.
import { AGENTS } from './common.ts';
import type { HrEvent, HrRuntime } from '../runtime/types.ts';

export type EventSink = (e: HrEvent) => void;

export function registerObserver(rt: HrRuntime, sinks: EventSink[]): void {
  rt.join({ id: AGENTS.observer, name: 'Transcript', kind: 'observer' });
  rt.on(AGENTS.observer, { includeLifecycle: true }, (e) => {
    for (const sink of sinks) sink(e);
  });
}
