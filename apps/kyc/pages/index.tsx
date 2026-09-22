import { and, eq } from 'drizzle-orm';
import { getReadCtx, mineClause } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader, Badge, Tabs } from '@platform/ui/primitives';
import { kycReviews } from '../schema';

const TABS = ['all', 'pending', 'in_review', 'approved', 'rejected'];
const OPEN_STATUSES = new Set(['pending', 'in_review']);

export default async function IndexPage({
  subpath,
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('kyc');
  const mine = subpath[0] === 'mine';
  const status = searchParams.status;

  const clauses = [];
  if (status && status !== 'all') clauses.push(eq(kycReviews.status, status));
  if (mine) clauses.push(mineClause(ctx.user, kycReviews));

  const { rows, nextCursor } = await ctx.query(kycReviews, {
    where: clauses.length ? and(...clauses) : undefined,
    orderBy: searchParams.sort
      ? { column: searchParams.sort, dir: searchParams.dir === 'asc' ? 'asc' : 'desc' }
      : { column: 'createdAt', dir: 'desc' },
    cursor: searchParams.cursor,
    limit: 20,
  });

  const now = new Date().getTime();
  const overdueCount = rows.filter(
    (r) =>
      OPEN_STATUSES.has(String(r.status)) &&
      r.dueAt != null &&
      new Date(String(r.dueAt)).getTime() < now,
  ).length;

  return (
    <div>
      <PageHeader
        title={mine ? 'My cases' : 'KYC queue'}
        description="Claim a case, review the masked details, approve or reject with a reason."
      >
        {overdueCount > 0 && <Badge tone="red">{overdueCount} overdue on this page</Badge>}
      </PageHeader>
      <Tabs items={TABS} current={status ?? 'all'} hrefFor={(t) => `?status=${t}`} />
      <DataTable
        appId="kyc"
        table="kyc_reviews"
        nextCursor={nextCursor}
        onRowClick="/a/kyc/detail?id={id}"
        columns={[
          { key: 'customerRef', label: 'Customer ref' },
          { key: 'fullName', label: 'Full name', sensitive: true },
          { key: 'dateOfBirth', label: 'Date of birth', sensitive: true },
          { key: 'country', label: 'Country' },
          { key: 'idDocumentNumber', label: 'Document no.', sensitive: true },
          { key: 'riskScore', label: 'Risk', format: 'status' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'assigneeId', label: 'Assignee' },
          { key: 'dueAt', label: 'Due', format: 'date' },
        ]}
        rows={rows}
      />
    </div>
  );
}
