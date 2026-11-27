// The band on every app screen: disclaimer, data label, mode (with the recording's date and
// models for a replay), and the Verifier's rejections.
import { ShieldCheck } from 'lucide-react';
import { useApp } from '../state/app.ts';
import { formatDateSr } from '../format/money.ts';

interface Recording {
  recordedAt: string;
  models: { reader: string; verifier: string };
}

export function TopBand({
  data,
  mode,
  recording,
  rejected,
  fault,
}: {
  data?: 'sample' | 'user';
  mode?: 'live' | 'replay';
  recording?: Recording | null;
  rejected?: number;
  fault?: string;
}) {
  const health = useApp((s) => s.health);
  const offline = mode === 'replay' || (mode === undefined && health?.mode === 'offline');
  const modeText = offline
    ? recording
      ? `OFFLINE (recorded run, ${formatDateSr(recording.recordedAt.slice(0, 10))}, ${recording.models.reader})`
      : 'OFFLINE'
    : `LIVE${health?.models ? ` (${health.models.reader})` : ''}`;
  return (
    <div
      className="border-b border-line bg-panel text-xs text-muted"
      role="note"
      aria-label="Status of this run"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <span className="font-medium text-text">Not financial or tax advice</span>
        {data && (
          <span>
            Data:{' '}
            {data === 'sample'
              ? 'SAMPLE (SYNTHETIC)'
              : 'YOUR FILES (kept on this computer; their text goes to the model)'}
          </span>
        )}
        <span>Mode: {modeText}</span>
        {fault && <span className="font-medium text-danger">{fault}</span>}
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
