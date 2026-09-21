import Link from 'next/link';
import type { ReactNode } from 'react';
import { getCurrentUser } from '@platform/auth/provider';
import { getApps } from '@platform/registry';
import { can } from '@platform/rbac/rbac';
import { users } from '@platform/policy/roles';
import { loginAs, logout } from '@platform/auth/actions';

export async function AppShell({
  children,
  sandbox,
}: {
  children: ReactNode;
  sandbox?: boolean;
}) {
  const user = await getCurrentUser();
  const apps = user ? getApps().filter((a) => can(user, a.permission)) : [];

  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r bg-slate-50 p-4">
        <Link href="/" className="mb-4 block text-lg font-bold">
          Internal Tools
        </Link>
        <ul className="space-y-1 text-sm">
          {apps.map((a) => (
            <li key={a.id}>
              <Link className="block rounded px-2 py-1 hover:bg-slate-200" href={`/a/${a.id}`}>
                {a.icon} {a.name}
              </Link>
            </li>
          ))}
          <li className="pt-3 text-xs font-semibold uppercase text-slate-400">Platform</li>
          <li><Link className="block rounded px-2 py-1 hover:bg-slate-200" href="/inbox">Inbox</Link></li>
          <li><Link className="block rounded px-2 py-1 hover:bg-slate-200" href="/audit">Audit log</Link></li>
        </ul>
        <div className="mt-8 border-t pt-3 text-xs text-slate-500">
          {user ? (
            <>
              <div className="mb-2">
                Signed in as <span className="font-medium text-slate-700">{user.name}</span>
                <div className="text-slate-400">{user.role}</div>
              </div>
              <form action={logout}>
                <button className="text-blue-600 underline">Sign out</button>
              </form>
              <div className="mt-2">
                <span className="text-slate-400">Switch:</span>
                {users.filter((u) => u.id !== user.id).slice(0, 4).map((u) => (
                  <form key={u.id} action={loginAs.bind(null, u.id)} className="inline">
                    <button className="mr-2 text-blue-600 underline">{u.name.split(' ')[0]}</button>
                  </form>
                ))}
              </div>
            </>
          ) : (
            <Link className="text-blue-600 underline" href="/login">Sign in</Link>
          )}
        </div>
      </nav>
      <div className="flex-1">
        {sandbox && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-sm font-medium text-amber-900">
            SANDBOX — synthetic data
          </div>
        )}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
