import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Menu, ShieldCheck, X } from 'lucide-react';
import { useApp, useAppBoot } from '../state/app.ts';
import { useHashScroll } from '../state/useHashScroll.ts';

const DISCLAIMER =
  'Synthetic data only. Not financial or tax advice. Headroom shows calculations from the documents you give it, with their sources. Rules marked as assumptions are not confirmed. Check with an accountant or the Tax Administration before you act.';

export const REPO_URL = 'https://github.com/TheWeirdDee/headroom';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/#how', label: 'How it works' },
  { to: '/#agents', label: 'Agents' },
  { to: '/#proof', label: 'Proof' },
  { to: '/#faq', label: 'FAQ' },
  { to: '/docs', label: 'Docs' },
  { to: '/evidence', label: 'Evidence' },
];

function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  const { pathname, hash } = useLocation();
  const [path, h] = to.split('#');
  const active = h ? pathname === path && hash === `#${h}` : pathname.startsWith(to);
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded px-2 py-1 transition-colors hover:text-text ${active ? 'text-text' : 'text-muted'}`}
    >
      {label}
    </Link>
  );
}

export function Layout() {
  useAppBoot();
  useHashScroll();
  const health = useApp((s) => s.health);
  const error = useApp((s) => s.error);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const on = (): void => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header
        className={`sticky top-0 z-30 border-b transition-colors ${
          scrolled || open ? 'border-line bg-ink/90 backdrop-blur' : 'border-transparent bg-ink'
        }`}
      >
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-md border border-accent/40 bg-accent/10 text-accent"
            >
              <ShieldCheck size={16} />
            </span>
            Headroom
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <Link
            to="/check"
            className="ml-auto hidden rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-strong sm:inline-flex lg:ml-2"
          >
            Check my invoice
          </Link>
          <button
            type="button"
            className="ml-auto rounded-md border border-line p-2 text-muted hover:text-text sm:ml-0 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line px-4 pt-2 pb-4 lg:hidden">
            <div className="mx-auto flex max-w-[1200px] flex-col gap-1 text-sm">
              {NAV.map((n) => (
                <NavItem key={n.to} {...n} onClick={() => setOpen(false)} />
              ))}
              <Link
                to="/check"
                className="mt-2 rounded-md bg-accent px-3 py-2 text-center font-medium text-ink sm:hidden"
              >
                Check my invoice
              </Link>
            </div>
          </nav>
        )}
      </header>
      {health?.publicDemo && (
        <div role="note" className="border-b border-amber/40 bg-amber/10 px-4 py-2 text-sm">
          <div className="mx-auto max-w-[1200px]">
            <span className="font-medium">Public sample instance.</span> Recorded runs of the synthetic
            samples only: no model key on this server, and file uploads are off. To check your own files, run
            Headroom on your computer (see the{' '}
            <Link to="/docs#quick-start" className="underline">
              docs
            </Link>
            ).
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          <div className="mx-auto max-w-[1200px]">{error}</div>
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-panel/40 text-sm">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={16} className="text-accent" aria-hidden /> Headroom
            </p>
            <p className="max-w-sm text-muted">
              Room left under the 6M paušal limit before you send an invoice, with the source of every number.
            </p>
            <p className="text-xs text-muted">{health?.authorityBoundary}</p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { to: '/check', label: 'Check my invoice' },
              { to: '/#how', label: 'How it works' },
              { to: '/#agents', label: 'The seven agents' },
              { to: '/#faq', label: 'FAQ' },
            ]}
          />
          <FooterColumn
            title="Resources"
            links={[
              { to: '/docs', label: 'Docs' },
              { to: '/evidence', label: 'Evaluation results' },
              { to: '/about', label: 'Rules and sources' },
              { href: REPO_URL, label: 'Source code (GitHub)' },
            ]}
          />
          <div>
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Built with</h2>
            <ul className="space-y-2 text-muted">
              {health && <li>Mozaik {health.mozaikVersion}</li>}
              {health && <li>Model: {health.models.reader}</li>}
              <li>NBS rates via the Kurs API</li>
              <li>MIT licence</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-[1200px] px-4 py-5 text-xs text-muted">
            {DISCLAIMER} {health && <span>Headroom {health.version}.</span>}
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ label: string; to?: string; href?: string }>;
}) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.href ? (
              <a href={l.href} target="_blank" rel="noreferrer" className="hover:text-accent">
                {l.label}
              </a>
            ) : (
              <Link to={l.to ?? '/'} className="hover:text-accent">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
