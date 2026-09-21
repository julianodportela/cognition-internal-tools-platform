'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './primitives';
import { runAction } from '@platform/actions/run-action';

export interface ColumnDef {
  key: string;
  label: string;
  sensitive?: boolean;
  render?: (v: unknown) => React.ReactNode;
}

export function DataTableClient({
  columns,
  rows,
  nextCursor,
  table,
  onRowClick,
  bulkActions,
  appId,
}: {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  appId: string;
  table?: string;
  onRowClick?: string; // href template e.g. "/a/kyc/case/{id}"
  bulkActions?: { label: string; actionId: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Record<string, unknown>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const goto = (updates: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    router.push(`?${p.toString()}`);
  };

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const reveal = async (rowId: string, col: string) => {
    if (!table) return;
    const res = await runAction('platform.revealField', { appId, table, column: col, rowId });
    if (res.status === 'ok') {
      const v = (res.data as { value: unknown }).value;
      setRevealed((r) => ({ ...r, [`${rowId}.${col}`]: v }));
    } else {
      setError(res.status === 'failed' ? res.message : 'Reveal denied');
    }
  };

  const runBulk = (actionId: string) => {
    startTransition(async () => {
      for (const id of selected) {
        await runAction(actionId, { id });
      }
      setSelected(new Set());
      router.refresh();
    });
  };

  const cell = (row: Record<string, unknown>, c: ColumnDef) => {
    const id = String(row.id ?? '');
    const key = `${id}.${c.key}`;
    const v = row[c.key];
    const isMasked = typeof v === 'string' && v.startsWith('••••');
    if (key in revealed) return String(revealed[key]);
    if (isMasked && c.sensitive) {
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-slate-400">🔒 {v}</span>
          <button
            className="text-xs text-blue-600 underline"
            disabled={pending}
            onClick={(e) => { e.stopPropagation(); void reveal(id, c.key); }}
          >
            Reveal
          </button>
        </span>
      );
    }
    if (c.render) return c.render(v);
    return v == null ? '—' : String(v);
  };

  return (
    <div>
      {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {bulkActions && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm text-slate-600">{selected.size} selected</span>
          {bulkActions.map((b) => (
            <Button key={b.actionId} variant="ghost" onClick={() => runBulk(b.actionId)}>
              {b.label}
            </Button>
          ))}
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            {bulkActions && <th className="w-8 p-2" />}
            {columns.map((c) => (
              <th key={c.key} className="p-2 font-medium">
                <button
                  className="hover:text-slate-900"
                  onClick={() => goto({ sort: c.key, dir: params.get('dir') === 'asc' ? 'desc' : 'asc', cursor: '' })}
                >
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const id = String(row.id ?? i);
            return (
              <tr
                key={id}
                className="border-b hover:bg-slate-50"
                onClick={() => onRowClick && router.push(onRowClick.replace('{id}', id))}
              >
                {bulkActions && (
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className="p-2">{cell(row, c)}</td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td className="p-4 text-center text-slate-400" colSpan={columns.length + 1}>No rows</td></tr>
          )}
        </tbody>
      </table>
      {nextCursor && (
        <div className="mt-3">
          <Button variant="ghost" onClick={() => goto({ cursor: nextCursor })}>Next page →</Button>
        </div>
      )}
    </div>
  );
}
