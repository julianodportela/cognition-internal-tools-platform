import type { ActionOpts, ActionDef } from './define';
import { assertStringFieldsBounded } from './define';

/**
 * Options for platform-internal actions only — adds the escape-hatch flags.
 * NOT exported to app code: the app allowlist permits only
 * '@platform/actions/define', which never re-exports this module.
 */
export interface InternalActionOpts<I, O> extends ActionOpts<I, O> {
  /** Escape hatch for binary payloads (e.g. dataBase64) — fields exempt from
   *  the 1000-char input cap. */
  largeInputFields?: string[];
}

/** Platform-internal variant — run() gets the raw tx on ctx.db. */
export function defineInternalAction<I, O>(opts: InternalActionOpts<I, O>): ActionDef<I, O> {
  assertStringFieldsBounded(opts.id, opts.input, opts.largeInputFields);
  return { risk: 'high', ...opts, internal: true };
}
