import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader } from '@platform/ui/primitives';
import { transactions } from '../schema';

const TABS = ['all', 'settled', 'refunded', 'refund_declined'];

export default async function IndexPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('refunds');
  const status = searchParams.status;
  // Only non-sensitive columns are sortable — sorting a masked column is
  // rejected by the platform (masked order would leak the values).
  const SORTABLE = new Set(['occurredAt', 'amountCents', 'merchant', 'status', 'createdAt']);
  const sortCol = searchParams.sort && SORTABLE.has(searchParams.sort) ? searchParams.sort : 'occurredAt';
  const sortDir = searchParams.dir === 'asc' ? 'asc' : 'desc';

  let rows: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;
  let queryError: string | null = null;
  try {
    const res = await ctx.query(transactions, {
      where: status && status !== 'all' ? eq(transactions.status, status) : undefined,
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
      <PageHeader title="Transactions" />
      {queryError && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{queryError}</div>}
      <div className="mb-4 flex gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`?status=${t}`}
            className={`rounded border px-2 py-1 ${
              (status ?? 'all') === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
            }`}
          >
            {t}
          </Link>
        ))}
      </div>
      <DataTable
        appId="refunds"
        table="transactions"
        nextCursor={nextCursor}
        onRowClick="/a/refunds/detail?id={id}"
        columns={[
          { key: 'merchant', label: 'Merchant' },
          { key: 'amountCents', label: 'Amount', format: 'money' },
          { key: 'occurredAt', label: 'Date', format: 'date' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'customerEmail', label: 'Customer email', sensitive: true },
          { key: 'cardLast4', label: 'Card', sensitive: true },
        ]}
        rows={rows}
      />
    </div>
  );
}
