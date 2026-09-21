import { users } from '@platform/policy/roles';
import { loginAs } from '@platform/auth/actions';
import { Button } from '@platform/ui/primitives';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6">
        <h1 className="mb-1 text-lg font-semibold">Internal Tools</h1>
        <p className="mb-4 text-sm text-slate-500">Dev sign-in — pick a seeded user.</p>
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id}>
              <form action={loginAs.bind(null, u.id)}>
                <Button variant="ghost" className="w-full justify-start text-left">
                  <span>
                    <span className="block font-medium">{u.name}</span>
                    <span className="text-xs text-slate-500">{u.role} · team {u.teamId}</span>
                  </span>
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
