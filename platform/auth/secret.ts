/**
 * The single HMAC secret for session cookies, file tokens, and query cursors.
 * Fails closed in production: no AUTH_SECRET → throw at first use.
 */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production (refusing to use the dev default)');
  }
  return 'dev-secret-do-not-use-in-prod';
}
