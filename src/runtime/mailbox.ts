// Per-participant ordered mailbox (workaround for Mozaik gap #4: processors are called synchronously and
// never awaited, so async handlers interleave and their errors become unhandled rejections).
// Each participant's handlers run one at a time, in arrival order, awaited. A thrown error is reported
// through `onError` (the runtime publishes hr.participant.error) and the mailbox keeps going.
import type { EventFilter, HrEvent, HrHandler } from './types.ts';

const LIFECYCLE = new Set(['participant.joined', 'participant.left']);

export function matches(filter: EventFilter, e: HrEvent): boolean {
  if (LIFECYCLE.has(e.type) && !filter.includeLifecycle) return false;
  if (filter.producerId !== undefined && e.producerId !== filter.producerId) return false;
  if (filter.notProducerId !== undefined && e.producerId === filter.notProducerId) return false;
  if (filter.types) {
    return filter.types.some((t) => (t.endsWith('*') ? e.type.startsWith(t.slice(0, -1)) : e.type === t));
  }
  return true;
}

export interface MailboxError {
  participantId: string;
  event: HrEvent;
  error: unknown;
}

export class Mailbox {
  private readonly handlers: Array<{ filter: EventFilter; handler: HrHandler }> = [];
  private readonly queue: Array<{ event: HrEvent; handler: HrHandler }> = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    readonly participantId: string,
    private readonly onError: (e: MailboxError) => void,
  ) {}

  subscribe(filter: EventFilter, handler: HrHandler): void {
    this.handlers.push({ filter, handler });
  }

  /** Called synchronously by the event bus. Never throws, never blocks the publisher. */
  deliver(event: HrEvent): void {
    for (const h of this.handlers) {
      if (matches(h.filter, event)) this.queue.push({ event, handler: h.handler });
    }
    if (!this.running && this.queue.length > 0) {
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

  /** Resolves when the queue is empty and no handler is running. */
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
