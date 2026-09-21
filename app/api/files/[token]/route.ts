import { NextResponse } from 'next/server';
import { getCurrentUser } from '@platform/auth/provider';
import { verifyFileToken } from '@platform/actions/platform-actions';
import { mockStorage } from '@platform/integrations';

/**
 * THE ONLY route handler in the repo — platform-owned file download.
 * Token is a short-lived HMAC-signed blob produced by platform.getAttachmentUrl
 * (which itself requires app permission and audits the view).
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
  try {
    const data = await mockStorage('sandbox').read(verified.storageKey);
    return new NextResponse(Buffer.from(data), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
