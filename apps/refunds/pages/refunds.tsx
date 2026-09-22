import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader, Tabs, Alert } from '@platform/ui/primitives';
import { refunds } from '../schema';

const TABS = ['all', 'issued', 'pending', 'failed'];
const SORTABLE = new Set(['createdAt', 'amountCents', 'status', 'transactionId']);

export default async function RefundsPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('refunds');
  const status = searchParams.status;
  const sortCol = searchParams.sort && SORTABLE.has(searchParams.sort) ? searchParams.sort : 'createdAt';
  const sortDir = searchParams.dir === 'asc' ? 'asc' : 'desc';

  // Sorting by a sensitive or unknown column is rejected by the platform
  // query layer — surface the rejection, never raw data.
  let rows: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;
  let queryError: string | null = null;
  try {
    const res = await ctx.query(refunds, {
      where: status && status !== 'all' ? eq(refunds.status, status) : undefined,
      orderBy: { column: sortCol, dir: sortDir },
      cursor: searchParams.cursor,
      limit: 20,
    });
    if (res.error) queryError = `Query rejected (${res.error.code})`;
    rows = res.rows;
    nextCursor = res.nextCursor;
  } catch {
    queryError = 'Query rejected — that sort or filter is not allowed on masked data';
  }

  return (
    <div>
      <PageHeader
        title="All refunds"
        description="Every refund ever requested — who asked, who approved, and the outcome."
      />
      <Tabs items={TABS} current={status ?? 'all'} hrefFor={(t) => `?status=${t}&sort=${sortCol}&dir=${sortDir}`} />
      {queryError && <div className="mb-3"><Alert tone="warn">{queryError}</Alert></div>}
      <DataTable
        appId="refunds"
        table="refunds"
        nextCursor={nextCursor}
        columns={[
          { key: 'transactionId', label: 'Transaction' },
          { key: 'amountCents', label: 'Amount', format: 'money' },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'requesterId', label: 'Requested by' },
          { key: 'approverId', label: 'Approved by' },
          { key: 'createdAt', label: 'Created', format: 'date' },
        ]}
        rows={rows}
      />
    </div>
  );
}
