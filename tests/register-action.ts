import { registerAction } from '@platform/registry';
import type { ActionDef } from '@platform/actions/define';

export function registerTestAction(action: ActionDef) {
  registerAction(action);
}
