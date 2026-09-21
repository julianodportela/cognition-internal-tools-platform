'use client';

import { useState, useTransition } from 'react';
import { Button } from './primitives';
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
      <h3 className="text-sm font-semibold text-slate-700">Notes</h3>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded border p-2 text-sm">
            <div className="text-xs text-slate-400">
              {n.authorId} · {new Date(n.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{n.body}</div>
          </li>
        ))}
        {notes.length === 0 && <li className="text-sm text-slate-400">No notes yet.</li>}
      </ul>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button onClick={add} disabled={pending}>Add</Button>
      </div>
    </div>
  );
}
