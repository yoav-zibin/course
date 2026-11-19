import type {Account} from './types';

export function accountDeletion(account: Account | null, profile: any, now = Date.now()) {
  const own = account && typeof profile?.id === 'string' && (profile.id === account.id || profile?.id === account.canonical_user_id) ? profile : account;
  const scheduledAt = typeof own?.deletion_scheduled_at === 'string' ? own.deletion_scheduled_at : null;
  const deadline = scheduledAt ? Date.parse(scheduledAt) : NaN;
  const started = Boolean(own?.deletion_started_at);
  const pending = Boolean(account && (Number.isFinite(deadline) || started));
  return {pending, scheduledAt, deadline, started, expired: pending && Number.isFinite(deadline) && now >= deadline, canUndo: pending && !started && Number.isFinite(deadline) && now < deadline};
}
