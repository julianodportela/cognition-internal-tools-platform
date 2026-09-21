import { getTableColumns, lt, gt, and, isNotNull, eq } from 'drizzle-orm';
import { emit } from './index';
import { getDb } from '@platform/data/client';
import { getSchemaTables } from '@platform/registry';
import { jobLeases } from '@platform/data/schema';
import { log } from '@platform/log';

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

/**
 * Lease a job slot via the job_leases table — with multiple processes only the
 * lease holder runs the job this interval. Fails open to running when the db
 * is unreachable is NOT acceptable for jobs either; the error propagates and
 * is logged by tick().
 */
async function claimLease(db: Awaited<ReturnType<typeof getDb>>, name: string, everyMs: number): Promise<boolean> {
  const [row] = await db.select().from(jobLeases).where(eq(jobLeases.name, name)).limit(1);
  if (row && row.leasedUntil.getTime() > Date.now()) return false;
  const until = new Date(Date.now() + everyMs);
  if (row) {
    const updated = await db
      .update(jobLeases)
      .set({ leasedUntil: until })
      .where(and(eq(jobLeases.name, name), lt(jobLeases.leasedUntil, new Date())))
      .returning();
    return updated.length > 0;
  }
  try {
    await db.insert(jobLeases).values({ name, leasedUntil: until });
    return true;
  } catch {
    return false; // raced insert — someone else holds it
  }
}

export async function tick(): Promise<void> {
  for (const j of jobs) {
    try {
      const db = await getDb('sandbox');
      if (!(await claimLease(db, j.name, j.everyMs))) continue;
      await j.fn();
    } catch (e) {
      // Jobs must never crash the process — but they must never fail silently
      // either. Errors go to the platform logger keyed by job name.
      log.error(`job ${j.name} failed`, { job: j.name, error: e instanceof Error ? e.stack : String(e) });
    }
  }
}

/** Scan registered tables with a due_at column; emit sla.breached per overdue row.
 *  Pages through rows so a big backlog doesn't fit in one statement. */
async function slaCheck(): Promise<void> {
  const db = await getDb('sandbox');
  const PAGE = 500;
  for (const [name, table] of getSchemaTables()) {
    const cols = getTableColumns(table) as Record<string, never>;
    const due = cols['dueAt'];
    const idCol = cols['id'];
    if (!due || !idCol) continue;
    let lastId: string | null = null;
    for (;;) {
      const clauses = [isNotNull(due as never), lt(due as never, new Date())];
      if (lastId != null) {
        clauses.push(gt(idCol as never, lastId as never));
      }
      const rows = (await db
        .select()
        .from(table as never)
        .where(and(...clauses))
        .orderBy(idCol as never)
        .limit(PAGE)) as Record<string, unknown>[];
      if (rows.length === 0) break;
      for (const row of rows) {
        await emit({
          type: 'sla.breached',
          entity: name,
          entityId: String(row['id']),
          payload: { dueAt: row['dueAt'] },
        });
      }
      lastId = String(rows[rows.length - 1]['id']);
      if (rows.length < PAGE) break;
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
