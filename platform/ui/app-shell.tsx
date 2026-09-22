import Link from 'next/link';
import type { ReactNode } from 'react';
import { getCurrentUser } from '@platform/auth/provider';
import { getApps } from '@platform/registry';
import { can } from '@platform/rbac/rbac';
import { users } from '@platform/policy/roles';
import { loginAs, logout } from '@platform/auth/actions';
import { Brand } from './brand';
import { NavLink } from './nav-link';

const ROLE_LABEL: Record<string, string> = {
  analyst: 'KYC analyst',
  senior_reviewer: 'Senior reviewer',
  compliance_readonly: 'Compliance',
  support_agent: 'Support',
  finance_approver: 'Finance',
  eng_dev: 'Engineer',
  eng_admin: 'Engineering admin',
};

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

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
      <aside className="flex w-60 shrink-0 flex-col bg-ink-950 text-ink-200">
        <div className="px-5 pb-4 pt-5">
          <Brand />
        </div>

        <nav className="flex-1 space-y-6 px-3">
          <div>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              Tools
            </div>
            <ul className="space-y-0.5">
              {apps.map((a) => (
                <li key={a.id}>
                  <NavLink href={`/a/${a.id}`}>
                    <span className="w-5 text-center text-base leading-none">{a.icon}</span>
                    <span className="truncate">{a.name}</span>
                    {a.kind === 'template' && (
                      <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">template</span>
                    )}
                  </NavLink>
                </li>
              ))}
              {apps.length === 0 && <li className="px-2 text-xs text-ink-500">No tools available</li>}
            </ul>
          </div>
          <div>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              Platform
            </div>
            <ul className="space-y-0.5">
              <li>
                <NavLink href="/inbox">
                  <span className="w-5 text-center text-base leading-none">✓</span>
                  <span>Approvals</span>
                </NavLink>
              </li>
              <li>
                <NavLink href="/audit">
                  <span className="w-5 text-center text-base leading-none">≡</span>
                  <span>Audit log</span>
                </NavLink>
              </li>
            </ul>
          </div>
        </nav>

        <div className="border-t border-ink-800 p-3 text-xs">
          {user ? (
            <div className="rounded-lg bg-ink-900 p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-ink-950">
                  {initials(user.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">{user.name}</div>
                  <div className="truncate text-ink-400">{ROLE_LABEL[user.role] ?? user.role}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-800 pt-2.5">
                <details className="relative">
                  <summary className="cursor-pointer list-none text-ink-400 hover:text-white">Switch user ▾</summary>
                  <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-pop">
                    {users.filter((u) => u.id !== user.id).map((u) => (
                      <form key={u.id} action={loginAs.bind(null, u.id)}>
                        <button className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-ink-800">
                          <span className="text-ink-100">{u.name}</span>
                          <span className="text-[10px] text-ink-500">{ROLE_LABEL[u.role] ?? u.role}</span>
                        </button>
                      </form>
                    ))}
                  </div>
                </details>
                <form action={logout}>
                  <button className="text-ink-400 hover:text-white">Sign out</button>
                </form>
              </div>
            </div>
          ) : (
            <Link className="block rounded-lg bg-ink-900 p-3 text-center text-brand-400 hover:text-brand-200" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {sandbox && (
          <div className="flex items-center justify-center gap-2 border-b border-warn-200 bg-warn-50 px-4 py-1.5 text-xs font-medium text-warn-800">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-warn-700" />
            Sandbox — synthetic data, mock integrations. Nothing here touches real customers.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-8">{children}</main>
        <footer className="px-8 py-4 text-[11px] text-ink-400">
          Ledgerline Internal Tools · every action is audited
        </footer>
      </div>
    </div>
  );
}
