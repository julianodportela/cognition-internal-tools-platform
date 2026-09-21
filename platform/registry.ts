import type { ComponentType } from 'react';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { ActionDef } from '@platform/actions/define';
import { platformActions } from '@platform/actions/platform-actions';
import { platformSchema } from '@platform/data/schema';
import { appManifests } from '@apps/index';
import { templateManifest } from '../templates/app/manifest';
import type { DataMode } from '@platform/data/client';
import type { Permission } from '@platform/policy/roles';

export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  permission: Permission;
  dataMode: DataMode;
  dataClass: 'internal' | 'sensitive';
  nav?: { label: string; path: string }[];
  sources?: string[];
  kind?: 'app' | 'template';
  /** Synthetic rows loaded into the sandbox db at first init. */
  fixtures?: Record<string, Record<string, unknown>[]>;
  schema: Record<string, PgTable>;
  pages: Record<
    string,
    ComponentType<{
      subpath: string[];
      searchParams: Record<string, string | undefined>;
    }>
  >;
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

function ensureLoaded() {
  if (apps.size === 0) {
    for (const m of [...appManifests, templateManifest]) {
      apps.set(m.id, m);
      registerSchemaTables(m.schema as unknown as Record<string, unknown>);
      for (const a of m.actions) {
        actions.set(a.id, { ...a, appId: a.appId ?? m.id });
      }
    }
  }
}

export function getApps(): AppManifest[] {
  ensureLoaded();
  return [...apps.values()];
}

export function getApp(id: string): AppManifest | undefined {
  ensureLoaded();
  return apps.get(id);
}

export function getActions(): ActionDef[] {
  ensureLoaded();
  return [...actions.values()];
}

export function getAction(id: string): ActionDef | undefined {
  ensureLoaded();
  return actions.get(id);
}

/** Register an app manifest (tests may call directly; apps register via apps/index.ts). */
export function registerApp(m: AppManifest): void {
  apps.set(m.id, m);
  registerSchemaTables(m.schema as unknown as Record<string, unknown>);
  for (const a of m.actions) actions.set(a.id, { ...a, appId: a.appId ?? m.id });
}

/** Register an extra action (tests may call directly). */
export function registerAction(action: ActionDef): void {
  actions.set(action.id, action);
}

export function getSchemaTable(name: string): PgTable | undefined {
  ensureLoaded();
  return tables.get(name);
}

export function getSchemaTables(): Map<string, PgTable> {
  ensureLoaded();
  return tables;
}

export function registerSchemaTableForTests(table: PgTable, name: string): void {
  tables.set(name, table);
}
