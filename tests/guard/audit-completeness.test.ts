import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { getActions } from '@platform/registry';
import { executeAction } from '@platform/actions/mutate';
import { getDb } from '@platform/data/client';
import { auditLog } from '@platform/data/schema';
import { sensitiveFieldNames } from '@platform/policy/sensitive-fields';
import type { ActionDef } from '@platform/actions/define';
import type { SeedUser } from '@platform/policy/roles';
import type { DB } from '@platform/data/client';

const admin: SeedUser = { id: 'u-engadmin', name: 'Ada', role: 'eng_admin', teamId: 'eng' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodFixture(t: any): unknown {
  const def = t?._def;
  const type = def?.type ?? def?.typeName;
  switch (type) {
    case 'string': return 'x';
    case 'number': case 'int': return 100;
    case 'boolean': return true;
    case 'enum': return def.entries ? Object.values(def.entries)[0] : def.values?.[0] ?? 'x';
    case 'optional': case 'nullable': case 'readonly': case 'default': case 'nonoptional':
      return zodFixture(def.innerType ?? def.schema);
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(def.shape ?? {})) {
        out[k] = zodFixture(v);
      }
      return out;
    }
    case 'array': return [zodFixture(def.element ?? def.valueType)];
    case 'record': return {};
    case 'date': return new Date();
    case 'union': return zodFixture(def.options?.[0]);
    case 'literal': return def.value;
    default:
      return undefined;
  }
}

let db: DB;
beforeAll(async () => {
  db = await getDb('sandbox');
});

describe('audit completeness', () => {
  it('every registered action produces an audit row (or is guardSkip-annotated)', async () => {
    const actions = getActions() as ActionDef[];
    const failures: string[] = [];
    for (const a of actions) {
      if (a.guardSkip) continue;
      let input: unknown;
      try {
        input = zodFixture(a.input);
      } catch {
        failures.push(`${a.id}: cannot generate fixture (add guardSkip: 'reason')`);
        continue;
      }
      const before = await db.select().from(auditLog);
      const res = await executeAction(admin, a.id, input);
      void res;
      const after = await db.select().from(auditLog);
      if (after.length <= before.length) {
        failures.push(`${a.id}: no audit row written (status=${res.status})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('high-risk actions declare an approval policy', () => {
    const failures = (getActions() as ActionDef[])
      .filter((a) => a.risk === 'high' && !a.approval && !a.guardSkip)
      .map((a) => `${a.id}: risk 'high' without approval policy`);
    expect(failures).toEqual([]);
  });

  it('no action input field name is a sensitive field', () => {
    const names = new Set<string>(sensitiveFieldNames);
    const failures: string[] = [];
    for (const a of getActions() as ActionDef[]) {
      const shape = (a.input as z.ZodObject<z.ZodRawShape>)?.shape;
      if (!shape) continue;
      for (const field of Object.keys(shape)) {
        if (names.has(field)) failures.push(`${a.id}: input field '${field}' is a sensitive field name`);
      }
    }
    expect(failures).toEqual([]);
  });
});
