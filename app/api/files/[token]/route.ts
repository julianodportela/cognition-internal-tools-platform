import { NextResponse } from 'next/server';
import { getCurrentUser } from '@platform/auth/provider';
import { verifyFileToken } from '@platform/actions/platform-actions';
import { resolveIntegrations } from '@platform/integrations';
import { getApp } from '@platform/registry';
import { getAppDb } from '@platform/data/internal';
import { attachments } from '@platform/data/schema';
import { requirePerm, PermissionDenied } from '@platform/rbac/rbac';
import { eq } from 'drizzle-orm';

/**
 * THE ONLY route handler in the repo — platform-owned file download.
 * The token binds {attachmentId, userId, exp}; the route re-loads the
 * attachment, requires the session user to match the token's userId, and
 * re-checks the app's permission — a forwarded or stale token is useless.
 * Storage resolves through the owning app's dataMode (never a hardcoded one).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { token } = await params;
  const verified = verifyFileToken(token);
  if (!verified) return new NextResponse('Invalid or expired token', { status: 403 });
  if (verified.userId !== user.id) return new NextResponse('Invalid or expired token', { status: 403 });

  // Re-load the attachment — the token alone is not authorization.
  const db = await getAppDb({ id: '_files', dataMode: 'sandbox', dataClass: 'internal', sources: [] });
  const [row] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, verified.attachmentId))
    .limit(1);
  if (!row) return new NextResponse('Not found', { status: 404 });
  const owning = getApp(row.appId);
  if (!owning) return new NextResponse('Not found', { status: 404 });
  try {
    requirePerm(user, owning.permission);
  } catch (e) {
    if (e instanceof PermissionDenied) return new NextResponse('Forbidden', { status: 403 });
    throw e;
  }
  try {
    const data = await resolveIntegrations(owning.dataMode).storage.read(row.storageKey);
    return new NextResponse(Buffer.from(data), {
      headers: { 'Content-Type': row.contentType || 'application/octet-stream' },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
