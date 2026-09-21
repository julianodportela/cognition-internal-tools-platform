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
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button variant="ghost" onClick={() => decide('platform.approve')} disabled={pending}>
        Approve
      </Button>
      <Button variant="danger" onClick={() => decide('platform.reject')} disabled={pending}>
        Reject
      </Button>
    </span>
  );
}
