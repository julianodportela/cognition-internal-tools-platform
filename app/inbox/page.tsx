import { redirect } from 'next/navigation';
import { and, desc, eq, ne } from 'drizzle-orm';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { getDb } from '@platform/data/client';
import { approvalRequests } from '@platform/data/schema';
import { PageHeader, Badge, StatusBadge, Card, EmptyState, Mono } from '@platform/ui/primitives';
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
    <AppShell topbar="Approvals">
      <PageHeader
        title="Approvals"
        description="Risky actions wait here for a second person. You can never approve your own request."
      />
      <div className="space-y-8">
        <Card
          padded={false}
          title={
            <span className="flex items-center gap-2">
              Awaiting your decision
              {actionable.length > 0 && <Badge tone="amber">{actionable.length}</Badge>}
            </span>
          }
        >
          {actionable.length === 0 ? (
            <EmptyState title="Nothing pending for you" hint="Requests you're eligible to decide will show up here." />
          ) : (
            <table className="ll-table">
              <thead>
                <tr className="text-left">
                  <th>Request</th><th>Action</th><th>Requester</th><th>Input</th><th>Policy</th><th className="text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {actionable.map((r) => (
                  <tr key={r.id}>
                    <td><Mono>{r.id.slice(0, 8)}</Mono></td>
                    <td className="font-medium">{r.actionId}</td>
                    <td className="text-ink-600">{r.requesterId}</td>
                    <td className="max-w-xs truncate font-mono text-xs text-ink-500">{r.inputJson}</td>
                    <td><Badge tone="amber">{JSON.parse(r.policyJson).kind}</Badge></td>
                    <td className="text-right"><ApprovalButtons requestId={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card padded={false} title="My requests">
          {mine.length === 0 ? (
            <EmptyState title="You have no requests" hint="Actions that need approval will be tracked here." />
          ) : (
            <table className="ll-table">
              <thead>
                <tr className="text-left">
                  <th>Request</th><th>Action</th><th>Status</th><th>Approver</th><th>When</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <td><Mono>{r.id.slice(0, 8)}</Mono></td>
                    <td className="font-medium">{r.actionId}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-ink-600">{r.approverId ?? '—'}</td>
                    <td className="text-xs text-ink-500">{r.createdAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

export const dynamic = 'force-dynamic';
