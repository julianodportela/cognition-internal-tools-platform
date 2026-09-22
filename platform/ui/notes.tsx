'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Input } from './primitives';
import { Icon } from './icons';
import { runAction } from '@platform/actions/run-action';
import { useRouter } from 'next/navigation';

export interface NoteRow {
  id: number;
  authorId: string;
  body: string;
  createdAt: string | Date;
}

export function Notes({
  appId,
  entity,
  entityId,
  notes,
}: {
  appId: string;
  entity: string;
  entityId: string;
  notes: NoteRow[];
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const add = () => {
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await runAction('platform.addNote', { appId, entity, entityId, body });
      if (res.status === 'ok') {
        setBody('');
        setError(null);
        router.refresh();
      } else {
        setError(res.status === 'failed' ? res.message : 'Could not add note');
      }
    });
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Icon name="note" size={14} /> Notes</h3>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-md border border-line bg-ink-50/60 px-3 py-2 text-sm">
            <div className="mb-0.5 text-[11px] text-ink-400">
              <span className="font-medium text-ink-600">{n.authorId}</span> · {new Date(n.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap text-ink-800">{n.body}</div>
          </li>
        ))}
        {notes.length === 0 && <li className="text-sm text-ink-400">No notes yet.</li>}
      </ul>
      {error && <Alert tone="err">{error}</Alert>}
      <div className="flex gap-2">
        <Input
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <Button variant="ghost" onClick={add} disabled={pending}>Add</Button>
      </div>
    </div>
  );
}
