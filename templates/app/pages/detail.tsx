import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { StageBar } from '@platform/ui/stage-bar';
import { Notes, type NoteRow } from '@platform/ui/notes';
import { FileList, type AttachmentRow } from '@platform/ui/file-list';
import { PageHeader, StatusBadge, Card } from '@platform/ui/primitives';
import { expenseRequests } from '../schema';
import { expenseFlow } from '../actions';
import { RequestCard } from '../components/RequestCard';

export default async function DetailPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const id = searchParams.id;
  if (!id) notFound();
  const ctx = await getReadCtx('template');
  const { rows } = await ctx.query(expenseRequests, {
    where: eq(expenseRequests.id, id),
    limit: 1,
  });
  const row = rows[0];
  if (!row) notFound();

  const [noteRows, fileRows] = await Promise.all([
    ctx.listNotes('expense_requests', id),
    ctx.listAttachments('expense_requests', id),
  ]);
  const notes: NoteRow[] = noteRows.map((n) => ({
    id: Number(n.id),
    authorId: String(n.authorId),
    body: String(n.body),
    createdAt: String(n.createdAt),
  }));
  const files: AttachmentRow[] = fileRows.map((f) => ({
    id: Number(f.id),
    filename: String(f.filename),
    contentType: String(f.contentType),
    size: Number(f.size),
    uploadedBy: String(f.uploadedBy),
    createdAt: String(f.createdAt),
  }));

  const status = String(row.status);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={String(row.title)}>
        <StatusBadge status={status} />
      </PageHeader>
      <StageBar states={expenseFlow.def.states} current={status} />
      <RequestCard
        id={id}
        status={status}
        amountCents={Number(row.amountCents)}
        assigneeId={row.assigneeId == null ? null : String(row.assigneeId)}
        requesterId={String(row.requesterId)}
        employeeEmail={row.employeeEmail == null ? null : String(row.employeeEmail)}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <Notes appId="template" entity="expense_requests" entityId={id} notes={notes} />
        </Card>
        <Card>
          <FileList appId="template" entity="expense_requests" entityId={id} files={files} />
        </Card>
      </div>
    </div>
  );
}
