// Writes test/fixtures/web/{events.jsonl,snapshot.json} from a run on the e2e server (fake model), for the
// reducer test. Usage: start test/e2e/server.ts, then npx tsx test/e2e/dump-events.ts [profileId].
import { writeFileSync } from 'node:fs';

const base = `http://127.0.0.1:${process.env['E2E_PORT'] ?? '4318'}`;
const profileId = process.argv[2] ?? 'p07';
const start = await fetch(`${base}/api/runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ profileId, mode: 'live' }),
});
const { runId } = (await start.json()) as { runId: string };
const ctl = new AbortController();
const res = await fetch(`${base}/api/runs/${runId}/stream`, { signal: ctl.signal });
const lines: string[] = [];
let buf = '';
const dec = new TextDecoder();
const reader = res.body?.getReader();
if (!reader) throw new Error('no stream');
outer: for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i: number;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const id = /^id: (\d+)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (!id || !data) continue;
    lines.push(JSON.stringify({ id: Number.parseInt(id, 10), event: JSON.parse(data) as unknown }));
    if ((JSON.parse(data) as { type: string }).type === 'hr.run.completed') break outer;
  }
}
ctl.abort();
const snap = (await (await fetch(`${base}/api/runs/${runId}`)).json()) as unknown;
writeFileSync('test/fixtures/web/events.jsonl', `${lines.join('\n')}\n`);
writeFileSync('test/fixtures/web/snapshot.json', `${JSON.stringify(snap)}\n`);
process.stdout.write(`${lines.length} events from ${runId}\n`);
