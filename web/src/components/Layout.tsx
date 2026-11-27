import { Link, NavLink, Outlet } from 'react-router';
import { useApp, useAppBoot } from '../state/app.ts';

const DISCLAIMER =
  'Synthetic data only. Not financial or tax advice. Headroom shows calculations from the documents you give it, with their sources. Rules marked as assumptions are not confirmed. Check with an accountant or the Tax Administration before you act.';

export function Layout() {
  useAppBoot();
  const health = useApp((s) => s.health);
  const error = useApp((s) => s.error);
  const nav = ({ isActive }: { isActive: boolean }) =>
    `hover:text-text ${isActive ? 'text-text' : 'text-muted'}`;
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Headroom
          </Link>
          <nav
            className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:gap-x-5"
            aria-label="Main"
          >
            <NavLink to="/#how" className={() => 'hidden text-muted hover:text-text sm:inline'}>
              How it works
            </NavLink>
            <NavLink to="/evidence" className={nav}>
              Evidence
            </NavLink>
            <NavLink to="/about" className={nav}>
              About
            </NavLink>
            <Link
              to="/check"
              className="rounded bg-accent px-3 py-1.5 font-medium text-ink hover:bg-accent/90"
            >
              Check my invoice
            </Link>
          </nav>
        </div>
      </header>
      {health?.publicDemo && (
        <div role="note" className="border-b border-amber/40 bg-amber/10 px-4 py-2 text-sm">
          <span className="font-medium">Public sample instance.</span> Recorded runs of the synthetic samples
          only: no model key on this server, and file uploads are off. To check your own files, run Headroom
          on your computer (see the README).
        </div>
      )}
      {error && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line text-xs text-muted">
        <div className="mx-auto max-w-[1440px] space-y-2 px-4 py-6">
          <p>{DISCLAIMER}</p>
          <p>{health?.authorityBoundary}</p>
          <p className="flex flex-wrap gap-4">
            <Link to="/about" className="hover:text-text">
              About
            </Link>
            <Link to="/evidence" className="hover:text-text">
              Evidence
            </Link>
            <span>MIT licence</span>
            {health && (
              <span>
                Mozaik {health.mozaikVersion} · Headroom {health.version}
              </span>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
