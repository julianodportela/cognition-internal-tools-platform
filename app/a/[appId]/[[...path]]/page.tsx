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
      <AppShell sandbox={app.dataMode === 'sandbox'}>
        <PageHeader title={app.name} />
        <p className="text-slate-500">You don&rsquo;t have permission to use this app.</p>
      </AppShell>
    );
  }
  const subpath = path.join('/');
  const Page = app.pages[subpath] ?? app.pages[''];
  if (!Page) notFound();
  return (
    <AppShell sandbox={app.dataMode === 'sandbox'}>
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
