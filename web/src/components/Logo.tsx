// The Headroom mark: turnover bars rising toward a limit line, with the gap between them, the headroom,
// left open. The same drawing is the favicon (public/favicon.svg).
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <rect width="64" height="64" rx="14" className="fill-panel-2" />
      <rect x="2" y="2" width="60" height="60" rx="12" fill="none" className="stroke-line" strokeWidth="2" />
      <rect x="14" y="14" width="36" height="4" rx="2" className="fill-signal" />
      <rect x="18" y="30" width="8" height="20" rx="2" className="fill-text" opacity="0.55" />
      <rect x="28" y="26" width="8" height="24" rx="2" className="fill-text" opacity="0.8" />
      <rect x="38" y="22" width="8" height="28" rx="2" className="fill-text" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-serif text-[1.35rem] leading-none tracking-tight">Headroom</span>
    </span>
  );
}
