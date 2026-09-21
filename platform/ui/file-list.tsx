'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from './primitives';
import { runAction } from '@platform/actions/run-action';
import { useRouter } from 'next/navigation';

export interface AttachmentRow {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string | Date;
}

export function FileList({
  appId,
  entity,
  entityId,
  files,
}: {
  appId: string;
  entity: string;
  entityId: string;
  files: AttachmentRow[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const upload = () => {
    const file = input.current?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1];
      startTransition(async () => {
        const res = await runAction('platform.uploadAttachment', {
          appId, entity, entityId,
          filename: file.name,
          contentType: file.type,
          dataBase64: b64,
        });
        if (res.status === 'ok') {
          setError(null);
          if (input.current) input.current.value = '';
          router.refresh();
        } else {
          setError(res.status === 'failed' ? res.message : 'Upload failed');
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const open = (id: number) => {
    startTransition(async () => {
      const res = await runAction('platform.getAttachmentUrl', { appId, attachmentId: String(id) });
      if (res.status === 'ok') {
        const { url } = res.data as { url: string };
        window.open(url, '_blank');
      } else {
        setError(res.status === 'failed' ? res.message : 'Could not open file');
      }
    });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Attachments</h3>
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
            <span>
              {f.filename} <span className="text-xs text-slate-400">({Math.round(f.size / 1024)}KB · {f.uploadedBy})</span>
            </span>
            <button className="text-blue-600 underline text-xs" onClick={() => open(f.id)} disabled={pending}>
              Open
            </button>
          </li>
        ))}
        {files.length === 0 && <li className="text-sm text-slate-400">No files.</li>}
      </ul>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2">
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-sm" />
        <Button variant="ghost" onClick={upload} disabled={pending}>Upload</Button>
      </div>
    </div>
  );
}
