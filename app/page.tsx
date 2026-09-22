import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { getApps } from '@platform/registry';
import { can } from '@platform/rbac/rbac';
import { Badge, PageHeader, EmptyState } from '@platform/ui/primitives';
import { AppIcon, Icon } from '@platform/ui/icons';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const apps = getApps().filter((a) => can(user, a.permission));
  const first = user.name.split(' ')[0];

  return (
    <AppShell>
      <PageHeader title="Your tools" description={`Good to see you, ${first}. Here's what you can work on today.`} />
      {apps.length === 0 ? (
        <div className="ll-card">
          <EmptyState title="No tools for your role yet" hint="Apps appear here once they're registered under apps/." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => (
            <Link
              key={a.id}
              href={`/a/${a.id}`}
              className="ll-card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <AppIcon icon={a.icon} label={a.name} size={20} />
                </span>
                <div className="flex gap-1.5">
                  {a.kind === 'template' && <Badge>template</Badge>}
                  <Badge tone={a.dataMode === 'sandbox' ? 'amber' : 'green'}>{a.dataMode}</Badge>
                </div>
              </div>
              <div className="mt-4 text-[15px] font-semibold text-ink-950 group-hover:text-brand-700">{a.name}</div>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-500">
                {a.description ?? 'Internal tool built on the Ledgerline platform.'}
              </p>
              <div className="mt-4 flex items-center justify-between text-xs text-ink-400">
                <span>{a.dataClass === 'sensitive' ? 'Handles sensitive data' : 'Internal data'}</span>
                <span className="font-medium text-brand-600 opacity-0 transition group-hover:opacity-100">
                  <Icon name="arrow-right" size={14} className="transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
