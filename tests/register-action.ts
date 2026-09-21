import { registerActionForTests } from '@platform/registry';
import type { ActionDef } from '@platform/actions/define';

export function registerTestAction(action: ActionDef) {
  registerActionForTests(action);
}
