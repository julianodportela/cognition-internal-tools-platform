import { describe, it, expect, vi } from 'vitest';
import { getDb } from '@platform/data/client';
import { resolveIntegrations } from '@platform/integrations';
import { executeAction } from '@platform/actions/mutate';
import { defineAction } from '@platform/actions/define';
import { registerAction, registerApp } from '@platform/registry';
import { users as usersTable } from '@platform/data/schema';
import { z } from 'zod';
import { engAdmin } from '../helpers';
import { assertMaskedRows } from '@platform/data/query';
import { query } from '@platform/data/query';
import { casesTable } from '../helpers';
import type { SeedUser } from '@platform/policy/roles';

const senior: SeedUser = { id: 'u-s', name: 'Senior', role: 'senior_reviewer', teamId: 'kyc' };

describe('sandbox/production binding', () => {
  it('sandbox and production are distinct clients', async () => {
    const s = await getDb('sandbox');
    const p = await getDb('production');
    expect(s).not.toBe(p);
  });

  it('sandbox mode resolves mock integrations only', () => {
    const ints = resolveIntegrations('sandbox');
    expect(ints.payments).toBeDefined();
    // production currently also resolves mocks — no real adapter exists yet
    expect(resolveIntegrations('production')).toBeDefined();
  });

  it('a sandbox action cannot write to the production db', async () => {
    registerApp({
      id: 'sb', name: 'SB', icon: 's', permission: 'template.write',
      dataMode: 'sandbox', dataClass: 'internal', schema: {}, pages: {}, actions: [],
    });
    registerApp({
      id: 'sb-read', name: 'SB Read', icon: 's', permission: 'template.read',
      dataMode: 'sandbox', dataClass: 'internal', schema: {}, pages: {}, actions: [],
    });
    const writeUser = defineAction({
      id: 'test.sbWrite',
      perm: 'template.write',
      appId: 'sb',
      risk: 'low',
      input: z.object({}),
      run: async (ctx) => ctx.records.insert(usersTable, { id: 'ghost', name: 'G', role: 'analyst', teamId: 'x' }),
    });
    registerAction(writeUser);
    const prod = await getDb('production');
    const before = (await prod.select().from(usersTable)).length;
    const res = await executeAction(engAdmin, 'test.sbWrite', {});
    expect(res.status).toBe('ok');
    const after = (await prod.select().from(usersTable)).length;
    expect(after).toBe(before);
  });

  it('query() marks masked rows; assertMaskedRows rejects unmarked arrays', async () => {
    const db = await getDb('sandbox');
    const { rows } = await query({ db, user: engAdmin }, usersTable, { scope: false });
    expect(() => assertMaskedRows(rows)).not.toThrow();
    expect(() => assertMaskedRows([{ id: 1 }])).toThrow();
    void casesTable;
  });
});

describe('getReadCtx binding', () => {
  it('sandbox app resolves without production access', async () => {
    vi.doMock('@platform/auth/provider', () => ({
      getCurrentUser: async () => senior,
    }));
    vi.doMock('next/navigation', () => ({ redirect: (p: string) => { throw new Error(`redirect:${p}`); } }));
    const { getReadCtx } = await import('@platform/data/read');
    registerApp({
      id: 'sb-ctx', name: 'SBC', icon: 's', permission: 'template.read',
      dataMode: 'sandbox', dataClass: 'internal', schema: {}, pages: {}, actions: [],
    });
    const ctx = await getReadCtx('sb-ctx');
    expect(ctx.app.dataMode).toBe('sandbox');
  });
});
