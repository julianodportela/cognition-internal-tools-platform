import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { can } from '@platform/rbac/rbac';
import { getApp } from '@platform/registry';
import { Badge, PageHeader } from '@platform/ui/primitives';

export default async function AppDispatch({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { appId, path = [] } = await params;
  const sp = await searchParams;
  const app = getApp(appId);
  if (!app) notFound();
  if (!can(user, app.permission)) {
    return (
      <AppShell sandbox={app.dataMode === 'sandbox'}>
        <PageHeader title={app.name} />
        <div className="ll-card p-6 text-sm text-ink-500">You don&rsquo;t have permission to use this app.</div>
      </AppShell>
    );
  }
  const subpath = path.join('/');
  const Page = app.pages[subpath] ?? app.pages[''];
  if (!Page) notFound();
  const nav = app.nav ?? [];
  const activeNav = nav.find((n) => n.path === subpath || (n.path !== '' && subpath.startsWith(`${n.path}/`)));
  return (
    <AppShell sandbox={app.dataMode === 'sandbox'}>
      {nav.length > 1 && (
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-line">
          <div className="flex items-center gap-2 pb-3 text-xs text-ink-400">
            <span className="text-base leading-none">{app.icon}</span>
            <span className="font-medium text-ink-700">{app.name}</span>
            <Badge tone={app.dataMode === 'sandbox' ? 'amber' : 'green'}>{app.dataMode}</Badge>
          </div>
          <nav className="-mb-px flex gap-1">
            {nav.map((n) => {
              const active = activeNav ? activeNav.path === n.path : n.path === '';
              return (
                <Link
                  key={n.path}
                  href={`/a/${app.id}${n.path ? `/${n.path}` : ''}`}
                  className={`border-b-2 px-3 pb-3 text-sm font-medium transition ${
                    active
                      ? 'border-brand-500 text-ink-950'
                      : 'border-transparent text-ink-500 hover:border-ink-200 hover:text-ink-800'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      <Page
        subpath={path}
        searchParams={Object.fromEntries(
          Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
        )}
      />
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
