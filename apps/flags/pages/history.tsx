import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader } from '@platform/ui/primitives';
import { flagChanges } from '../schema';

export default async function HistoryPage({
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
    const res = await ctx.query(flagChanges, {
      orderBy: { column: 'createdAt', dir: 'desc' },
      cursor: searchParams.cursor,
      limit: 50,
    });
    if (res.error) queryError = `Query rejected (${res.error.code})`;
    rows = res.rows;
    nextCursor = res.nextCursor;
  } catch {
    queryError = 'Query rejected — that sort is not allowed';
  }

  return (
    <div>
      <PageHeader title="Flag change history" />
      {queryError && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{queryError}</div>}
      {/* No onRowClick: the {id} placeholder resolves to the flag_changes row
          id, not the flag id, so a click would 404. */}
      <DataTable
        appId="flags"
        table="flag_changes"
        nextCursor={nextCursor}
        columns={[
          { key: 'flagKey', label: 'Flag' },
          { key: 'environment', label: 'Environment' },
          { key: 'change', label: 'Change' },
          { key: 'before', label: 'Before' },
          { key: 'after', label: 'After' },
          { key: 'actorId', label: 'Actor' },
          { key: 'approverId', label: 'Approver' },
          { key: 'createdAt', label: 'When', format: 'date' },
        ]}
        rows={rows}
      />
    </div>
  );
}
