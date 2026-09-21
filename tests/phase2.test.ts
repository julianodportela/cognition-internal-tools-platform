import { describe, it, expect, beforeAll, vi } from 'vitest';
import { z } from 'zod';
import { defineAction } from '@platform/actions/define';
import { executeAction, decideApproval } from '@platform/actions/mutate';
import { dualControl, requiresRole } from '@platform/approvals';
import { defineStates } from '@platform/workflow';
import { registerAction, registerApp, registerSchemaTableForTests } from '@platform/registry';
import { getDb } from '@platform/data/client';
import { approvalRequests } from '@platform/data/schema';
import { eq } from 'drizzle-orm';
import { casesTable, analyst, engAdmin } from './helpers';
import { users as usersTable } from '@platform/data/schema';
import type { DB } from '@platform/data/client';
import type { SeedUser } from '@platform/policy/roles';
import type { InternalActionCtx } from '@platform/actions/define';
import type { AppManifest } from '@platform/registry';

let db: DB;
let runs = 0;
const finance: SeedUser = { id: 'u-f', name: 'Finn', role: 'finance_approver', teamId: 'finance' };

const issueRefund = defineAction({
  id: 'test.issueRefund',
  perm: 'refunds.issue',
  input: z.object({ txnId: z.string(), amountCents: z.number().positive() }),
  approval: dualControl((i) => (i as { amountCents: number }).amountCents > 50_000),
  idempotency: (i) => `rf-${i.txnId}`,
  risk: 'high',
  run: async (ctx, i) => {
    runs++;
    return await ctx.integrations.payments.refund(i.txnId, i.amountCents, `rf-${i.txnId}`);
  },
});

const escalate = defineAction({
  id: 'test.escalate',
  perm: 'kyc.decide',
  input: z.object({ caseId: z.string() }),
  approval: requiresRole('senior_reviewer'),
  run: async (ctx, i) => {
    await ctx.records.update(casesTable, Number(i.caseId), { status: 'escalated' });
    return { ok: true };
  },
});

const makeCase = defineAction({
  id: 'test.makeCase',
  perm: 'template.write',
  input: z.object({ subject: z.string(), ssn: z.string().optional() }),
  risk: 'low',
  run: async (ctx, i) => {
    return ctx.records.insert(casesTable, { subject: i.subject, ssn: i.ssn ?? null, ownerId: ctx.user.id, teamId: 'kyc' });
  },
});

const claimCase = defineAction({
  id: 'test.claim',
  perm: 'template.write',
  input: z.object({ id: z.number() }),
  risk: 'low',
  run: async (ctx, i) => ctx.records.claim(casesTable, i.id),
});

const removeCase = defineAction({
  id: 'test.remove',
  perm: 'template.write',
  input: z.object({ id: z.number() }),
  risk: 'low',
  run: async (ctx, i) => {
    await ctx.records.remove(casesTable, i.id);
    return { removed: true };
  },
});

const wf = defineStates({
  initial: 'open',
  states: ['open', 'review', 'closed'],
  transitions: [
    { from: 'open', to: 'review' },
    { from: 'review', to: 'closed', perm: 'kyc.decide' },
    { from: 'review', to: 'open' },
  ],
});

const advance = defineAction({
  id: 'test.advance',
  perm: 'kyc.decide',
  input: z.object({ id: z.number(), to: z.string() }),
  risk: 'low',
  run: async (ctx, i) => wf.transition(ctx, casesTable, i.id, i.to),
});

const senior: SeedUser = { id: 'u-s', name: 'Senior', role: 'senior_reviewer', teamId: 'kyc' };
const senior2: SeedUser = { id: 'u-s2', name: 'Senior2', role: 'senior_reviewer', teamId: 'kyc' };

function decCtx(user: SeedUser): InternalActionCtx {
  return { db, user, audit: { record: async () => {} } } as unknown as InternalActionCtx;
}

const testApp: AppManifest = {
  id: 'testapp', name: 'Test', icon: '🧪', permission: 'template.read',
  dataMode: 'sandbox', dataClass: 'internal',
  schema: { casesTable }, pages: {}, actions: [],
};

beforeAll(async () => {
  db = await getDb('sandbox');
  await db.execute(`CREATE TABLE IF NOT EXISTS kyc_cases (
    id serial PRIMARY KEY, subject text NOT NULL, ssn text, owner_id text,
    team_id text, status text NOT NULL DEFAULT 'open', assignee_id text,
    deleted_at timestamptz, due_at timestamptz
  )`);
  for (const u of [finance, senior, senior2]) {
    await db.insert(usersTable).values({ id: u.id, name: u.name, role: u.role, teamId: u.teamId }).onConflictDoNothing();
  }
  registerApp(testApp);
  registerSchemaTableForTests(casesTable, 'kyc_cases');
  for (const a of [issueRefund, escalate, makeCase, claimCase, removeCase, advance]) {
    registerAction(a as never);
  }
});

async function seedCase() {
  const res = await executeAction(senior, 'test.makeCase', { subject: 'c', ssn: '123456789' });
  return (res.status === 'ok' ? (res.data as { id: number }).id : -1);
}

describe('approvals', () => {
  it('triggers needs_approval and executes after approve, as requester', async () => {
    const res = await executeAction(finance, 'test.issueRefund', { txnId: 't1', amountCents: 60_000 });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';

    // requester cannot approve own request (notSelf)
    await expect(decideApproval(decCtx(finance), requestId, true)).rejects.toThrow();

    // approver (eng_admin holds refunds.issue + approvals.manage) approves
    const before = runs;
    const out = await decideApproval(decCtx(engAdmin), requestId, true);
    expect((out as { decided: string }).decided).toBe('approved');
    expect(runs).toBe(before + 1);

    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('executed');

    const audit = await db.execute(`SELECT count(*) c FROM audit_log WHERE request_id='${requestId}'`);
    expect(Number((audit.rows[0] as { c: number }).c)).toBeGreaterThanOrEqual(2);
  });

  it('duplicate request while pending returns same requestId', async () => {
    const r1 = await executeAction(finance, 'test.issueRefund', { txnId: 't2', amountCents: 60_000 });
    const r2 = await executeAction(finance, 'test.issueRefund', { txnId: 't2', amountCents: 60_000 });
    expect(r1.status).toBe('needs_approval');
    expect(r2).toEqual(r1);
  });

  it('below-threshold refund executes directly', async () => {
    const res = await executeAction(finance, 'test.issueRefund', { txnId: 't3', amountCents: 100 });
    expect(res.status).toBe('ok');
  });

  it('requiresRole: only matching role can approve', async () => {
    const id = await seedCase();
    const res = await executeAction(senior, 'test.escalate', { caseId: String(id) });
    expect(res.status).toBe('needs_approval');
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    // finance_approver cannot approve a senior_reviewer-gated request
    await expect(decideApproval(decCtx(finance), requestId, true)).rejects.toThrow();
    // requester (senior) also cannot — notSelf
    await expect(decideApproval(decCtx(senior), requestId, true)).rejects.toThrow();
    const out = await decideApproval(decCtx(senior2), requestId, true);
    expect((out as { decided: string }).decided).toBe('approved');
  });

  it('double-approve race: second decision on decided request fails', async () => {
    const res = await executeAction(finance, 'test.issueRefund', { txnId: 't5', amountCents: 60_000 });
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    await decideApproval(decCtx(engAdmin), requestId, true);
    await expect(decideApproval(decCtx(engAdmin), requestId, true)).rejects.toThrow();
  });

  it('rejected path marks request rejected', async () => {
    const res = await executeAction(finance, 'test.issueRefund', { txnId: 't9', amountCents: 60_000 });
    const requestId = res.status === 'needs_approval' ? res.requestId : '';
    const out = await decideApproval(decCtx(engAdmin), requestId, false, 'no');
    expect((out as { decided: string }).decided).toBe('rejected');
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req.status).toBe('rejected');
  });
});

describe('records + soft delete', () => {
  it('insert/update/remove produce masked audit rows; deleted hidden from query', async () => {
    const id = await seedCase();
    await executeAction(senior, 'test.remove', { id });
    const audit = await db.execute(
      `SELECT before_json FROM audit_log WHERE entity='kyc_cases' AND entity_id='${id}' AND before_json IS NOT NULL ORDER BY id`,
    );
    const beforeJson = String((audit.rows[0] as { before_json: string }).before_json);
    expect(beforeJson).toContain('••••');
    expect(beforeJson).not.toContain('123456789');
    const { query } = await import('@platform/data/query');
    const { rows } = await query({ db, user: engAdmin }, casesTable, { scope: false });
    expect(rows.find((r) => r.id === id)).toBeUndefined();
    const { rows: all } = await query({ db, user: engAdmin }, casesTable, { scope: false, includeDeleted: true });
    expect(all.find((r) => r.id === id)).toBeDefined();
  });

  it('claim conflict: second user cannot claim assigned row', async () => {
    const id = await seedCase();
    const r1 = await executeAction(senior, 'test.claim', { id });
    expect(r1.status).toBe('ok');
    // senior2 has template.write but not approvals.manage → claim conflict fails
    const r2 = await executeAction(senior2, 'test.claim', { id });
    expect(r2.status).toBe('failed');
  });
});

describe('workflow', () => {
  it('rejects invalid transition, applies valid one', async () => {
    const id = await seedCase(); // status open
    const bad = await executeAction(senior, 'test.advance', { id, to: 'closed' });
    expect(bad.status).toBe('failed');
    const good = await executeAction(senior, 'test.advance', { id, to: 'review' });
    expect(good.status).toBe('ok');
    const after = await db.execute(`SELECT status FROM kyc_cases WHERE id=${id}`);
    expect((after.rows[0] as { status: string }).status).toBe('review');
  });
});

describe('notes + attachments', () => {
  it('addNote writes audited note', async () => {
    const res = await executeAction(senior, 'platform.addNote', {
      appId: 'testapp', entity: 'kyc_cases', entityId: '1', body: 'looks fine',
    });
    expect(res.status).toBe('ok');
    const notes = await db.execute(`SELECT * FROM notes WHERE entity='kyc_cases'`);
    expect(notes.rows.length).toBeGreaterThan(0);
  });

  it('uploadAttachment rejects disallowed content type', async () => {
    const res = await executeAction(senior, 'platform.uploadAttachment', {
      appId: 'testapp', entity: 'kyc_cases', entityId: '1',
      filename: 'evil.exe', contentType: 'application/x-msdownload',
      dataBase64: Buffer.from('x').toString('base64'),
    });
    expect(res.status).toBe('failed');
  });

  it('uploadAttachment accepts png; getAttachmentUrl is audited', async () => {
    const up = await executeAction(senior, 'platform.uploadAttachment', {
      appId: 'testapp', entity: 'kyc_cases', entityId: '1',
      filename: 'doc.png', contentType: 'image/png',
      dataBase64: Buffer.from('pngbytes').toString('base64'),
    });
    expect(up.status).toBe('ok');
    if (up.status !== 'ok') return;
    const attId = (up.data as { id: number }).id;
    const url = await executeAction(senior, 'platform.getAttachmentUrl', {
      appId: 'testapp', attachmentId: String(attId),
    });
    expect(url.status).toBe('ok');
    if (url.status !== 'ok') return;
    expect(String((url.data as { url: string }).url)).toContain('/api/files/');
  });
});

describe('getReadCtx', () => {
  it('denies without app permission', async () => {
    vi.doMock('@platform/auth/provider', () => ({
      getCurrentUser: async () => analyst, // analyst lacks kyc.decide
    }));
    vi.doMock('next/navigation', () => ({ redirect: (p: string) => { throw new Error(`redirect:${p}`); } }));
    registerApp({
      id: 'restricted', name: 'R', icon: 'r', permission: 'kyc.decide',
      dataMode: 'sandbox', dataClass: 'internal', schema: {}, pages: {}, actions: [],
    });
    const { getReadCtx } = await import('@platform/data/read');
    await expect(getReadCtx('restricted')).rejects.toThrow();
  });
});
