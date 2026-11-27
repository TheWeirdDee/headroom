// One queue per participant. Mozaik calls a situation processor synchronously and does not await it, so a
// participant's asynchronous reactions would interleave and their errors would be unhandled. A processor
// therefore puts its reaction here: a participant's reactions run one at a time, in arrival order, and a
// thrown error is reported while the queue carries on.
import type { HrEvent, HrHandler } from './types.ts';

export interface InboxError {
  participantId: string;
  event: HrEvent;
  error: unknown;
}

export class Inbox {
  private readonly queue: Array<{ event: HrEvent; handler: HrHandler }> = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    readonly participantId: string,
    private readonly onError: (e: InboxError) => void,
  ) {}

  /** Called synchronously while Mozaik delivers an event. Never throws, never blocks the publisher. */
  push(event: HrEvent, handler: HrHandler): void {
    this.queue.push({ event, handler });
    if (!this.running) {
      this.running = true;
      queueMicrotask(() => void this.drain());
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  get busy(): boolean {
    return this.running;
  }

  /** Resolves when the queue is empty and no reaction is running. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    for (let item = this.queue.shift(); item; item = this.queue.shift()) {
      try {
        await item.handler(item.event);
      } catch (error) {
        try {
          this.onError({ participantId: this.participantId, event: item.event, error });
        } catch {
          // The error reporter itself failed; nothing else can be done without losing the queue.
        }
      }
    }
    this.running = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}
