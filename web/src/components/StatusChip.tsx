// Status is never colour alone: every chip has a text label and an icon.
import {
  CircleCheck,
  CircleDashed,
  CircleAlert,
  CircleHelp,
  CircleSlash,
  Loader,
  TriangleAlert,
  Ban,
  Info,
} from 'lucide-react';
import type { ComponentType } from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

const TONE: Record<Tone, string> = {
  ok: 'text-accent border-accent/40 bg-accent/10',
  warn: 'text-amber border-amber/40 bg-amber/10',
  bad: 'text-danger border-danger/40 bg-danger/10',
  muted: 'text-muted border-line bg-panel-2',
  info: 'text-text border-line bg-panel-2',
};

const STATUS: Record<
  string,
  { label: string; tone: Tone; Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }
> = {
  proposed: { label: 'Proposed', tone: 'muted', Icon: CircleDashed },
  verified: { label: 'Verified', tone: 'ok', Icon: CircleCheck },
  contested: { label: 'Contested', tone: 'bad', Icon: CircleAlert },
  superseded: { label: 'Superseded', tone: 'muted', Icon: CircleSlash },
  needs_user: { label: 'Needs you', tone: 'warn', Icon: CircleHelp },
  working: { label: 'Working', tone: 'info', Icon: Loader },
  waiting: { label: 'Waiting', tone: 'warn', Icon: CircleHelp },
  idle: { label: 'Idle', tone: 'muted', Icon: CircleCheck },
  error: { label: 'Error', tone: 'bad', Icon: TriangleAlert },
  assumption: { label: 'Assumption', tone: 'warn', Icon: Info },
  product: { label: 'Convention', tone: 'muted', Icon: Info },
  rule_verified: { label: 'Sourced', tone: 'ok', Icon: CircleCheck },
  failed: { label: 'Failed', tone: 'bad', Icon: Ban },
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'muted' as Tone, Icon: Info };
  const { Icon } = s;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[s.tone]}`}
    >
      <Icon size={12} aria-hidden />
      {label ?? s.label}
    </span>
  );
}
