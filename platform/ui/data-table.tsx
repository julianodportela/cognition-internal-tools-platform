'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Badge, Button, EmptyState, StatusBadge } from './primitives';
import { Icon } from './icons';
import { runAction } from '@platform/actions/run-action';

export interface ColumnDef {
  key: string;
  label: string;
  sensitive?: boolean;
  /** Serializable cell formats — safe across the server->client boundary. */
  format?: 'money' | 'date' | 'status';
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
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="font-mono text-[13px] tracking-wider text-ink-400">{v}</span>
          <button
            className="ll-link inline-flex items-center gap-1 text-xs"
            disabled={pending}
            onClick={(e) => { e.stopPropagation(); void reveal(id, c.key); }}
          >
            <Icon name="eye" size={12} /> Reveal
          </button>
        </span>
      );
    }
    if (c.format === 'money') return <span className="tabular-nums">${(Number(v) / 100).toFixed(2)}</span>;
    if (c.format === 'date') return <span className="whitespace-nowrap text-ink-500">{v ? new Date(String(v)).toLocaleDateString() : '—'}</span>;
    if (c.format === 'status') return <StatusBadge status={String(v)} />;
    if (c.render) return c.render(v);
    if (v === true || v === 'true') return <Badge tone="green">on</Badge>;
    if (v === false || v === 'false') return <Badge tone="slate">off</Badge>;
    return v == null ? '—' : String(v);
  };

  return (
    <div className="space-y-3">
      {error && <Alert tone="err">{error}</Alert>}
      {bulkActions && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
          <span className="text-sm font-medium text-brand-700">{selected.size} selected</span>
          {bulkActions.map((b) => (
            <Button key={b.actionId} size="sm" variant="ghost" onClick={() => runBulk(b.actionId)}>
              {b.label}
            </Button>
          ))}
        </div>
      )}
      <div className="ll-card overflow-x-auto">
      <table className="ll-table">
        <thead>
          <tr className="text-left">
            {bulkActions && <th className="w-8" />}
            {columns.map((c) => {
              const sorted = params.get('sort') === c.key;
              return (
              <th key={c.key}>
                <button
                  className={`inline-flex items-center gap-1 hover:text-ink-900 ${sorted ? 'text-ink-900' : ''}`}
                  onClick={() => goto({ sort: c.key, dir: params.get('dir') === 'asc' ? 'desc' : 'asc', cursor: '' })}
                >
                  {c.label}
                  {sorted && (
                    <Icon
                      name={params.get('dir') === 'asc' ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      className="text-brand-600"
                    />
                  )}
                </button>
              </th>
            );})}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const id = String(row.id ?? i);
            return (
              <tr
                key={id}
                data-clickable={onRowClick ? 'true' : undefined}
                className={selected.has(id) ? 'bg-brand-50/40' : undefined}
                onClick={() => onRowClick && router.push(onRowClick.replace('{id}', id))}
              >
                {bulkActions && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-brand-600" checked={selected.has(id)} onChange={() => toggle(id)} />
                  </td>
                )}
                {columns.map((c, ci) => (
                  <td key={c.key} className={ci === 0 ? 'whitespace-nowrap' : undefined}>{cell(row, c)}</td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td className="!p-0" colSpan={columns.length + 1}><EmptyState title="Nothing here yet" hint="Rows will appear as records are created." /></td></tr>
          )}
        </tbody>
      </table>
      </div>
      {nextCursor && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => goto({ cursor: nextCursor })}>Next page <Icon name="arrow-right" size={12} /></Button>
        </div>
      )}
    </div>
  );
}
