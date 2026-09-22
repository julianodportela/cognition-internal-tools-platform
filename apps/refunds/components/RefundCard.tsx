'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runAction } from '@platform/actions/run-action';
import { Button, Card, Alert, DescriptionList, Field, Input } from '@platform/ui/primitives';
import { ConfirmDialog } from '@platform/ui/dialogs';
import { Icon } from '@platform/ui/icons';

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

  const canRequest = props.status === 'settled';

  return (
    <Card title="Refund">
      {banner && (
        <div className="mb-3">
          <Alert tone={banner.tone}>{banner.node}</Alert>
        </div>
      )}
      <div className="mb-4">
        <DescriptionList
          items={[
            { label: 'Amount', value: <span className="tabular-nums">${(props.amountCents / 100).toFixed(2)}</span> },
            { label: 'Customer email', value: props.customerEmail ?? '—' },
            { label: 'Card', value: props.cardLast4 ?? '—' },
            { label: 'Occurred', value: props.occurredAt.slice(0, 10) },
          ]}
        />
      </div>

      {props.refunds.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-ink-700">Refund history</h3>
          <ul className="space-y-1 text-sm">
            {props.refunds.map((r) => (
              <li key={r.id} className="flex justify-between border-b border-line py-1">
                <span className="tabular-nums">
                  ${(r.amountCents / 100).toFixed(2)} — {r.reason}
                </span>
                <span className="text-ink-500">
                  {r.status} · {r.requesterId}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRequest && (
        <div className="mb-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Refund reason (required)">
              <Input
                placeholder="Why is this customer being refunded?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
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

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.label ?? ''}
        body="This runs a platform action; everything is audited. Refunds of $100 or more need a finance sign-off first."
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm.actionId, confirm.input)}
      />
    </Card>
  );
}
