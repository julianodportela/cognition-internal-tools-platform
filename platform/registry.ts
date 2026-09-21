import type { ComponentType } from 'react';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { ActionDef } from '@platform/actions/define';
import { platformActions } from '@platform/actions/platform-actions';
import { platformSchema } from '@platform/data/schema';
import { appManifests } from '@apps/index';
import type { DataMode } from '@platform/data/client';

export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  permission: string;
  dataMode: DataMode;
  dataClass: 'internal' | 'sensitive';
  nav?: { label: string; path: string }[];
  sources?: string[];
  pages: Record<string, ComponentType<{ subpath: string[] }>>;
  actions: ActionDef[];
}

const apps = new Map<string, AppManifest>();
const actions = new Map<string, ActionDef>();
const tables = new Map<string, PgTable>();

export function registerSchemaTables(schema: Record<string, unknown>) {
  for (const t of Object.values(schema)) {
    if (t && typeof t === 'object' && Symbol.for('drizzle:IsDrizzleTable') in (t as object)) {
      const name = (t as { _: { name?: string } })._?.name
        ?? (t as unknown as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
      if (typeof name === 'string') tables.set(name, t as PgTable);
    }
  }
}

registerSchemaTables(platformSchema as unknown as Record<string, unknown>);

for (const a of platformActions) actions.set(a.id, a);

export function getApps(): AppManifest[] {
  if (apps.size === 0) {
    for (const m of appManifests) {
      apps.set(m.id, m);
      for (const a of m.actions) {
        actions.set(a.id, { ...a, appId: a.appId ?? m.id });
      }
    }
  }
  return [...apps.values()];
}

export function getApp(id: string): AppManifest | undefined {
  getApps();
  return apps.get(id);
}

export function getAction(id: string): ActionDef | undefined {
  getApps();
  return actions.get(id);
}

/** Register an extra action (app manifests do this via getApps; tests may call directly). */
export function registerAction(action: ActionDef): void {
  actions.set(action.id, action);
}

export function getSchemaTable(name: string): PgTable | undefined {
  return tables.get(name);
}
