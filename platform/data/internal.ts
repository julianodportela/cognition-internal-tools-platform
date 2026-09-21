/**
 * Platform-internal data access. The ONLY module allowed to hold a
 * production database handle — it carries the module-private capability and,
 * for production-bound apps, asserts a valid signed promotion exists
 * (promotions/<appId>.yaml, same rules as `pnpm guard:promotions`).
 */
import { getDb, productionCapability, type DB, type DataMode } from './client';
import { validatePromotion } from '@platform/guard/promotion';
import type { AppManifest } from '@platform/registry';

const ROOT = process.cwd();

export class PromotionRequired extends Error {
  constructor(public readonly appId: string) {
    super(`App '${appId}' is bound to production but has no valid promotions/${appId}.yaml`);
    this.name = 'promotion_required';
  }
}

/** The promotion gate enforced in code, not just by grep. */
export function hasValidPromotion(app: Pick<AppManifest, 'id' | 'dataMode' | 'dataClass' | 'sources'>): boolean {
  return validatePromotion(app, ROOT).length === 0;
}

/** Open a db handle for the given app. Throws promotion_required when
 *  the app is production-bound without a signed promotion. */
export function getAppDb(app: Pick<AppManifest, 'id' | 'dataMode' | 'dataClass' | 'sources'>): Promise<DB> {
  if (app.dataMode === 'production' && !hasValidPromotion(app)) {
    throw new PromotionRequired(app.id);
  }
  return getDb(app.dataMode, productionCapability());
}

/** Platform-internal handle for unscoped (non-app) work — sandbox allowed
 *  freely; production only via the capability path. */
export function getPlatformDb(mode: DataMode = 'sandbox'): Promise<DB> {
  return getDb(mode, productionCapability());
}
