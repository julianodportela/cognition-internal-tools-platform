import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { can } from '@platform/rbac/rbac';
import { getApp } from '@platform/registry';
import { PageHeader } from '@platform/ui/primitives';

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
      <AppShell sandbox={app.dataMode === 'sandbox'} topbar={<><span className="text-ink-300">/</span><span className="font-medium text-ink-800">{app.name}</span></>}>
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
    <AppShell sandbox={app.dataMode === 'sandbox'} topbar={<><span className="text-ink-300">/</span><span className="font-medium text-ink-800">{app.name}</span></>}>
      {nav.length > 1 && (
        <nav className="mb-6 flex gap-6 border-b border-line">
          {nav.map((n) => {
            const active = activeNav ? activeNav.path === n.path : n.path === '';
            return (
              <Link
                key={n.path}
                href={`/a/${app.id}${n.path ? `/${n.path}` : ''}`}
                className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition ${
                  active
                    ? 'border-brand-600 text-ink-950'
                    : 'border-transparent text-ink-500 hover:text-ink-800'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
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
