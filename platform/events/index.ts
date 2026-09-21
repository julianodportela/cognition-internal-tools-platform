// Platform events + notifier. Events are emitted by executeAction for
// approvals, completions, and job findings. Phase-later: real notifier
// (email/Slack) bound per environment; NullNotifier keeps an in-memory
// ring buffer surfaced on the audit page.

export interface PlatformEvent {
  type: 'action.completed' | 'approval.requested' | 'approval.decided' | 'sla.breached' | 'note.added' | string;
  actorId?: string;
  appId?: string | null;
  actionId?: string;
  entity?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  at: Date;
}

export interface Notifier {
  notify(event: PlatformEvent): Promise<void>;
}

const RING_SIZE = 200;
const ring: PlatformEvent[] = [];

export class NullNotifier implements Notifier {
  async notify(event: PlatformEvent): Promise<void> {
    ring.push(event);
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  }
}

let notifier: Notifier = new NullNotifier();

export function setNotifier(n: Notifier) {
  notifier = n;
}

export function getNotifier(): Notifier {
  return notifier;
}

export async function emit(e: Omit<PlatformEvent, 'at'>): Promise<void> {
  await notifier.notify({ ...e, at: new Date() });
}

export function recentEvents(limit = 25): PlatformEvent[] {
  return ring.slice(-limit).reverse();
}
