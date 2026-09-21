import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';
import { defineAction, type ActionCtx, type GuardFixtureCtx } from '@platform/actions/define';
import { dualControl, requiresRole } from '@platform/approvals';
import { flags, flagChanges } from './schema';

// Flags carrying one of these tags may only change in production with an
// engineering-admin approval (flags.setProductionRestricted).
export const RESTRICTED_TAGS = ['payments', 'kyc'] as const;
export const STALE_AFTER_DAYS = 90;
// Cutoff timestamp for "stale" flags — evaluated per call so each page load
// gets a fresh boundary (react render-purity rules forbid Date.now() inside
// component bodies).
export const staleCutoff = () => new Date(Date.now() - STALE_AFTER_DAYS * 86400000);

export const splitTags = (tags: string) =>
  tags.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);

export const isRestricted = (tags: string) =>
  splitTags(tags).some((t) => (RESTRICTED_TAGS as readonly string[]).includes(t));

export const createInput = z.object({
  key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,99}$/, 'letters, digits, - and _ only').max(100),
  description: z.string().min(1).max(500),
  ownerTeam: z.string().min(1).max(100),
  tags: z.string().max(200).optional(),
});

// Every environment change carries the version the caller saw: the row is
// locked and the version compared, so two engineers editing at once cannot
// silently overwrite each other, and `<env>:<id>:v<version>` doubles as the
// idempotency key (a double-click replays; the next legitimate change has a
// new version).
export const setEnvInput = z.object({
  id: z.string().uuid().max(64),
  expectedVersion: z.number().int().min(0),
  enabled: z.boolean(),
  rollout: z.number().int().min(0).max(100),
});
type SetEnvInput = z.infer<typeof setEnvInput>;

const idInput = z.object({ id: z.string().uuid().max(64) });

type Env = 'staging' | 'production';
const cols = {
  staging: { enabled: 'stagingEnabled', rollout: 'stagingRollout' },
  production: { enabled: 'productionEnabled', rollout: 'productionRollout' },
} as const;

const onOff = (enabled: boolean, rollout: number) => `${enabled ? 'on' : 'off'} @ ${rollout}%`;

async function applyEnvChange(ctx: ActionCtx, i: SetEnvInput, env: Env, restrictedPath: boolean) {
  // Lock first so concurrent changes serialize on the row.
  const row = await ctx.records.lock(flags, i.id);
  if (row.archivedAt) throw new Error(`Flag ${row.key} is archived — archived flags cannot be changed`);
  if (Number(row.version) !== i.expectedVersion) {
    throw new Error(`Flag ${row.key} changed since you loaded it (version ${row.version}) — reload and retry`);
  }
  if (env === 'production' && isRestricted(String(row.tags)) !== restrictedPath) {
    throw new Error(
      restrictedPath
        ? `Flag ${row.key} is not tagged ${RESTRICTED_TAGS.join('/')} — use flags.setProduction`
        : `Flag ${row.key} is tagged ${RESTRICTED_TAGS.join('/')} — production changes need an engineering admin (flags.setProductionRestricted)`,
    );
  }
  const c = cols[env];
  const beforeEnabled = Boolean(row[c.enabled]);
  const beforeRollout = Number(row[c.rollout]);
  if (beforeEnabled === i.enabled && beforeRollout === i.rollout) {
    throw new Error(`Flag ${row.key} is already ${onOff(i.enabled, i.rollout)} in ${env}`);
  }

  // The flag service is called before the row is updated: if it rejects the
  // change the whole transaction rolls back and the flag stays as it was.
  await ctx.integrations.flags.setFlag(String(row.key), env, i.enabled, i.rollout);

  const updated = await ctx.records.update(flags, i.id, {
    [c.enabled]: i.enabled,
    [c.rollout]: i.rollout,
    version: i.expectedVersion + 1,
    lastChangedAt: ctx.now,
    lastChangedBy: ctx.user.id,
  });
  const history = {
    flagId: i.id,
    flagKey: String(row.key),
    environment: env,
    actorId: ctx.user.id,
    approverId: ctx.approvedBy ?? null,
  };
  if (beforeEnabled !== i.enabled) {
    await ctx.records.insert(flagChanges, {
      ...history,
      change: 'toggled',
      before: beforeEnabled ? 'on' : 'off',
      after: i.enabled ? 'on' : 'off',
    });
  }
  if (beforeRollout !== i.rollout) {
    await ctx.records.insert(flagChanges, {
      ...history,
      change: 'rollout',
      before: `${beforeRollout}%`,
      after: `${i.rollout}%`,
    });
  }
  return { id: updated.id, environment: env, state: onOff(i.enabled, i.rollout), version: updated.version };
}

const envKey = (env: Env) => (i: SetEnvInput) => `${env}:${i.id}:v${i.expectedVersion}`;

// Guard fixtures pick a real seeded, unarchived flag and flip its state.
const envFixture = (env: Env, restricted: boolean) => async ({ firstRow }: GuardFixtureCtx) => {
  const tagged = or(eq(flags.tags, 'payments'), eq(flags.tags, 'kyc'));
  const untagged = eq(flags.tags, '');
  const row = await firstRow(flags, and(isNull(flags.archivedAt), restricted ? tagged : untagged));
  if (!row) throw new Error(`No unarchived fixture flag with ${restricted ? 'a restricted tag' : 'no tags'}`);
  const c = cols[env];
  return {
    id: String(row.id),
    expectedVersion: Number(row.version),
    enabled: !row[c.enabled],
    rollout: Number(row[c.rollout]),
  };
};

export const create = defineAction({
  id: 'flags.create',
  perm: 'flags.toggle',
  risk: 'low',
  input: createInput,
  guardFixture: ({ user }) => ({
    key: `guard-fixture-${user.id}`,
    description: 'Guard fixture flag',
    ownerTeam: 'eng',
  }),
  run: async (ctx, i) => {
    const tags = splitTags((i as { tags?: string }).tags ?? '').join(',');
    const row = await ctx.records.insert(flags, {
      key: i.key,
      description: i.description,
      ownerTeam: i.ownerTeam,
      tags,
      lastChangedAt: ctx.now,
      lastChangedBy: ctx.user.id,
    });
    await ctx.records.insert(flagChanges, {
      flagId: row.id,
      flagKey: i.key,
      environment: 'all',
      change: 'created',
      before: '—',
      after: `off in staging and production${tags ? ` · tags ${tags}` : ''}`,
      actorId: ctx.user.id,
      approverId: null,
    });
    return { id: row.id, key: i.key };
  },
});

// Staging: any engineer, immediate, still recorded in history + audit.
export const setStaging = defineAction({
  id: 'flags.setStaging',
  perm: 'flags.toggle',
  risk: 'low',
  tags: ['external'],
  idempotency: envKey('staging'),
  rateLimit: { max: 60, windowSeconds: 60 },
  input: setEnvInput,
  guardFixture: envFixture('staging', false),
  run: (ctx, i) => applyEnvChange(ctx, i, 'staging', false),
});

// Production: always a second engineer (anyone else holding flags.toggle).
// Refused at run time for payments/kyc flags — those go through the
// restricted action below, whatever the client claims.
export const setProduction = defineAction({
  id: 'flags.setProduction',
  perm: 'flags.toggle',
  risk: 'high',
  tags: ['external'],
  approval: dualControl(),
  idempotency: envKey('production'),
  rateLimit: { max: 30, windowSeconds: 60 },
  input: setEnvInput,
  guardFixture: envFixture('production', false),
  run: (ctx, i) => applyEnvChange(ctx, i, 'production', false),
});

// Production for payments/kyc flags: always an engineering admin.
export const setProductionRestricted = defineAction({
  id: 'flags.setProductionRestricted',
  perm: 'flags.toggle',
  risk: 'high',
  tags: ['external'],
  approval: requiresRole('eng_admin'),
  idempotency: envKey('production'),
  rateLimit: { max: 30, windowSeconds: 60 },
  input: setEnvInput,
  guardFixture: envFixture('production', true),
  run: (ctx, i) => applyEnvChange(ctx, i, 'production', true),
});

// Archive hides the flag; nothing is deleted. Only an all-off flag may be
// archived, so archiving can never change runtime behaviour.
export const archive = defineAction({
  id: 'flags.archive',
  perm: 'flags.toggle',
  risk: 'low',
  input: idInput,
  guardFixture: async ({ firstRow }) => {
    const row = await firstRow(
      flags,
      and(isNull(flags.archivedAt), eq(flags.stagingEnabled, false), eq(flags.productionEnabled, false)),
    );
    if (!row) throw new Error('No unarchived all-off fixture flag');
    return { id: String(row.id) };
  },
  run: async (ctx, i) => {
    const row = await ctx.records.lock(flags, i.id);
    if (row.archivedAt) throw new Error(`Flag ${row.key} is already archived`);
    if (row.stagingEnabled || row.productionEnabled) {
      throw new Error(`Flag ${row.key} is still on in staging or production — turn it off everywhere before archiving`);
    }
    await ctx.records.update(flags, i.id, {
      archivedAt: ctx.now,
      version: Number(row.version) + 1,
      lastChangedAt: ctx.now,
      lastChangedBy: ctx.user.id,
    });
    await ctx.records.insert(flagChanges, {
      flagId: i.id,
      flagKey: String(row.key),
      environment: 'all',
      change: 'archived',
      before: 'active',
      after: 'archived',
      actorId: ctx.user.id,
      approverId: null,
    });
    return { id: i.id, archived: true };
  },
});

export const flagsActions = [create, setStaging, setProduction, setProductionRestricted, archive];
