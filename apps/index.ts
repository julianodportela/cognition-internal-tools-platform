import type { AppManifest } from '@platform/registry';
import { refundsManifest } from './refunds/manifest';

// Every app under apps/ must be statically imported and listed here.
// A CI check (phase 3) verifies every apps/* folder is registered.
export const appManifests: AppManifest[] = [refundsManifest];
