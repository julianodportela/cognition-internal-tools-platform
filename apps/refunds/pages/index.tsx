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

  const { rows, nextCursor } = await ctx.query(transactions, {
    where: status && status !== 'all' ? eq(transactions.status, status) : undefined,
    orderBy: searchParams.sort
      ? { column: searchParams.sort, dir: searchParams.dir === 'asc' ? 'asc' : 'desc' }
      : { column: 'occurredAt', dir: 'desc' },
    cursor: searchParams.cursor,
    limit: 20,
  });

  return (
    <div>
      <PageHeader title="Transactions" />
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
