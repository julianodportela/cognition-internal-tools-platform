'use client';

import { useRef, useState, useTransition } from 'react';
import { Alert, Button } from './primitives';
import { Icon } from './icons';
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
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Icon name="paperclip" size={14} /> Attachments</h3>
      <ul className="space-y-1.5">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-ink-50/60 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white text-[10px] font-bold uppercase text-ink-500 ring-1 ring-inset ring-line">
                {f.filename.split('.').pop()?.slice(0, 4)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink-800">{f.filename}</span>
                <span className="block text-[11px] text-ink-400">{Math.round(f.size / 1024)} KB · {f.uploadedBy}</span>
              </span>
            </span>
            <button className="ll-link flex items-center gap-1 text-xs" onClick={() => open(f.id)} disabled={pending}>
              Open <Icon name="arrow-right" size={12} />
            </button>
          </li>
        ))}
        {files.length === 0 && <li className="text-sm text-ink-400">No files.</li>}
      </ul>
      {error && <Alert tone="err">{error}</Alert>}
      <div className="flex items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="flex-1 text-sm text-ink-500 file:mr-3 file:rounded-md file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-700 hover:file:bg-ink-50"
        />
        <Button variant="ghost" onClick={upload} disabled={pending}><Icon name="upload" size={12} /> Upload</Button>
      </div>
    </div>
  );
}
