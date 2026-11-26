// The band on every app screen (PRD 15.1): disclaimer, data label, mode, and the Verifier's rejections.
import { ShieldCheck } from 'lucide-react';
import { useApp } from '../state/app.ts';

export function TopBand({
  data,
  mode,
  recordedAt,
  rejected,
}: {
  data?: 'sample' | 'user';
  mode?: 'live' | 'replay';
  recordedAt?: string;
  rejected?: number;
}) {
  const health = useApp((s) => s.health);
  const offline = mode === 'replay' || health?.mode === 'offline';
  return (
    <div
      className="border-b border-line bg-panel text-xs text-muted"
      role="note"
      aria-label="Status of this run"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <span className="font-medium text-text">Not financial or tax advice</span>
        {data && (
          <span>Data: {data === 'sample' ? 'SAMPLE (SYNTHETIC)' : 'YOUR FILES (processed locally)'}</span>
        )}
        <span>
          Mode:{' '}
          {offline ? `OFFLINE${recordedAt ? ` (recorded run, ${recordedAt.slice(0, 10)})` : ''}` : 'LIVE'}
          {health?.models && !offline ? ` (${health.models.reader})` : ''}
        </span>
        {rejected !== undefined && (
          <span className="inline-flex items-center gap-1">
            <ShieldCheck size={12} aria-hidden /> Rejected by Verifier:{' '}
            <span className="num text-text">{rejected}</span>
          </span>
        )}
      </div>
    </div>
  );
}
