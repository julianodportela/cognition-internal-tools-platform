import { redirect } from 'next/navigation';
import { and, eq, like, type SQL } from 'drizzle-orm';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { can } from '@platform/rbac/rbac';
import { getDb } from '@platform/data/client';
import { auditLog } from '@platform/data/schema';
import { query } from '@platform/data/query';
import { PageHeader, StatusBadge } from '@platform/ui/primitives';
import { DataTableClient } from '@platform/ui/data-table';
import { recentEvents } from '@platform/events';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!can(user, 'audit.read')) {
    return (
      <AppShell>
        <PageHeader title="Audit log" />
        <p className="text-slate-500">You don&rsquo;t have permission to view the audit log.</p>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const db = await getDb('sandbox');
  const clauses: SQL[] = [];
  if (sp.actor) clauses.push(eq(auditLog.actorId, sp.actor));
  if (sp.action) clauses.push(like(auditLog.actionId, `%${sp.action}%`));
  if (sp.entity) clauses.push(like(auditLog.entity, `%${sp.entity}%`));

  const { rows, nextCursor } = await query(
    { db, user, reveal: new Set() },
    auditLog,
    {
      where: clauses.length ? and(...clauses) : undefined,
      orderBy: { column: 'createdAt', dir: 'desc' },
      cursor: sp.cursor,
      limit: 50,
      scope: false,
    },
  );

  const display = rows.map((r) => ({
    ...r,
    beforeJson: r.beforeJson ? String(r.beforeJson).slice(0, 80) : '—',
    afterJson: r.afterJson ? String(r.afterJson).slice(0, 80) : '—',
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  return (
    <AppShell>
      <PageHeader title="Audit log" />
      <form className="mb-4 flex gap-2" method="get">
        <input name="actor" placeholder="actor id" defaultValue={sp.actor} className="rounded border px-2 py-1 text-sm" />
        <input name="action" placeholder="action" defaultValue={sp.action} className="rounded border px-2 py-1 text-sm" />
        <input name="entity" placeholder="entity" defaultValue={sp.entity} className="rounded border px-2 py-1 text-sm" />
        <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Filter</button>
      </form>
      <div className="mb-6 rounded border bg-slate-50 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent events</h2>
        <ul className="space-y-1 text-xs text-slate-600">
          {recentEvents(15).map((e, i) => (
            <li key={i}>
              <span className="font-mono">{e.at.toLocaleTimeString()}</span>{' '}
              <span className="font-medium">{e.type}</span>
              {e.actionId ? ` · ${e.actionId}` : ''}
              {e.actorId ? ` · ${e.actorId}` : ''}
              {e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}
            </li>
          ))}
          {recentEvents(15).length === 0 && <li className="text-slate-400">No events yet.</li>}
        </ul>
      </div>
      <DataTableClient
        columns={[
          { key: 'createdAt', label: 'When' },
          { key: 'actorId', label: 'Actor' },
          { key: 'actionId', label: 'Action' },
          { key: 'entity', label: 'Entity' },
          { key: 'entityId', label: 'Entity ID' },
          { key: 'status', label: 'Status', render: (v) => <StatusBadge status={String(v)} /> },
          { key: 'beforeJson', label: 'Before' },
          { key: 'afterJson', label: 'After' },
        ]}
        rows={display}
        nextCursor={nextCursor}
        appId="_platform"
      />
    </AppShell>
  );
}
