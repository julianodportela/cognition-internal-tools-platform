import { describe, it, expect } from 'vitest';
import { makeDb, casesTable, analyst, engAdmin } from './helpers';
import { query, maskRow } from '@platform/data/query';
import type { DB } from '@platform/data/client';

async function seedRows(db: DB, n: number) {
  for (let i = 1; i <= n; i++) {
    await db.execute(
      `INSERT INTO kyc_cases (subject, ssn, owner_id, team_id, status)
       VALUES ('subj-${i}', '1112233${String(i).padStart(2, '0')}', 'u-a', 'kyc', 'open')`,
    );
  }
}

describe('masking', () => {
  it('masks sensitive column by default', async () => {
    const db = await makeDb();
    await seedRows(db, 1);
    const { rows } = await query({ db, user: engAdmin }, casesTable);
    expect(String(rows[0].ssn)).toMatch(/^••••/);
    expect(String(rows[0].ssn)).toContain('3301');
  });

  it('reveals when ctx.reveal includes the field', async () => {
    const db = await makeDb();
    await seedRows(db, 1);
    const reveal = new Set(['kyc_cases.ssn']);
    const { rows } = await query({ db, user: engAdmin, reveal }, casesTable);
    expect(rows[0].ssn).toBe('111223301');
  });

  it('maskRow leaves non-sensitive fields intact', () => {
    const out = maskRow('kyc_cases', { id: 1, ssn: '123456789', subject: 'x' });
    expect(out.subject).toBe('x');
    expect(String(out.ssn)).toMatch(/^••••/);
  });
});

describe('cursor pagination', () => {
  it('pages through all rows with no dup/skip', async () => {
    const db = await makeDb();
    await seedRows(db, 25);
    const seen = new Set<number>();
    let cursor: string | undefined;
    for (;;) {
      const res: Awaited<ReturnType<typeof query>> = await query(
        { db, user: engAdmin },
        casesTable,
        { orderBy: { column: 'id', dir: 'asc' }, cursor, limit: 7, scope: false },
      );
      for (const r of res.rows) seen.add(Number(r.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen.size).toBe(25);
  });
});

describe('scope', () => {
  it("analyst (scope 'own') sees only own rows", async () => {
    const db = await makeDb();
    await seedRows(db, 3);
    await db.execute(`INSERT INTO kyc_cases (subject, ssn, owner_id, team_id) VALUES ('other','999887777','u-x','kyc')`);
    const { rows } = await query({ db, user: analyst }, casesTable);
    expect(rows.every((r) => r.ownerId === 'u-a')).toBe(true);
    expect(rows.length).toBe(3);
  });
});
