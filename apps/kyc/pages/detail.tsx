import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getReadCtx } from '@platform/data/read';
import { StageBar } from '@platform/ui/stage-bar';
import { Notes, type NoteRow } from '@platform/ui/notes';
import { FileList, type AttachmentRow } from '@platform/ui/file-list';
import { PageHeader, StatusBadge, Badge, Card } from '@platform/ui/primitives';
import { kycReviews } from '../schema';
import { kycFlow } from '../actions';
import { CaseCard } from '../components/CaseCard';

const OPEN_STATUSES = new Set(['pending', 'in_review']);
const RISK_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
};

export default async function DetailPage({
  searchParams,
}: {
  subpath: string[];
  searchParams: Record<string, string | undefined>;
}) {
  const id = searchParams.id;
  if (!id) notFound();
  const ctx = await getReadCtx('kyc');
  const { rows } = await ctx.query(kycReviews, {
    where: eq(kycReviews.id, id),
    limit: 1,
  });
  const row = rows[0];
  if (!row) notFound();

  const [noteRows, fileRows] = await Promise.all([
    ctx.listNotes('kyc_reviews', id),
    ctx.listAttachments('kyc_reviews', id),
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
  const riskScore = String(row.riskScore);
  const overdue =
    OPEN_STATUSES.has(status) &&
    row.dueAt != null &&
    new Date(String(row.dueAt)).getTime() < new Date().getTime();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={String(row.customerRef)}>
        <StatusBadge status={status} />{' '}
        <Badge tone={RISK_TONE[riskScore] ?? 'slate'}>risk: {riskScore}</Badge>{' '}
        {overdue && <Badge tone="red">OVERDUE</Badge>}
      </PageHeader>
      <StageBar states={kycFlow.def.states} current={status} />
      <CaseCard
        id={id}
        status={status}
        customerRef={String(row.customerRef)}
        fullName={row.fullName == null ? null : String(row.fullName)}
        dateOfBirth={row.dateOfBirth == null ? null : String(row.dateOfBirth)}
        country={String(row.country)}
        idDocumentType={String(row.idDocumentType)}
        idDocumentNumber={row.idDocumentNumber == null ? null : String(row.idDocumentNumber)}
        riskScore={riskScore}
        assigneeId={row.assigneeId == null ? null : String(row.assigneeId)}
        currentUserId={ctx.user.id}
        dueAt={row.dueAt == null ? null : String(row.dueAt)}
        decidedBy={row.decidedBy == null ? null : String(row.decidedBy)}
        decisionReason={row.decisionReason == null ? null : String(row.decisionReason)}
        resubmissionCount={Number(row.resubmissionCount)}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <Notes appId="kyc" entity="kyc_reviews" entityId={id} notes={notes} />
        </Card>
        <Card>
          <FileList appId="kyc" entity="kyc_reviews" entityId={id} files={files} />
        </Card>
      </div>
    </div>
  );
}
