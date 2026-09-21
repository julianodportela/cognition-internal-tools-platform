// Adapter interfaces for external systems. Mocks are bound in sandbox;
// real adapters are wired per-environment in later phases. Only platform/
// code may instantiate adapters.
import fs from 'fs';
import path from 'path';

export interface RefundResult {
  refundId: string;
  status: 'submitted' | 'failed';
}

export interface PaymentsProcessor {
  refund(txnId: string, amountCents: number, idempotencyKey: string): Promise<RefundResult>;
}

export interface KycVendor {
  fetchChecks(customerId: string): Promise<{ vendorRef: string; checks: Record<string, unknown>[] }>;
}

export interface FlagService {
  setFlag(key: string, env: string, enabled: boolean, rollout?: number): Promise<{ ok: boolean }>;
}

export interface StorageAdapter {
  put(key: string, data: Uint8Array, contentType?: string): Promise<{ url: string }>;
  getUrl(key: string): Promise<string>;
  /** Read the stored bytes back (platform-internal; used by the file route). */
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface Integrations {
  payments: PaymentsProcessor;
  kyc: KycVendor;
  flags: FlagService;
  storage: StorageAdapter;
}

const latency = () => new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
const fail = (msg: string) => {
  throw new Error(msg);
};

/** Deterministic failure rule for mocks: any key ending in 'F' fails. */
export function mockPayments(): PaymentsProcessor {
  const seen = new Map<string, RefundResult>();
  return {
    async refund(txnId, amountCents, idempotencyKey) {
      await latency();
      if (txnId.endsWith('F')) fail(`Processor declined txn ${txnId}`);
      const hit = seen.get(idempotencyKey);
      if (hit) return hit;
      const res: RefundResult = {
        refundId: `rf_${idempotencyKey.slice(0, 12)}`,
        status: 'submitted',
      };
      seen.set(idempotencyKey, res);
      return res;
    },
  };
}

export function mockKyc(): KycVendor {
  return {
    async fetchChecks(customerId) {
      await latency();
      if (customerId.endsWith('F')) fail(`KYC vendor error for ${customerId}`);
      return {
        vendorRef: `kyc_${customerId}`,
        checks: [
          { type: 'identity', status: 'pass' },
          { type: 'sanctions', status: 'pass' },
        ],
      };
    },
  };
}

export function mockFlags(): FlagService {
  return {
    async setFlag(key, env, enabled, rollout) {
      await latency();
      if (key.endsWith('F')) fail(`Flag service rejected ${key}`);
      void env; void enabled; void rollout;
      return { ok: true };
    },
  };
}

export function mockStorage(mode: 'sandbox' | 'production' = 'sandbox'): StorageAdapter {
  const dir = path.join(process.cwd(), '.data', 'files', mode);
  const safe = (key: string) => path.join(dir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
  return {
    async put(key, data) {
      await latency();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(safe(key), data);
      return { url: `localfs://${mode}/${key}` };
    },
    async getUrl(key) {
      await latency();
      if (!fs.existsSync(safe(key))) fail(`No such file ${key}`);
      return `localfs://${mode}/${key}`;
    },
    async read(key) {
      await latency();
      const p = safe(key);
      if (!fs.existsSync(p)) fail(`No such file ${key}`);
      return new Uint8Array(fs.readFileSync(p));
    },
    async delete(key) {
      await latency();
      fs.rmSync(safe(key), { force: true });
    },
  };
}

export function mockIntegrations(mode: 'sandbox' | 'production' = 'sandbox'): Integrations {
  return {
    payments: mockPayments(),
    kyc: mockKyc(),
    flags: mockFlags(),
    storage: mockStorage(mode),
  };
}

export function resolveIntegrations(dataMode: 'sandbox' | 'production'): Integrations {
  // Phase-later: real adapters bound when dataMode === 'production'.
  // For now production also resolves mocks so no real calls are possible.
  return mockIntegrations(dataMode);
}
