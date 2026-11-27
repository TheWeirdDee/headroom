// The Headroom mark: an H standing under a limit line, with the gap between them, the headroom, left open.
// The same drawing is the favicon (public/favicon.svg).
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <rect width="64" height="64" rx="12" className="fill-text" />
      <rect x="12" y="11" width="40" height="5" rx="1" className="fill-signal" />
      <rect x="16" y="24" width="9" height="29" rx="1" className="fill-ink" />
      <rect x="39" y="24" width="9" height="29" rx="1" className="fill-ink" />
      <rect x="25" y="35" width="14" height="7" className="fill-ink" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Headroom</span>
    </span>
  );
}
