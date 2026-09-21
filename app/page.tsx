import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { getApps } from '@platform/registry';
import { can } from '@platform/rbac/rbac';
import { PageHeader } from '@platform/ui/primitives';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const apps = getApps().filter((a) => can(user, a.permission));

  return (
    <AppShell>
      <PageHeader title="Your tools" />
      {apps.length === 0 ? (
        <p className="text-slate-500">No apps are registered yet. Apps appear here once added under <code>apps/</code>.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {apps.map((a) => (
            <Link
              key={a.id}
              href={`/a/${a.id}`}
              className="rounded-lg border p-4 hover:border-slate-400 hover:shadow-sm"
            >
              <div className="text-2xl">{a.icon}</div>
              <div className="mt-1 font-medium">{a.name}</div>
              <div className="text-xs text-slate-400">{a.dataMode}</div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
