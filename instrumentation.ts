/**
 * Next.js startup hook — fail closed at boot, not at first request.
 */
export function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NODE_ENV === 'production' &&
    !process.env.AUTH_SECRET
  ) {
    throw new Error('AUTH_SECRET is required in production');
  }
}
