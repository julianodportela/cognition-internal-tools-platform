'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runAction } from '@platform/actions/run-action';
import { Button, Card, Alert, DescriptionList } from '@platform/ui/primitives';
import { ConfirmDialog } from '@platform/ui/dialogs';
import { Icon } from '@platform/ui/icons';

interface Props {
  id: string;
  status: string;
  amountCents: number;
  assigneeId: string | null;
  requesterId: string;
  employeeEmail: string | null;
}

type Pending = { actionId: string; input: Record<string, unknown>; label: string } | null;

export function RequestCard({ id, status, amountCents, assigneeId, requesterId, employeeEmail }: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; node: ReactNode } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (actionId: string, input: Record<string, unknown>, navigate = false) => {
    setConfirm(null);
    startTransition(async () => {
      const res = await runAction(actionId, input);
      if (res.status === 'ok') {
        setBanner({ tone: 'ok', node: 'Done.' });
        if (navigate) router.push('/a/template');
        else router.refresh();
      } else if (res.status === 'needs_approval') {
        setBanner({
          tone: 'ok',
          node: (
            <span>
              Sent for approval.{' '}
              <Link href="/inbox" className="ll-link">
                Track it in the Inbox <Icon name="arrow-right" size={12} />
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

  const buttons: ReactNode[] = [];
  if (status === 'draft') {
    buttons.push(
      <Button key="submit" onClick={() => run('template.submit', { id })} disabled={pending}>
        Submit
      </Button>,
    );
  }
  if (status === 'submitted' && !assigneeId) {
    buttons.push(
      <Button key="claim" variant="ghost" onClick={() => run('template.claim', { id })} disabled={pending}>
        Claim
      </Button>,
    );
  }
  if (status === 'submitted') {
    buttons.push(
      <Button key="approve" onClick={() => ask('template.approve', { id }, 'Approve this request?')} disabled={pending}>
        Approve
      </Button>,
      <Button key="reject" variant="danger" onClick={() => ask('template.reject', { id }, 'Reject this request?')} disabled={pending}>
        Reject
      </Button>,
    );
  }
  if (status === 'approved') {
    buttons.push(
      <Button key="pay" onClick={() => ask('template.pay', { id, txnId: `txn-${id}` }, 'Pay out via the payments processor?')} disabled={pending}>
        Pay out
      </Button>,
    );
  }
  buttons.push(
    <Button key="archive" variant="ghost" onClick={() => ask('template.archive', { id }, 'Archive (soft-delete) this request?')} disabled={pending}>
      Archive
    </Button>,
  );

  return (
    <Card title="Request">
      {banner && (
        <div className="mb-3">
          <Alert tone={banner.tone}>{banner.node}</Alert>
        </div>
      )}
      <div className="mb-4">
        <DescriptionList
          items={[
            { label: 'Amount', value: <span className="tabular-nums">${(amountCents / 100).toFixed(2)}</span> },
            { label: 'Requester', value: requesterId },
            { label: 'Assignee', value: assigneeId ?? '—' },
            { label: 'Employee email', value: employeeEmail ?? '—' },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.label ?? ''}
        body="This runs a platform action; everything is audited."
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm.actionId, confirm.input, confirm.actionId === 'template.archive')}
      />
    </Card>
  );
}
