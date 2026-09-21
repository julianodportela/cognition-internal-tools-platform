import { z } from 'zod';
import { getTableColumns, eq, and } from 'drizzle-orm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { defineInternalAction } from './define-internal';
import type { ActionDef, InternalActionCtx } from './define';
import { isSensitive } from '@platform/data/schema-helpers';
import { getApp } from '@platform/registry';
import { attachments } from '@platform/data/schema';
import { scopePredicate, requirePerm } from '@platform/rbac/rbac';
import { authSecret } from '@platform/auth/secret';

const s64 = () => z.string().min(1).max(64);
const s128 = () => z.string().min(1).max(128);

/**
 * Built-in: reveal a single sensitive field value for one row.
 * This is the ONLY unmask path; it requires 'pii.reveal' AND the app's own
 * permission, resolves the table strictly from that app's schema (no
 * cross-app/cross-table reveal), applies the caller's row-scope, and audits
 * with the appId attached.
 */
export const revealField = defineInternalAction({
  id: 'platform.revealField',
  perm: 'pii.reveal',
  risk: 'low',
  input: z.object({
    appId: s64(),
    table: s128(),
    column: s128(),
    rowId: s64(),
  }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    requirePerm(ctx.user, app.permission);
    const table = (app.schema as Record<string, unknown>)[i.table] ?? Object.values(app.schema).find(
      (t) => (t as { _?: { name?: string } })._?.name === i.table,
    );
    if (!table) throw new Error(`Table ${i.table} is not part of app '${i.appId}'`);
    if (!isSensitive(i.table, i.column)) {
      throw new Error(`${i.table}.${i.column} is not a sensitive field`);
    }
    const cols = getTableColumns(table as never) as Record<string, never>;
    const col = cols[i.column];
    const idCol = cols['id'];
    if (!col || !idCol) throw new Error(`No such column ${i.column}`);
    const clauses = [eq(idCol as never, i.rowId as never)];
    // The caller's row-scope applies to reveals too — an out-of-scope row is
    // indistinguishable from a missing one.
    const scoped = scopePredicate(ctx.user, table as never);
    if (scoped) clauses.push(scoped);
    const db = (ctx as InternalActionCtx).db;
    const rows = await db
      .select({ v: col as never })
      .from(table as never)
      .where(and(...clauses))
      .limit(1);
    const value = (rows[0] as { v?: unknown } | undefined)?.v ?? null;
    await ctx.audit.record(i.table, i.rowId, null, { appId: i.appId, [i.column]: '<revealed>' });
    return { value };
  },
});

export const addNote = defineInternalAction({
  id: 'platform.addNote',
  perm: 'template.write', // gated additionally by app permission below
  risk: 'low',
  input: z.object({
    appId: s64(),
    entity: s128(),
    entityId: s64(),
    body: z.string().min(1).max(1000),
  }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    // The note writer must be able to use the app.
    requirePerm(ctx.user, app.permission);
    const note = await ctx.records.addNote(i.entity, i.entityId, i.body);
    return { id: note.id };
  },
});

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 5 * 1024 * 1024;

export const uploadAttachment = defineInternalAction({
  id: 'platform.uploadAttachment',
  perm: 'template.write',
  risk: 'low',
  input: z.object({
    appId: s64(),
    entity: s128(),
    entityId: s64(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(100),
    dataBase64: z.string(),
  }),
  // dataBase64 legitimately exceeds the 1000-char input cap (binary payload,
  // size is enforced separately at MAX_BYTES).
  largeInputFields: ['dataBase64'],
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    requirePerm(ctx.user, app.permission);
    if (!ALLOWED_TYPES.has(i.contentType)) {
      throw new Error(`Content type ${i.contentType} not allowed (pdf/png/jpg only)`);
    }
    const bytes = Buffer.from(i.dataBase64, 'base64');
    if (bytes.length > MAX_BYTES) throw new Error('File exceeds 5MB');
    // The parent row must be visible to this caller — attachments can't be
    // pinned to rows the user can't see.
    await ctx.records.requireParentRow(i.entity, i.entityId);
    const storageKey = `${i.appId}/${randomUUID()}`;
    await ctx.integrations.storage.put(storageKey, new Uint8Array(bytes), i.contentType);
    const db = (ctx as InternalActionCtx).db;
    const [row] = await db
      .insert(attachments)
      .values({
        appId: i.appId,
        entity: i.entity,
        entityId: i.entityId,
        filename: i.filename,
        contentType: i.contentType,
        size: bytes.length,
        storageKey,
        uploadedBy: ctx.user.id,
      })
      .returning();
    await ctx.audit.record('attachments', String(row.id), null, {
      filename: i.filename,
      entity: i.entity,
      entityId: i.entityId,
    });
    return { id: row.id, filename: row.filename };
  },
});

/**
 * Signed, expiring, per-user download token. The payload binds the token to
 * {attachmentId, userId, exp} — a token minted for one user/attachment is
 * useless to anyone else, and the route re-checks everything anyway.
 */
interface FileTokenPayload {
  attachmentId: number;
  userId: string;
  exp: number;
}

function signFilePayload(payload: string): string {
  return createHmac('sha256', authSecret()).update(payload).digest('base64url');
}

export function makeFileToken(attachmentId: number, userId: string, expiresAt: number): string {
  const p: FileTokenPayload = { attachmentId, userId, exp: expiresAt };
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${signFilePayload(body)}`;
}

export function verifyFileToken(token: string): FileTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const expected = signFilePayload(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as FileTokenPayload;
    if (typeof p.attachmentId !== 'number' || typeof p.userId !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export const getAttachmentUrl = defineInternalAction({
  id: 'platform.getAttachmentUrl',
  perm: 'template.read',
  risk: 'low',
  input: z.object({ appId: s64(), attachmentId: s64() }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    requirePerm(ctx.user, app.permission);
    const db = (ctx as InternalActionCtx).db;
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, Number(i.attachmentId)), eq(attachments.appId, i.appId)))
      .limit(1);
    if (!row) throw new Error('Attachment not found');
    // Parent row must be visible under the caller's scope — a URL for an
    // attachment on an out-of-scope row fails the same way as a missing one.
    await ctx.records.requireParentRow(row.entity, row.entityId);
    const token = makeFileToken(row.id, ctx.user.id, Date.now() + 5 * 60_000);
    await ctx.audit.record('attachments', String(row.id), null, { viewed: row.filename });
    return { url: `/api/files/${token}`, filename: row.filename };
  },
});

export const approve = defineInternalAction({
  id: 'platform.approve',
  perm: 'approvals.manage', // additional per-policy check inside
  risk: 'low',
  input: z.object({ requestId: s64() }),
  run: async (ctx, i) => {
    const { decideApproval } = await import('@platform/actions/mutate');
    return decideApproval(ctx as InternalActionCtx, i.requestId, true);
  },
});

export const reject = defineInternalAction({
  id: 'platform.reject',
  perm: 'approvals.manage',
  risk: 'low',
  input: z.object({ requestId: s64(), reason: z.string().max(1000).optional() }),
  run: async (ctx, i) => {
    const { decideApproval } = await import('@platform/actions/mutate');
    return decideApproval(ctx as InternalActionCtx, i.requestId, false, i.reason);
  },
});

export const platformActions: ActionDef[] = [
  revealField as ActionDef,
  addNote as ActionDef,
  uploadAttachment as ActionDef,
  getAttachmentUrl as ActionDef,
  approve as ActionDef,
  reject as ActionDef,
];
