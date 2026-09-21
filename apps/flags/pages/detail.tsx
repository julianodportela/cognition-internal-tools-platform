import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { Notes, type NoteRow } from '@platform/ui/notes';
import { PageHeader, Badge } from '@platform/ui/primitives';
import { flags, flagChanges } from '../schema';
import { FlagControls } from '../components/FlagControls';

export default async function DetailPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const id = searchParams.id;
  if (!id) notFound();
  const ctx = await getReadCtx('flags');
  const { rows } = await ctx.query(flags, {
    where: eq(flags.id, id),
    limit: 1,
  });
  const row = rows[0];
  if (!row) notFound();

  const [{ rows: history }, noteRows] = await Promise.all([
    ctx.query(flagChanges, {
      where: eq(flagChanges.flagId, id),
      orderBy: { column: 'createdAt', dir: 'desc' },
      limit: 50,
    }),
    ctx.listNotes('flags', id),
  ]);
  const notes: NoteRow[] = noteRows.map((n) => ({
    id: Number(n.id),
    authorId: String(n.authorId),
    body: String(n.body),
    createdAt: String(n.createdAt),
  }));

  const archived = row.archivedAt != null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={String(row.key)}>
        <Badge tone={archived ? 'slate' : 'green'}>{archived ? 'archived' : 'active'}</Badge>
      </PageHeader>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border p-4 text-sm">
        <dt className="text-slate-500">Description</dt>
        <dd>{String(row.description)}</dd>
        <dt className="text-slate-500">Owner team</dt>
        <dd>{String(row.ownerTeam)}</dd>
        <dt className="text-slate-500">Tags</dt>
        <dd>{String(row.tags) || '—'}</dd>
        <dt className="text-slate-500">Last changed</dt>
        <dd>
          {new Date(String(row.lastChangedAt)).toLocaleDateString()} by {String(row.lastChangedBy)}
        </dd>
        <dt className="text-slate-500">Version</dt>
        <dd>{String(row.version)}</dd>
      </dl>

      <FlagControls
        id={id}
        version={Number(row.version)}
        archived={archived}
        tags={String(row.tags)}
        stagingEnabled={Boolean(row.stagingEnabled)}
        stagingRollout={Number(row.stagingRollout)}
        productionEnabled={Boolean(row.productionEnabled)}
        productionRollout={Number(row.productionRollout)}
        canToggle
      />

      <div className="rounded border p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Change history</h3>
        {history.length === 0 && <p className="text-sm text-slate-400">No changes yet.</p>}
        <ul className="space-y-1 text-sm">
          {history.map((h) => (
            <li key={String(h.id)} className="flex justify-between gap-4 border-b py-1 last:border-0">
              <span>
                <span className="font-medium">{String(h.change)}</span> in {String(h.environment)}:{' '}
                {String(h.before)} → {String(h.after)}
              </span>
              <span className="whitespace-nowrap text-slate-500">
                {String(h.actorId)}
                {h.approverId ? ` · approved by ${String(h.approverId)}` : ''} ·{' '}
                {new Date(String(h.createdAt)).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded border p-4">
        <Notes appId="flags" entity="flags" entityId={id} notes={notes} />
      </div>
    </div>
  );
}
