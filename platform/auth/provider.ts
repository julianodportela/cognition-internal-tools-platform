import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { users, type SeedUser } from '@platform/policy/roles';

export interface Session {
  userId: string;
}

export interface IdentityProvider {
  getSession(): Promise<Session | null>;
  login(userId: string): Promise<void>;
  logout(): Promise<void>;
}

const COOKIE = 'itp_session';

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-do-not-use-in-prod';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

function devLoginAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_LOGIN === 'true';
}

export class DevIdentityProvider implements IdentityProvider {
  constructor() {
    if (!devLoginAllowed()) {
      throw new Error(
        'DevIdentityProvider is forbidden in production. Set ALLOW_DEV_LOGIN=true to override (not recommended).',
      );
    }
  }

  async getSession(): Promise<Session | null> {
    const jar = await cookies();
    const raw = jar.get(COOKIE)?.value;
    if (!raw) return null;
    const [userId, sig] = raw.split('.');
    if (!userId || !sig) return null;
    const expected = sign(userId);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { userId };
  }

  async login(userId: string): Promise<void> {
    if (!devLoginAllowed()) throw new Error('Dev login disabled in production');
    const jar = await cookies();
    jar.set(COOKIE, `${userId}.${sign(userId)}`, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  async logout(): Promise<void> {
    const jar = await cookies();
    jar.delete(COOKIE);
  }
}

let provider: IdentityProvider | null = null;
export function getIdentityProvider(): IdentityProvider {
  if (!provider) provider = new DevIdentityProvider();
  return provider;
}

/** Current user for server code (server components, runAction). Null if logged out. */
export async function getCurrentUser(): Promise<SeedUser | null> {
  const session = await getIdentityProvider().getSession();
  if (!session) return null;
  return users.find((u) => u.id === session.userId) ?? null;
}
