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
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Headroom
          </Link>
          <nav className="ml-auto flex items-center gap-5 text-sm" aria-label="Main">
            <NavLink to="/#how" className={() => 'text-muted hover:text-text'}>
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
