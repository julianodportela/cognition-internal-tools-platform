import { getTableColumns, lt, and, isNotNull } from 'drizzle-orm';
import { emit } from './index';
import { getDb } from '@platform/data/client';
import { getSchemaTables } from '@platform/registry';

interface Job {
  name: string;
  everyMs: number;
  fn: () => Promise<void>;
}

const jobs: Job[] = [];
let started = false;

export function registerJob(name: string, everyMs: number, fn: () => Promise<void>) {
  jobs.push({ name, everyMs, fn });
}

export async function tick(): Promise<void> {
  for (const j of jobs) {
    try {
      await j.fn();
    } catch {
      // jobs must never crash the process; failures are silent in phase 2
    }
  }
}

/** Scan registered tables with a due_at column; emit sla.breached per overdue row. */
async function slaCheck(): Promise<void> {
  const db = await getDb('sandbox');
  for (const [name, table] of getSchemaTables()) {
    const cols = getTableColumns(table) as Record<string, never>;
    const due = cols['dueAt'];
    if (!due) continue;
    const overdue = (await db
      .select()
      .from(table as never)
      .where(and(isNotNull(due as never), lt(due as never, new Date())))
      .limit(100)) as Record<string, unknown>[];
    for (const row of overdue) {
      await emit({
        type: 'sla.breached',
        entity: name,
        entityId: String(row['id']),
        payload: { dueAt: row['dueAt'] },
      });
    }
  }
}

/** Start the job loop once per process (dev only). */
export function ensureJobsStarted(): void {
  if (started) return;
  started = true;
  if (process.env.NODE_ENV === 'test') return;
  registerJob('sla.check', 60_000, slaCheck);
  setInterval(() => void tick(), 30_000).unref();
}
