import { and, gt, isNull, lt } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader, Tabs, Alert, Card } from '@platform/ui/primitives';
import { ActionForm } from '@platform/ui/form';
import { fieldsFromSchema } from '@platform/ui/fields';
import { flags } from '../schema';
import { createInput, staleCutoff } from '../actions';

const TABS = ['all', 'active', 'stale', 'archived'];

export default async function IndexPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('flags');
  const status = searchParams.status;
  // Only non-sensitive columns are sortable — the platform rejects sorting a
  // masked column, and this app has no sensitive columns anyway.
  const SORTABLE = new Set(['key', 'ownerTeam', 'lastChangedAt', 'lastChangedBy', 'createdAt']);
  const sortCol = searchParams.sort && SORTABLE.has(searchParams.sort) ? searchParams.sort : 'key';
  const sortDir = searchParams.dir ? (searchParams.dir === 'asc' ? 'asc' : 'desc') : 'asc';

  let where;
  if (status === 'active') where = isNull(flags.archivedAt);
  else if (status === 'archived') where = gt(flags.archivedAt, new Date(0));
  else if (status === 'stale') {
    where = and(
      isNull(flags.archivedAt),
      lt(flags.lastChangedAt, staleCutoff()),
    );
  }

  let rows: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;
  let queryError: string | null = null;
  try {
    const res = await ctx.query(flags, {
      where,
      orderBy: { column: sortCol, dir: sortDir },
      cursor: searchParams.cursor,
      limit: 20,
    });
    if (res.error) queryError = `Query rejected (${res.error.code})`;
    rows = res.rows;
    nextCursor = res.nextCursor;
  } catch {
    queryError = 'Query rejected — that sort or filter is not allowed';
  }

  return (
    <div>
      <PageHeader
        title="Feature flags"
        description="Toggle rollouts per environment — production changes need a second engineer."
      />
      {queryError && <div className="mb-3"><Alert tone="warn">{queryError}</Alert></div>}
      <Tabs items={TABS} current={status ?? 'all'} hrefFor={(t) => `?status=${t}`} />
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
      <div className="mt-8 max-w-md">
        <Card title="New flag">
        <ActionForm
          actionId="flags.create"
          fields={fieldsFromSchema(createInput, {
            key: 'Key',
            description: 'Description',
            ownerTeam: 'Owner team',
            tags: 'Tags (comma-separated, e.g. payments)',
          })}
          submitLabel="Create flag"
        />
        </Card>
      </div>
    </div>
  );
}
