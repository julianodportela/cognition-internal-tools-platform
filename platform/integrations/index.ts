// Adapter interfaces for external systems. Mocks are bound in sandbox;
// real adapters are wired per-environment in later phases. Only platform/
// code may instantiate adapters.

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

export function mockStorage(): StorageAdapter {
  const files = new Map<string, Uint8Array>();
  return {
    async put(key, data) {
      await latency();
      files.set(key, data);
      return { url: `mockfs:///${key}` };
    },
    async getUrl(key) {
      await latency();
      if (!files.has(key)) fail(`No such file ${key}`);
      return `mockfs:///${key}`;
    },
    async delete(key) {
      await latency();
      files.delete(key);
    },
  };
}

export function mockIntegrations(): Integrations {
  return {
    payments: mockPayments(),
    kyc: mockKyc(),
    flags: mockFlags(),
    storage: mockStorage(),
  };
}

export function resolveIntegrations(dataMode: 'sandbox' | 'production'): Integrations {
  // Phase-later: real adapters bound when dataMode === 'production'.
  // For now production also resolves mocks so no real calls are possible.
  void dataMode;
  return mockIntegrations();
}
