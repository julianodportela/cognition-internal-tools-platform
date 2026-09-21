import { and, isNull, lt } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader } from '@platform/ui/primitives';
import { flags } from '../schema';
import { staleCutoff } from '../actions';

export default async function StalePage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('flags');
  let rows: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;
  let queryError: string | null = null;
  try {
    const res = await ctx.query(flags, {
      where: and(
        isNull(flags.archivedAt),
        lt(flags.lastChangedAt, staleCutoff()),
      ),
      // Oldest first — the most neglected flags are the ones to act on.
      orderBy: { column: 'lastChangedAt', dir: 'asc' },
      cursor: searchParams.cursor,
      limit: 50,
    });
    if (res.error) queryError = `Query rejected (${res.error.code})`;
    rows = res.rows;
    nextCursor = res.nextCursor;
  } catch {
    queryError = 'Query rejected — that filter is not allowed';
  }

  return (
    <div>
      <PageHeader title="Stale flags (no change in 90 days)" />
      {queryError && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{queryError}</div>}
      <DataTable
        appId="flags"
        table="flags"
        nextCursor={nextCursor}
        onRowClick="/a/flags/detail?id={id}"
        columns={[
          { key: 'key', label: 'Key' },
          { key: 'ownerTeam', label: 'Owner team' },
          { key: 'tags', label: 'Tags' },
          { key: 'stagingEnabled', label: 'Staging' },
          { key: 'stagingRollout', label: 'Staging %' },
          { key: 'productionEnabled', label: 'Production' },
          { key: 'productionRollout', label: 'Production %' },
          { key: 'lastChangedAt', label: 'Last changed', format: 'date' },
          { key: 'lastChangedBy', label: 'Changed by' },
        ]}
        rows={rows}
      />
    </div>
  );
}
