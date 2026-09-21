import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader } from '@platform/ui/primitives';
import { refunds } from '../schema';

const TABS = ['all', 'issued', 'pending', 'failed', 'rejected'];

export default async function RefundsPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('refunds');
  const status = searchParams.status;

  const { rows, nextCursor } = await ctx.query(refunds, {
    where: status && status !== 'all' ? eq(refunds.status, status) : undefined,
    orderBy: { column: 'createdAt', dir: 'desc' },
    cursor: searchParams.cursor,
    limit: 20,
  });

  return (
    <div>
      <PageHeader title="All refunds" />
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
