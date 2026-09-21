import { text } from 'drizzle-orm/pg-core';
import { platformTable, sensitive } from '@platform/data/schema-helpers';

export const badTable = platformTable('bad_things', {
  // 'ssn' is on the global sensitive-field list but is NOT wrapped in sensitive()
  ssn: text('ssn'),
});
