// SSE hub per run (PRD 14.2): events get sequence numbers; the last 5,000 stay in a ring buffer so a
// reconnecting client resumes from Last-Event-ID, or is told to re-fetch the snapshot if it fell behind.
import type { ServerResponse } from 'node:http';
import { serializeEvent } from '../engine/serialize.ts';
import type { HrEvent } from '../runtime/types.ts';

const RING = 5000;
const HEARTBEAT_MS = 15_000;

export class SseHub {
  private seq = 0;
  private readonly ring: Array<{ id: number; data: string }> = [];
  private readonly clients = new Set<ServerResponse>();
  private closed = false;

  push(e: HrEvent): void {
    const entry = { id: ++this.seq, data: serializeEvent(e) };
    this.ring.push(entry);
    if (this.ring.length > RING) this.ring.shift();
    for (const c of this.clients) write(c, entry);
  }

  get lastId(): number {
    return this.seq;
  }

  attach(res: ServerResponse, lastEventId: number | undefined): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const oldest = this.ring[0]?.id ?? this.seq + 1;
    if (lastEventId !== undefined && lastEventId < oldest - 1) {
      // The client missed events no longer buffered: it must re-fetch the snapshot.
      res.write(`event: gap\ndata: {"lastId":${this.seq}}\n\n`);
    }
    const from = lastEventId ?? 0;
    for (const entry of this.ring) if (entry.id > from) write(res, entry);
    if (this.closed) {
      res.end();
      return;
    }
    this.clients.add(res);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(beat);
      this.clients.delete(res);
    });
  }

  close(): void {
    this.closed = true;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}

function write(res: ServerResponse, entry: { id: number; data: string }): void {
  res.write(`event: hr\nid: ${entry.id}\ndata: ${entry.data}\n\n`);
}
