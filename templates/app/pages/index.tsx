import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { getReadCtx, mineClause } from '@platform/data/read';
import { DataTable } from '@platform/ui/data-table-server';
import { PageHeader } from '@platform/ui/primitives';
import { ActionForm } from '@platform/ui/form';
import { fieldsFromSchema } from '@platform/ui/fields';
import { expenseRequests } from '../schema';
import { createInput } from '../actions';

const TABS = ['all', 'draft', 'submitted', 'approved', 'rejected', 'paid'];

export default async function IndexPage({
  subpath,
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const ctx = await getReadCtx('template');
  const mine = subpath[0] === 'mine';
  const status = searchParams.status;

  const clauses = [];
  if (status && status !== 'all') clauses.push(eq(expenseRequests.status, status));
  if (mine) clauses.push(mineClause(ctx.user, expenseRequests));

  const { rows, nextCursor } = await ctx.query(expenseRequests, {
    where: clauses.length ? and(...clauses) : undefined,
    orderBy: searchParams.sort
      ? { column: searchParams.sort, dir: searchParams.dir === 'asc' ? 'asc' : 'desc' }
      : { column: 'createdAt', dir: 'desc' },
    cursor: searchParams.cursor,
    limit: 20,
  });

  return (
    <div>
      <PageHeader title={mine ? 'My requests' : 'Expense queue'} />
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
        appId="template"
        table="expense_requests"
        nextCursor={nextCursor}
        onRowClick="/a/template/detail?id={id}"
        columns={[
          { key: 'title', label: 'Title' },
          { key: 'amountCents', label: 'Amount', format: 'money' },
          { key: 'status', label: 'Status', format: 'status' },
          { key: 'assigneeId', label: 'Assignee' },
          { key: 'dueAt', label: 'Due', format: 'date' },
          { key: 'employeeEmail', label: 'Employee email', sensitive: true },
        ]}
        rows={rows}
      />
      <div className="mt-8 max-w-md rounded border p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">New expense request</h2>
        <ActionForm actionId="template.create" fields={fieldsFromSchema(createInput)} submitLabel="Create draft" />
      </div>
    </div>
  );
}
