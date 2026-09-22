'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runAction } from '@platform/actions/run-action';
import { Button, Card, Alert, Field, Input } from '@platform/ui/primitives';
import { ConfirmDialog } from '@platform/ui/dialogs';
import { Icon } from '@platform/ui/icons';
import { isRestricted } from '../actions';

interface Props {
  id: string;
  version: number;
  archived: boolean;
  tags: string;
  stagingEnabled: boolean;
  stagingRollout: number;
  productionEnabled: boolean;
  productionRollout: number;
  canToggle: boolean;
}

export function FlagControls(props: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; node: ReactNode } | null>(null);
  const [stagingOn, setStagingOn] = useState(props.stagingEnabled);
  const [stagingRollout, setStagingRollout] = useState(props.stagingRollout);
  const [prodOn, setProdOn] = useState(props.productionEnabled);
  const [prodRollout, setProdRollout] = useState(props.productionRollout);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();

  const restricted = isRestricted(props.tags);

  const run = (actionId: string, input: Record<string, unknown>) => {
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
              Submitted for approval ({res.requestId}).{' '}
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

  if (props.archived) {
    return <Alert tone="info">Archived — read only</Alert>;
  }
  if (!props.canToggle) return null;

  const allOff = !props.stagingEnabled && !props.productionEnabled;

  return (
    <Card title="Flag state">
      {banner && (
        <div className="mb-3">
          <Alert tone={banner.tone}>{banner.node}</Alert>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-700">Staging</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={stagingOn}
              onChange={(e) => setStagingOn(e.target.checked)}
            />
            Enabled
          </label>
          <div className="mt-2 w-24">
            <Field label="Rollout %">
              <Input
                type="number"
                min={0}
                max={100}
                className="tabular-nums"
                value={stagingRollout}
                onChange={(e) => setStagingRollout(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button
              disabled={pending}
              onClick={() =>
                run('flags.setStaging', {
                  id: props.id,
                  expectedVersion: props.version,
                  enabled: stagingOn,
                  rollout: stagingRollout,
                })
              }
            >
              Apply to staging
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-400">Applies immediately; no approval needed.</p>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-700">Production</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prodOn}
              onChange={(e) => setProdOn(e.target.checked)}
            />
            Enabled
          </label>
          <div className="mt-2 w-24">
            <Field label="Rollout %">
              <Input
                type="number"
                min={0}
                max={100}
                className="tabular-nums"
                value={prodRollout}
                onChange={(e) => setProdRollout(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button
              disabled={pending}
              onClick={() =>
                run(restricted ? 'flags.setProductionRestricted' : 'flags.setProduction', {
                  id: props.id,
                  expectedVersion: props.version,
                  enabled: prodOn,
                  rollout: prodRollout,
                })
              }
            >
              Request production change
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {restricted
              ? 'Tagged payments/kyc — needs an engineering admin to approve.'
              : 'Needs a second engineer to approve.'}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Button
          variant="danger"
          disabled={pending || !allOff}
          onClick={() => setConfirmArchive(true)}
        >
          Archive flag
        </Button>
        {!allOff && (
          <p className="mt-1 text-xs text-ink-400">
            Turn the flag off in staging and production before archiving.
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title="Archive this flag?"
        body="Archived flags are hidden and read-only. The row and its history are kept. This runs a platform action; everything is audited."
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          run('flags.archive', { id: props.id });
        }}
      />
    </Card>
  );
}
