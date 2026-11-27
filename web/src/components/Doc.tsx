// Building blocks of the long pages (Proof, Agents, Docs, Evidence): one header, a sticky section list,
// sections, tables and code, so every page reads the same way and fits any width.
import { Link, useLocation } from 'react-router';
import type { ReactNode } from 'react';

export function PageHeader({
  kicker,
  title,
  children,
  aside,
}: {
  kicker: string;
  title: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        className="grid-lines pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
        aria-hidden
      />
      <div
        className={`relative mx-auto grid max-w-[1200px] items-end gap-8 px-4 py-10 md:py-14 ${aside ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]' : ''}`}
      >
        <div>
          <p className="font-mono text-xs tracking-wide text-signal uppercase">{kicker}</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] tracking-tight md:text-5xl">{title}</h1>
          <div className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{children}</div>
        </div>
        {aside && <div>{aside}</div>}
      </div>
    </header>
  );
}

/** The page body: a section list beside the sections on wide screens, above them (scrollable) on narrow. */
export function WithSideNav({
  items,
  children,
}: {
  items: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  const { pathname, hash } = useLocation();
  return (
    <div className="mx-auto grid max-w-[1200px] gap-x-12 px-4 py-8 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        <nav aria-label="On this page">
          <ul className="flex gap-2 overflow-x-auto pb-3 text-sm lg:block lg:space-y-1 lg:pb-0">
            {items.map((t) => (
              <li key={t.id} className="shrink-0">
                <Link
                  to={`${pathname}#${t.id}`}
                  className={`block rounded border px-3 py-1 whitespace-nowrap transition-colors hover:text-text lg:border-0 lg:px-2 lg:whitespace-normal ${
                    hash === `#${t.id}` ? 'border-muted bg-panel text-text' : 'border-line text-muted'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0 space-y-12">{children}</div>
    </div>
  );
}

export function Block({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <h2 id={`${id}-h`} className="text-2xl tracking-tight md:text-3xl">
        {title}
      </h2>
      {lead && <p className="mt-3 max-w-3xl leading-relaxed text-muted">{lead}</p>}
      <div className="mt-5 space-y-4 leading-relaxed text-muted [&_strong]:text-text">{children}</div>
    </section>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-line bg-panel p-4 font-mono text-[13px] leading-relaxed text-text">
      <code>{children}</code>
    </pre>
  );
}

export function Table({
  head,
  rows,
  caption,
  min = 560,
}: {
  head: string[];
  rows: ReactNode[][];
  caption?: string;
  /** Width below which the table scrolls sideways inside its frame instead of squeezing. */
  min?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-sm" style={{ minWidth: min }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-panel font-mono text-[11px] tracking-wide text-muted uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'text-text' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stats({ items }: { items: Array<{ value: ReactNode; label: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col bg-ink p-5">
          <dt className="order-2 mt-2 text-sm text-muted">{i.label}</dt>
          <dd className="num order-1 text-3xl font-medium tracking-tight text-text">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Cards({
  items,
  cols = 3,
}: {
  items: Array<{ title: ReactNode; body: ReactNode }>;
  cols?: 2 | 3;
}) {
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-xl border border-line bg-line ${cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
    >
      {items.map((c, i) => (
        <div key={i} className="bg-ink p-5">
          <p className="text-lg text-text">{c.title}</p>
          <div className="mt-2 text-sm leading-relaxed text-muted">{c.body}</div>
        </div>
      ))}
    </div>
  );
}
