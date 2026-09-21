import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import type { ReactElement } from 'react';

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const { variant = 'primary', className = '', ...rest } = props;
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border border-slate-300',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
      {...rest}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none ${props.className ?? ''}`}
      {...props}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-md border border-slate-300 px-3 py-1.5 text-sm ${props.className ?? ''}`}
      {...props}
    />
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones}`}>{children}</span>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div>{children}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }): ReactElement {
  const tone = status.startsWith('ok') ? 'green' : status.startsWith('failed') ? 'red' : 'amber';
  return <Badge tone={tone}>{status}</Badge>;
}
