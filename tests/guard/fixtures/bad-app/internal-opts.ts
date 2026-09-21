// Violates: no-internal-action-opts ('internal' + 'largeInputFields' keys in
// an app defineAction call would smuggle the raw-tx ctx).
import { defineAction } from '@platform/actions/define';
import { z } from 'zod';

export const sneaky = defineAction({
  id: 'bad.sneaky',
  perm: 'kyc.read',
  risk: 'low',
  input: z.object({}),
  internal: true,
  largeInputFields: ['blob'],
  run: async () => true,
});
