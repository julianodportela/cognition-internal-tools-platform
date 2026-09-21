import { redirect } from 'next/navigation';
import { and, desc, eq, ne } from 'drizzle-orm';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { getDb } from '@platform/data/client';
import { approvalRequests } from '@platform/data/schema';
import { PageHeader, Badge, StatusBadge } from '@platform/ui/primitives';
import { ApprovalButtons } from '@platform/ui/inbox-actions';
import { getAction } from '@platform/registry';
import { canDecide } from '@platform/approvals';

export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb('sandbox');

  const pending = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.status, 'pending'), ne(approvalRequests.requesterId, user.id)))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(100);

  const actionable = pending.filter((r) => {
    const action = getAction(r.actionId);
    if (!action) return false;
    const policy = JSON.parse(r.policyJson) as { kind: string; role?: string };
    return canDecide(user, r.requesterId, policy, action.perm);
  });

  const mine = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.requesterId, user.id))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(50);

  return (
    <AppShell>
      <PageHeader title="Approval inbox" />
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Awaiting your decision</h2>
      <table className="mb-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="p-2">Request</th><th className="p-2">Action</th><th className="p-2">Requester</th>
            <th className="p-2">Input</th><th className="p-2">Policy</th><th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {actionable.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
              <td className="p-2">{r.actionId}</td>
              <td className="p-2">{r.requesterId}</td>
              <td className="max-w-xs truncate p-2 font-mono text-xs">{r.inputJson}</td>
              <td className="p-2"><Badge tone="amber">{JSON.parse(r.policyJson).kind}</Badge></td>
              <td className="p-2"><ApprovalButtons requestId={r.id} /></td>
            </tr>
          ))}
          {actionable.length === 0 && (
            <tr><td colSpan={6} className="p-4 text-center text-slate-400">Nothing pending for you.</td></tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">My requests</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="p-2">Request</th><th className="p-2">Action</th><th className="p-2">Status</th>
            <th className="p-2">Approver</th><th className="p-2">When</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
              <td className="p-2">{r.actionId}</td>
              <td className="p-2"><StatusBadge status={r.status} /></td>
              <td className="p-2">{r.approverId ?? '—'}</td>
              <td className="p-2 text-xs text-slate-500">{r.createdAt.toLocaleString()}</td>
            </tr>
          ))}
          {mine.length === 0 && (
            <tr><td colSpan={5} className="p-4 text-center text-slate-400">You have no requests.</td></tr>
          )}
        </tbody>
      </table>
    </AppShell>
  );
}
