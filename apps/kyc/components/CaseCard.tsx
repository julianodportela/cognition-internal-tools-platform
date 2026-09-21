'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runAction } from '@platform/actions/run-action';
import { Button, Input } from '@platform/ui/primitives';
import { ConfirmDialog } from '@platform/ui/dialogs';

interface Props {
  id: string;
  status: string;
  customerRef: string;
  fullName: string | null;
  dateOfBirth: string | null;
  country: string;
  idDocumentType: string;
  idDocumentNumber: string | null;
  riskScore: string;
  assigneeId: string | null;
  currentUserId: string;
  dueAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  resubmissionCount: number;
}

type Pending = { actionId: string; input: Record<string, unknown>; label: string } | null;

export function CaseCard({
  id,
  status,
  fullName,
  dateOfBirth,
  country,
  idDocumentType,
  idDocumentNumber,
  riskScore,
  assigneeId,
  currentUserId,
  dueAt,
  decidedBy,
  decisionReason,
  resubmissionCount,
}: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; node: ReactNode } | null>(null);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const run = (actionId: string, input: Record<string, unknown>) => {
    setConfirm(null);
    startTransition(async () => {
      const res = await runAction(actionId, input);
      if (res.status === 'ok') {
        setBanner({ tone: 'ok', node: 'Done.' });
        router.refresh();
      } else if (res.status === 'needs_approval') {
        setBanner({
          tone: 'ok',
          node: (
            <span>
              Sent for approval.{' '}
              <Link href="/inbox" className="underline">
                Track it in the Inbox →
              </Link>
            </span>
          ),
        });
        router.refresh();
      } else if (res.status === 'validation_error') {
        setBanner({ tone: 'err', node: res.issues.map((i) => `${i.path}: ${i.message}`).join('; ') });
      } else {
        setBanner({ tone: 'err', node: `${res.code}: ${res.message}` });
      }
    });
  };

  const ask = (actionId: string, input: Record<string, unknown>, label: string) =>
    setConfirm({ actionId, input, label });

  const decide = (actionId: 'kyc.approve' | 'kyc.reject', label: string) => {
    const trimmed = reason.trim();
    if (actionId === 'kyc.reject' && !trimmed) {
      setBanner({ tone: 'err', node: 'A reason is required to reject a case.' });
      return;
    }
    ask(actionId, trimmed ? { id, reason: trimmed } : { id }, label);
  };

  const buttons: ReactNode[] = [];
  if (status === 'pending' && !assigneeId) {
    buttons.push(
      <Button key="claim" variant="ghost" onClick={() => run('kyc.claim', { id })} disabled={pending}>
        Claim
      </Button>,
    );
  }
  if (status === 'in_review' && assigneeId === currentUserId) {
    buttons.push(
      <Button key="approve" onClick={() => decide('kyc.approve', 'Approve this case?')} disabled={pending}>
        Approve
      </Button>,
      <Button key="reject" variant="danger" onClick={() => decide('kyc.reject', 'Reject this case?')} disabled={pending}>
        Reject
      </Button>,
    );
  }
  if (status === 'rejected' && resubmissionCount < 1) {
    buttons.push(
      <Button
        key="reopen"
        variant="ghost"
        onClick={() => ask('kyc.reopen', { id }, 'Reopen this case for re-review?')}
        disabled={pending}
      >
        Reopen for re-review
      </Button>,
    );
  }

  return (
    <div className="rounded border p-4">
      {banner && (
        <div
          className={`mb-3 rounded px-3 py-2 text-sm ${
            banner.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {banner.node}
        </div>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-slate-500">Full name</dt>
        <dd>{fullName ?? '—'}</dd>
        <dt className="text-slate-500">Date of birth</dt>
        <dd>{dateOfBirth ?? '—'}</dd>
        <dt className="text-slate-500">Country</dt>
        <dd>{country}</dd>
        <dt className="text-slate-500">Document type</dt>
        <dd>{idDocumentType}</dd>
        <dt className="text-slate-500">Document number</dt>
        <dd>{idDocumentNumber ?? '—'}</dd>
        <dt className="text-slate-500">Risk score</dt>
        <dd>{riskScore}</dd>
        <dt className="text-slate-500">Assignee</dt>
        <dd>{assigneeId ?? '—'}</dd>
        <dt className="text-slate-500">Due</dt>
        <dd>{dueAt ? new Date(dueAt).toLocaleString() : '—'}</dd>
        <dt className="text-slate-500">Decided by</dt>
        <dd>{decidedBy ?? '—'}</dd>
        <dt className="text-slate-500">Decision reason</dt>
        <dd>{decisionReason ?? '—'}</dd>
        <dt className="text-slate-500">Resubmissions</dt>
        <dd>{resubmissionCount}</dd>
      </dl>
      {status === 'in_review' && assigneeId === currentUserId && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-500">
            Decision reason (required to reject)
          </label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for the decision"
            maxLength={1000}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">{buttons}</div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.label ?? ''}
        body="This runs a platform action; everything is audited."
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm.actionId, confirm.input)}
      />
    </div>
  );
}
