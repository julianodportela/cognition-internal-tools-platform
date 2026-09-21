/**
 * Platform logger — app code never logs (no-console rule); all operational
 * output goes through here. Errors are keyed by requestId so a generic
 * client message like "Action failed (ref X)" can be correlated server-side.
 */
function fmt(level: string, msg: string, meta?: Record<string, unknown>) {
  const base = `[${level}] ${msg}`;
  if (meta) return `${base} ${JSON.stringify(meta)}`;
  return base;
}

export const log = {
  info(msg: string, meta?: Record<string, unknown>): void {
    console.log(fmt('INFO', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    console.warn(fmt('WARN', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    console.error(fmt('ERROR', msg, meta));
  },
};
