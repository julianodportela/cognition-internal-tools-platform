'use client';

import { useState, useTransition } from 'react';
import type { ZodObject, ZodRawShape } from 'zod';
import { z } from 'zod';
import { Button, Input, Select } from './primitives';
import { runAction } from '@platform/actions/run-action';
import type { MutateResult } from '@platform/actions/define';

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
}

function zodKind(t: z.ZodType): FieldDef['type'] {
  let inner: z.ZodType = t;
  // unwrap optional/nullable/default
  for (;;) {
    const def = (inner as z.ZodType & { _def: { type?: string; innerType?: z.ZodType } })._def;
    if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default' || def.type === 'readonly') {
      inner = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === 'number' || def.type === 'int') return 'number';
    if (def.type === 'boolean') return 'checkbox';
    if (def.type === 'enum') return 'select';
    return 'text';
  }
}

export function fieldsFromSchema(schema: ZodObject<ZodRawShape>): FieldDef[] {
  const shape = schema.shape;
  return Object.entries(shape).map(([name, t]) => {
    const def = (t as z.ZodType & { _def: { type?: string; values?: string[] } })._def;
    const type = zodKind(t as z.ZodType);
    const required = def.type !== 'optional' && def.type !== 'default';
    const options =
      type === 'select' && def.values
        ? (def.values as string[]).map((v) => ({ value: v, label: v }))
        : undefined;
    return { name, label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), type, options, required };
  });
}

export function ActionForm({
  actionId,
  schema,
  fields,
  submitLabel = 'Submit',
  onDone,
}: {
  actionId: string;
  schema?: ZodObject<ZodRawShape>;
  fields?: FieldDef[];
  submitLabel?: string;
  onDone?: (res: MutateResult) => void;
}) {
  const defs = fields ?? (schema ? fieldsFromSchema(schema) : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: Record<string, unknown> = {};
    for (const f of defs) {
      const raw = fd.get(f.name);
      if (f.type === 'number') input[f.name] = raw === '' || raw == null ? undefined : Number(raw);
      else if (f.type === 'checkbox') input[f.name] = raw === 'on';
      else input[f.name] = raw ?? undefined;
    }
    setErrors({});
    startTransition(async () => {
      const res = await runAction(actionId, input);
      if (res.status === 'ok') {
        setBanner({ tone: 'ok', text: 'Done.' });
        onDone?.(res);
      } else if (res.status === 'validation_error') {
        const map: Record<string, string> = {};
        for (const i of res.issues) map[i.path] = i.message;
        setErrors(map);
        setBanner({ tone: 'err', text: 'Please fix the highlighted fields.' });
      } else if (res.status === 'needs_approval') {
        setBanner({ tone: 'info', text: `Submitted for approval (${res.requestId}).` });
      } else {
        setBanner({ tone: 'err', text: `${res.code}: ${res.message}` });
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {banner && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            banner.tone === 'ok'
              ? 'bg-green-50 text-green-800'
              : banner.tone === 'info'
                ? 'bg-blue-50 text-blue-800'
                : 'bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}
      {defs.map((f) => (
        <div key={f.name}>
          <label className="mb-1 block text-sm font-medium text-slate-700">{f.label}</label>
          {f.type === 'select' ? (
            <Select name={f.name} required={f.required}>
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          ) : f.type === 'checkbox' ? (
            <input type="checkbox" name={f.name} className="h-4 w-4" />
          ) : (
            <Input name={f.name} type={f.type === 'number' ? 'number' : 'text'} required={f.required} />
          )}
          {errors[f.name] && <p className="mt-1 text-xs text-red-600">{errors[f.name]}</p>}
        </div>
      ))}
      <Button type="submit" disabled={pending}>{pending ? 'Working…' : submitLabel}</Button>
    </form>
  );
}
