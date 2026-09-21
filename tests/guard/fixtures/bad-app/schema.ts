import { text } from 'drizzle-orm/pg-core';
import { platformTable, sensitive } from '@platform/data/schema-helpers';

const sneaky = 'computed';
export const badTable = platformTable('bad_things', {
  // 'ssn' is on the global sensitive-field list but is NOT wrapped in sensitive()
  ssn: text('ssn'),
  // camelCase key whose snake form is sensitive (card_last4)
  cardLast4: text('card_last4'),
  // sensitive() correctly wraps this one — no error expected here
  taxId: sensitive(text('tax_id')),
  // computed keys are forbidden inside platformTable column maps
  [sneaky]: text('x'),
});
