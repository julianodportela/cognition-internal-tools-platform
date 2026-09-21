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
      if (typeof name === 'string') {
        if (tables.has(name) && tables.get(name) !== (t as PgTable)) {
          throw new Error(`registry: duplicate table '${name}'`);
        }
        tables.set(name, t as PgTable);
      }
    }
  }
}

registerSchemaTables(platformSchema as unknown as Record<string, unknown>);

let loaded = false;

function ensureLoaded() {
  if (!loaded) {
    loaded = true;
    for (const a of platformActions) registerActionInternal(a);
    for (const m of [...appManifests, templateManifest]) {
      registerApp(m);
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

function registerActionInternal(action: ActionDef): void {
  if (actions.has(action.id)) {
    throw new Error(`registry: duplicate action id '${action.id}'`);
  }
  actions.set(action.id, action);
}

/**
 * Register an app manifest. Action ids MUST be namespaced '${appId}.' — an
 * app can never shadow a platform action or another app's action, and
 * duplicate app ids / table names / action ids throw at registration.
 */
export function registerApp(m: AppManifest): void {
  if (apps.has(m.id)) throw new Error(`registry: duplicate app id '${m.id}'`);
  apps.set(m.id, m);
  registerSchemaTables(m.schema as unknown as Record<string, unknown>);
  for (const a of m.actions) {
    if (!a.id.startsWith(`${m.id}.`)) {
      throw new Error(`registry: action '${a.id}' in app '${m.id}' must be namespaced '${m.id}.'`);
    }
    if (a.internal === true) {
      throw new Error(`registry: action '${a.id}' in app '${m.id}' may not be internal — internal actions are platform-owned`);
    }
    registerActionInternal({ ...a, appId: a.appId ?? m.id });
  }
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

/** Test-only registration — app code cannot reach it (registry is type-only
 *  on the app allowlist) and production paths register via registerApp. */
export function registerActionForTests(action: ActionDef): void {
  registerActionInternal(action);
}
