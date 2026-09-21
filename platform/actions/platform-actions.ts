import { z } from 'zod';
import { getTableColumns, eq, and } from 'drizzle-orm';
import { createHmac, randomUUID } from 'crypto';
import { defineAction, type ActionDef, type InternalActionCtx } from './define';
import { isSensitive } from '@platform/data/schema-helpers';
import { getSchemaTable, getApp } from '@platform/registry';
import { attachments } from '@platform/data/schema';

/**
 * Built-in: reveal a single sensitive field value for one row.
 * This is the ONLY unmask path; it requires 'pii.reveal' and is audited.
 * dataMode is resolved from the appId in the input — there is no silent default.
 */
export const revealField = defineAction({
  id: 'platform.revealField',
  perm: 'pii.reveal',
  risk: 'low',
  input: z.object({
    appId: z.string(),
    table: z.string(),
    column: z.string(),
    rowId: z.string(),
  }),
  run: async (ctx, i) => {
    const table = getSchemaTable(i.table);
    if (!table) throw new Error(`Unknown table ${i.table}`);
    if (!isSensitive(i.table, i.column)) {
      throw new Error(`${i.table}.${i.column} is not a sensitive field`);
    }
    const cols = getTableColumns(table) as Record<string, never>;
    const col = cols[i.column];
    const idCol = cols['id'];
    if (!col || !idCol) throw new Error(`No such column ${i.column}`);
    const db = (ctx as InternalActionCtx).db;
    const rows = await db
      .select({ v: col as never })
      .from(table as never)
      .where(eq(idCol as never, i.rowId as never))
      .limit(1);
    const value = (rows[0] as { v?: unknown } | undefined)?.v ?? null;
    await ctx.audit.record(i.table, i.rowId, null, { [i.column]: '<revealed>' });
    return { value };
  },
});

export const addNote = defineAction({
  id: 'platform.addNote',
  perm: 'template.write', // gated additionally by app permission below
  risk: 'low',
  input: z.object({
    appId: z.string(),
    entity: z.string(),
    entityId: z.string(),
    body: z.string().min(1).max(10_000),
  }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    // The note writer must be able to use the app.
    const { requirePerm } = await import('@platform/rbac/rbac');
    requirePerm(ctx.user, app.permission);
    const note = await ctx.records.addNote(i.entity, i.entityId, i.body);
    return { id: note.id };
  },
});

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 5 * 1024 * 1024;

export const uploadAttachment = defineAction({
  id: 'platform.uploadAttachment',
  perm: 'template.write',
  risk: 'low',
  input: z.object({
    appId: z.string(),
    entity: z.string(),
    entityId: z.string(),
    filename: z.string().min(1).max(255),
    contentType: z.string(),
    dataBase64: z.string(),
  }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    const { requirePerm } = await import('@platform/rbac/rbac');
    requirePerm(ctx.user, app.permission);
    if (!ALLOWED_TYPES.has(i.contentType)) {
      throw new Error(`Content type ${i.contentType} not allowed (pdf/png/jpg only)`);
    }
    const bytes = Buffer.from(i.dataBase64, 'base64');
    if (bytes.length > MAX_BYTES) throw new Error('File exceeds 5MB');
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

function signToken(payload: string): string {
  return createHmac('sha256', process.env.AUTH_SECRET ?? 'dev-secret-do-not-use-in-prod')
    .update(payload)
    .digest('hex');
}

export function makeFileToken(storageKey: string, expiresAt: number): string {
  return `${Buffer.from(JSON.stringify({ k: storageKey, e: expiresAt })).toString('base64url')}.${signToken(`${storageKey}.${expiresAt}`)}`;
}

export function verifyFileToken(token: string): { storageKey: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof k !== 'string' || typeof e !== 'number' || e < Date.now()) return null;
    const expected = signToken(`${k}.${e}`);
    if (sig !== expected) return null;
    return { storageKey: k };
  } catch {
    return null;
  }
}

export const getAttachmentUrl = defineAction({
  id: 'platform.getAttachmentUrl',
  perm: 'template.read',
  risk: 'low',
  input: z.object({ appId: z.string(), attachmentId: z.string() }),
  run: async (ctx, i) => {
    const app = getApp(i.appId);
    if (!app) throw new Error(`Unknown app ${i.appId}`);
    const { requirePerm } = await import('@platform/rbac/rbac');
    requirePerm(ctx.user, app.permission);
    const db = (ctx as InternalActionCtx).db;
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, Number(i.attachmentId)), eq(attachments.appId, i.appId)))
      .limit(1);
    if (!row) throw new Error('Attachment not found');
    const token = makeFileToken(row.storageKey, Date.now() + 5 * 60_000);
    await ctx.audit.record('attachments', String(row.id), null, { viewed: row.filename });
    return { url: `/api/files/${token}`, filename: row.filename };
  },
});

export const approve = defineAction({
  id: 'platform.approve',
  perm: 'approvals.manage', // additional per-policy check inside
  risk: 'low',
  input: z.object({ requestId: z.string() }),
  run: async (ctx, i) => {
    const { decideApproval } = await import('@platform/actions/mutate');
    return decideApproval(ctx as InternalActionCtx, i.requestId, true);
  },
});

export const reject = defineAction({
  id: 'platform.reject',
  perm: 'approvals.manage',
  risk: 'low',
  input: z.object({ requestId: z.string(), reason: z.string().max(1000).optional() }),
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
