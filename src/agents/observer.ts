// The transcript: a Mozaik participant that reacts to every event and forwards a serialised copy to its
// sinks (SSE stream, recorder, in-memory log). It never writes to the board.
import { createHuman } from '@mozaik-ai/core';
import { AGENTS } from './common.ts';
import { AnyEvent } from './situations.ts';
import type { HeadroomRuntime } from '../runtime/mozaik/runtime.ts';
import type { HrEvent } from '../runtime/types.ts';

export type EventSink = (e: HrEvent) => void;

export function registerObserver(rt: HeadroomRuntime, sinks: EventSink[]): void {
  rt.join(
    createHuman({
      name: AGENTS.observer,
      capabilities: ['transcript'],
      handlers: [
        rt.when(new AnyEvent(), (e) => {
          for (const sink of sinks) sink(e);
        }),
      ],
    }),
  );
}
