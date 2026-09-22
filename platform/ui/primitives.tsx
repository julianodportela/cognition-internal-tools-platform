import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from './icons';

export type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand';

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
    size?: 'sm' | 'md';
  },
) {
  const { variant = 'primary', size = 'md', className = '', ...rest } = props;
  const styles = {
    primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow focus-visible:ring-brand-500/40',
    ghost: 'border border-ink-200 bg-white text-ink-800 shadow-sm hover:border-ink-300 hover:bg-ink-50 focus-visible:ring-brand-500/30',
    subtle: 'bg-transparent text-ink-700 hover:bg-ink-100 focus-visible:ring-brand-500/30',
    danger: 'bg-danger-600 text-white shadow-sm hover:bg-danger-700 focus-visible:ring-danger-600/40',
  }[variant];
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' }[size];
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${sizes} ${styles} ${className}`}
      {...rest}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ll-input ${props.className ?? ''}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ll-input w-auto pr-8 ${props.className ?? ''}`} {...props} />;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  const tones = {
    slate: 'bg-ink-100 text-ink-700 ring-ink-200',
    green: 'bg-ok-50 text-ok-700 ring-ok-600/20',
    red: 'bg-danger-50 text-danger-700 ring-danger-600/20',
    amber: 'bg-warn-50 text-warn-800 ring-warn-700/20',
    blue: 'bg-info-50 text-info-700 ring-info-700/20',
    brand: 'bg-brand-50 text-brand-700 ring-brand-500/25',
  }[tone];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-semibold ring-1 ring-inset ${tones}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ok: 'green', issued: 'green', approved: 'green', settled: 'green', active: 'green',
  failed: 'red', rejected: 'red', denied: 'red', refund_declined: 'red',
  pending: 'amber', in_review: 'amber', needs_approval: 'amber', overdue: 'red',
  refunded: 'blue', archived: 'slate', resubmitted: 'blue',
};

export function StatusBadge({ status }: { status: string }): ReactElement {
  const key = Object.keys(STATUS_TONE).find((k) => status === k || status.startsWith(k));
  const tone = key ? STATUS_TONE[key] : 'slate';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold text-ink-950">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
  actions,
  padded = true,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={`ll-card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Tabs({
  items,
  current,
  hrefFor,
}: {
  items: string[];
  current: string;
  hrefFor: (item: string) => string;
}) {
  return (
    <nav className="mb-4 inline-flex rounded-lg bg-ink-100 p-1 text-sm">
      {items.map((t) => {
        const active = t === current;
        return (
          <Link
            key={t}
            href={hrefFor(t)}
            className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${
              active ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {t}
          </Link>
        );
      })}
    </nav>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-ink-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'ok' | 'err' | 'info' | 'warn'; children: ReactNode }) {
  const tones = {
    ok: 'border-ok-600/20 bg-ok-50 text-ok-700',
    err: 'border-danger-600/20 bg-danger-50 text-danger-700',
    info: 'border-info-700/20 bg-info-50 text-info-700',
    warn: 'border-warn-700/20 bg-warn-50 text-warn-800',
  }[tone];
  const icon = ({ ok: 'check', err: 'x', warn: 'warning', info: 'info' } as Record<'ok' | 'err' | 'warn' | 'info', IconName>)[tone];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${tones}`}>
      <Icon name={icon} size={14} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Icon name="list" size={18} />
      </div>
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, tone = 'slate' }: { label: string; value: ReactNode; tone?: Tone }) {
  const accents = {
    slate: 'text-ink-950', green: 'text-ok-600', red: 'text-danger-600',
    amber: 'text-warn-700', blue: 'text-info-700', brand: 'text-brand-600',
  }[tone];
  return (
    <div className="ll-card px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accents}`}>{value}</div>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[12px] text-ink-700">{children}</code>;
}
