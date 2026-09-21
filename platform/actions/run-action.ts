'use server';

import { getCurrentUser } from '@platform/auth/provider';
import { executeAction } from './mutate';
import type { MutateResult } from './define';

/**
 * THE ONLY "use server" entry point available to app/UI code.
 * Apps never define their own server actions.
 */
export async function runAction(actionId: string, rawInput: unknown): Promise<MutateResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: 'failed', code: 'unauthenticated', message: 'Not signed in' };
  }
  return executeAction(user, actionId, rawInput);
}
