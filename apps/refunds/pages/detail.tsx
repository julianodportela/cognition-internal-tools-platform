import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { Notes, type NoteRow } from '@platform/ui/notes';
import { PageHeader, StatusBadge, Card } from '@platform/ui/primitives';
import { refunds, transactions } from '../schema';
import { RefundCard } from '../components/RefundCard';

export default async function DetailPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const id = searchParams.id;
  if (!id) notFound();
  const ctx = await getReadCtx('refunds');
  const { rows } = await ctx.query(transactions, {
    where: eq(transactions.id, id),
    limit: 1,
  });
  const row = rows[0];
  if (!row) notFound();

  const [{ rows: refundRows }, noteRows] = await Promise.all([
    ctx.query(refunds, {
      where: and(eq(refunds.transactionId, id)),
      orderBy: { column: 'createdAt', dir: 'desc' },
      limit: 20,
    }),
    ctx.listNotes('transactions', id),
  ]);
  const notes: NoteRow[] = noteRows.map((n) => ({
    id: Number(n.id),
    authorId: String(n.authorId),
    body: String(n.body),
    createdAt: String(n.createdAt),
  }));

  const status = String(row.status);
  const latestRefund = refundRows[0];

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={`${row.merchant} — $${(Number(row.amountCents) / 100).toFixed(2)}`} description="Transaction details and refund history.">
        <StatusBadge status={status} />
      </PageHeader>
      <RefundCard
        id={id}
        status={status}
        amountCents={Number(row.amountCents)}
        customerEmail={row.customerEmail == null ? null : String(row.customerEmail)}
        cardLast4={row.cardLast4 == null ? null : String(row.cardLast4)}
        occurredAt={String(row.occurredAt)}
        refunds={refundRows.map((r) => ({
          id: String(r.id),
          status: String(r.status),
          amountCents: Number(r.amountCents),
          reason: String(r.reason),
          requesterId: String(r.requesterId),
        }))}
        latestRefundId={latestRefund ? String(latestRefund.id) : null}
        latestRefundStatus={latestRefund ? String(latestRefund.status) : null}
      />
      <Card>
        <Notes appId="refunds" entity="transactions" entityId={id} notes={notes} />
      </Card>
    </div>
  );
}
