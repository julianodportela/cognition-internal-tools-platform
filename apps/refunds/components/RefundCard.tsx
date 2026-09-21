'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runAction } from '@platform/actions/run-action';
import { Button } from '@platform/ui/primitives';
import { ConfirmDialog } from '@platform/ui/dialogs';

interface RefundRow {
  id: string;
  status: string;
  amountCents: number;
  reason: string;
  requesterId: string;
}

interface Props {
  id: string;
  status: string;
  amountCents: number;
  customerEmail: string | null;
  cardLast4: string | null;
  occurredAt: string;
  refunds: RefundRow[];
  latestRefundId: string | null;
  latestRefundStatus: string | null;
}

type Pending = { actionId: string; input: Record<string, unknown>; label: string } | null;

export function RefundCard(props: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; node: ReactNode } | null>(null);
  const [reason, setReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
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

  const canRequest = props.status === 'settled';
  const canReject = props.latestRefundId != null && props.latestRefundStatus === 'issued';

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
        <dt className="text-slate-500">Amount</dt>
        <dd>${(props.amountCents / 100).toFixed(2)}</dd>
        <dt className="text-slate-500">Customer email</dt>
        <dd>{props.customerEmail ?? '—'}</dd>
        <dt className="text-slate-500">Card</dt>
        <dd>{props.cardLast4 ?? '—'}</dd>
        <dt className="text-slate-500">Occurred</dt>
        <dd>{props.occurredAt.slice(0, 10)}</dd>
      </dl>

      {props.refunds.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Refund history</h3>
          <ul className="space-y-1 text-sm">
            {props.refunds.map((r) => (
              <li key={r.id} className="flex justify-between border-b py-1">
                <span>
                  ${(r.amountCents / 100).toFixed(2)} — {r.reason}
                </span>
                <span className="text-slate-500">
                  {r.status} · {r.requesterId}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRequest && (
        <div className="mb-3 flex items-center gap-2">
          <input
            className="flex-1 rounded border px-2 py-1 text-sm"
            placeholder="Refund reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            onClick={() =>
              setConfirm({
                actionId: 'refunds.request',
                input: { transactionId: props.id, reason },
                label: `Refund $${(props.amountCents / 100).toFixed(2)} to this customer?`,
              })
            }
            disabled={pending || reason.trim().length === 0}
          >
            Request refund
          </Button>
        </div>
      )}

      {canReject && props.latestRefundId && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border px-2 py-1 text-sm"
            placeholder="Rejection reason (required)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <Button
            variant="danger"
            onClick={() =>
              setConfirm({
                actionId: 'refunds.reject',
                input: { id: props.latestRefundId, reason: rejectReason },
                label: 'Reject this refund?',
              })
            }
            disabled={pending || rejectReason.trim().length === 0}
          >
            Reject refund
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.label ?? ''}
        body="This runs a platform action; everything is audited. Refunds of $100 or more need a finance sign-off first."
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm.actionId, confirm.input)}
      />
    </div>
  );
}
