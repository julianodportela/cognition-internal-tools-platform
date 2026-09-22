'use client';

import { useState, useTransition } from 'react';
import { Button } from './primitives';
import { runAction } from '@platform/actions/run-action';
import { useRouter } from 'next/navigation';

export function ApprovalButtons({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const decide = (action: 'platform.approve' | 'platform.reject') => {
    startTransition(async () => {
      const input =
        action === 'platform.reject' ? { requestId, reason: 'rejected via inbox' } : { requestId };
      const res = await runAction(action, input);
      if (res.status === 'ok') router.refresh();
      else setError(res.status === 'failed' ? res.message : 'Decision failed');
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-danger-600">{error}</span>}
      <Button size="sm" onClick={() => decide('platform.approve')} disabled={pending}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" className="text-danger-700 hover:border-danger-600/40 hover:bg-danger-50" onClick={() => decide('platform.reject')} disabled={pending}>
        Reject
      </Button>
    </span>
  );
}
