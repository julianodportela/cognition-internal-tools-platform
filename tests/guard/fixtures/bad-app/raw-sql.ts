// Violates: no-raw-sql (sql import + tagged template).
import { sql } from 'drizzle-orm';

export const fragment = sql`select * from users`;
