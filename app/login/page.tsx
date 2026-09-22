import { users } from '@platform/policy/roles';
import { loginAs } from '@platform/auth/actions';
import { Brand, BrandMark } from '@platform/ui/brand';

const ROLE_LABEL: Record<string, string> = {
  analyst: 'KYC analyst',
  senior_reviewer: 'Senior KYC reviewer',
  compliance_readonly: 'Compliance · read-only',
  support_agent: 'Support agent',
  finance_approver: 'Finance approver',
  eng_dev: 'Engineer',
  eng_admin: 'Engineering admin',
};

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[42%] flex-col justify-between bg-ink-950 p-10 text-ink-200 lg:flex">
        <Brand />
        <div>
          <BrandMark size={48} />
          <h2 className="mt-6 text-3xl font-semibold leading-tight text-white">
            One place for every internal tool.
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-400">
            Refunds, KYC review, feature flags — built from plain-language specs on a shared platform that
            handles permissions, masking, approvals and audit for you.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-ink-300">
            {['Private data masked by default', 'Risky actions need a second person', 'Every click is audited'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-ink-500">© Ledgerline · sandbox environment</p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-surface p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden"><Brand dark={false} /></div>
          <h1 className="text-2xl font-semibold text-ink-950">Sign in</h1>
          <p className="mt-1 text-sm text-ink-500">
            Development sign-in — choose a seeded account. Single sign-on is used in production.
          </p>
          <ul className="mt-6 space-y-2">
            {users.map((u) => (
              <li key={u.id}>
                <form action={loginAs.bind(null, u.id)}>
                  <button className="ll-card flex w-full items-center gap-3 px-4 py-3 text-left transition hover:border-brand-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-950">{u.name}</span>
                      <span className="block text-xs text-ink-500">{ROLE_LABEL[u.role] ?? u.role} · team {u.teamId}</span>
                    </span>
                    <span className="text-ink-300">→</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
