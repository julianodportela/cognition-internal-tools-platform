import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { defineAction } from '@platform/actions/define';
import { executeAction } from '@platform/actions/mutate';
import { registerTestAction } from './register-action';
import { getDb } from '@platform/data/client';
import { analyst, engAdmin } from './helpers';
import type { DB } from '@platform/data/client';

let db: DB;
let runs = 0;

const closeCase = defineAction({
  id: 'test.closeCase',
  perm: 'test.close',
  input: z.object({ caseId: z.string(), ssn: z.string().optional() }),
  risk: 'low',
  run: async (ctx) => {
    runs++;
    await ctx.audit.record('kyc_cases', '42', { ssn: '123456789', status: 'open' }, { status: 'closed' });
    return { closed: true };
  },
});

const pingAction = defineAction({
  id: 'test.ping',
  perm: 'test.ping',
  input: z.object({ n: z.number() }),
  risk: 'low',
  idempotency: (i) => `ping-${i.n}`,
  run: async () => {
    runs++;
    return { pong: true };
  },
});

const limited = defineAction({
  id: 'test.limited',
  perm: 'test.limited',
  input: z.object({}),
  risk: 'low',
  rateLimit: { perUser: 2, perMinute: 1 },
  run: async () => 'ok',
});

const testUser = { ...engAdmin, role: 'eng_admin' as const };

// give test user the needed perms by patching roles at test time
import { roles } from '@platform/policy/roles';
(roles.eng_admin.permissions as string[]).push('test.close', 'test.ping', 'test.limited');

beforeAll(async () => {
  // vitest config sets SANDBOX_DATABASE_URL=memory:// so getDb returns an
  // in-memory PGlite migrated via drizzle/ and seeded.
  db = await getDb('sandbox');
  registerTestAction(closeCase);
  registerTestAction(pingAction);
  registerTestAction(limited);
});

describe('runAction', () => {
  it('happy path writes audit row with masked before/after', async () => {
    const res = await executeAction(testUser, 'test.closeCase', { caseId: '42', ssn: '123456789' });
    expect(res.status).toBe('ok');
    const audit = await db.execute(`SELECT entity, before_json, after_json FROM audit_log WHERE action_id='test.closeCase'`);
    const row = (audit.rows as Record<string, unknown>[])[0];
    expect(row.entity).toBe('kyc_cases');
    expect(String(row.before_json)).toContain('••••');
    expect(String(row.before_json)).not.toContain('123456789');
  });

  it('validation_error on bad input', async () => {
    const res = await executeAction(testUser, 'test.closeCase', { caseId: 5 });
    expect(res.status).toBe('validation_error');
  });

  it('permission denied → failed', async () => {
    const res = await executeAction(analyst, 'test.closeCase', { caseId: '1' });
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' && res.code).toBe('permission_denied');
  });

  it('idempotency returns cached result without re-running', async () => {
    const before = runs;
    const r1 = await executeAction(testUser, 'test.ping', { n: 7 });
    const r2 = await executeAction(testUser, 'test.ping', { n: 7 });
    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    expect(r2).toEqual(r1);
    expect(runs).toBe(before + 1);
  });

  it('rate limit trips', async () => {
    await executeAction(testUser, 'test.limited', {});
    await executeAction(testUser, 'test.limited', {});
    const res = await executeAction(testUser, 'test.limited', {});
    expect(res.status).toBe('failed');
    expect(res.status === 'failed' && res.code).toBe('rate_limited');
  });
});
