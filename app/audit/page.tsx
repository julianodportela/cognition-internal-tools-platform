import { redirect } from 'next/navigation';
import { and, eq, like, type SQL } from 'drizzle-orm';
import { AppShell } from '@platform/ui/app-shell';
import { getCurrentUser } from '@platform/auth/provider';
import { can } from '@platform/rbac/rbac';
import { getDb } from '@platform/data/client';
import { auditLog } from '@platform/data/schema';
import { query } from '@platform/data/query';
import { Button, Card, Input, PageHeader } from '@platform/ui/primitives';
import { DataTable } from '@platform/ui/data-table-server';
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
      <AppShell topbar="Audit log">
        <PageHeader title="Audit log" />
        <div className="ll-card p-6 text-sm text-ink-500">You don&rsquo;t have permission to view the audit log.</div>
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
    <AppShell topbar="Audit log">
      <PageHeader title="Audit log" description="Every action, allowed or denied, across all tools." />
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <Input name="actor" placeholder="Actor id" defaultValue={sp.actor} className="!w-44" />
        <Input name="action" placeholder="Action" defaultValue={sp.action} className="!w-44" />
        <Input name="entity" placeholder="Entity" defaultValue={sp.entity} className="!w-44" />
        <Button type="submit" variant="ghost">Filter</Button>
      </form>
      <Card title="Recent events" className="mb-6" padded={false}>
        <ul className="divide-y divide-line text-xs">
          {recentEvents(15).map((e, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-1.5">
              <span className="font-mono text-ink-400">{e.at.toLocaleTimeString()}</span>
              <span className="font-medium text-ink-800">{e.type}</span>
              <span className="truncate text-ink-500">
                {[e.actionId, e.actorId, e.entityId?.slice(0, 8)].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
          {recentEvents(15).length === 0 && <li className="px-5 py-3 text-ink-400">No events yet.</li>}
        </ul>
      </Card>
      <DataTable
        columns={[
          { key: 'createdAt', label: 'When' },
          { key: 'actorId', label: 'Actor' },
          { key: 'actionId', label: 'Action' },
          { key: 'entity', label: 'Entity' },
          { key: 'entityId', label: 'Entity ID' },
          { key: 'status', label: 'Status', format: 'status' },
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

export const dynamic = 'force-dynamic';
