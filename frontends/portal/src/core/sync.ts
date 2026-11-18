import { ApiError, PortalApi } from './api';
import { AccountRepository, equal } from './repository';
import type { Account, AccountData, Match, QueueEntry } from './types';
export interface SyncOptions { paginated: boolean; guard(): void; freshRequestId?: string; matchId?: string }
/** Shared sync policy. Caller identity is captured before every asynchronous step;
 * the same request key survives process death and a lost server response. */
export async function syncAccount(api: PortalApi, repository: AccountRepository, account: Account, options: SyncOptions): Promise<AccountData> {
  return repository.lock(account.id, async () => {
    const data = await repository.read(account.id);
    for (const id of options.matchId ? [options.matchId] : Object.keys(data.queues)) {
      if (data.conflicts[id]) continue;
      while (data.queues[id]?.length) {
        options.guard();
        const entry: QueueEntry = data.queues[id][0]; let updated: Match; let accepted = false;
        try {
          if (entry.requestId !== options.freshRequestId) {
            updated = await api.request('GET', `/matches/${encodeURIComponent(id)}`, undefined, account); options.guard();
            if (updated.move_count > entry.body.expected_move_count) {
              const history = await api.request('GET', options.paginated ? `/v2/matches/${encodeURIComponent(id)}/history?start=${entry.body.expected_move_count}&limit=1` : `/matches/${encodeURIComponent(id)}/moves`, undefined, account); options.guard();
              const previous = options.paginated ? history.items?.[0] : history[entry.body.expected_move_count];
              accepted = previous?.made_by_user_id === account.id && equal(previous.move, entry.body.move);
              if (!accepted) { data.conflicts[id] = { remote: updated, message: 'Another move changed this match. Your pending action is preserved for review.' }; await repository.write(account.id, data); break; }
            } else if (updated.move_count !== entry.body.expected_move_count || updated.status !== 'ongoing' || !equal(updated.state, entry.baseState) || !equal(updated.turn_of_player_indices, entry.baseTurn)) {
              data.conflicts[id] = { remote: updated, message: 'The server state or turn changed. Review your pending action before continuing.' }; await repository.write(account.id, data); break;
            }
          }
          options.freshRequestId = undefined;
          if (!accepted) updated = await api.request('POST', `/matches/${encodeURIComponent(id)}/moves`, entry.body, account, entry.requestId);
          options.guard();
          data.queues[id].shift(); if (!data.queues[id].length) delete data.queues[id];
          data.responses[`/matches/${id}`] = updated!;
          await repository.write(account.id, data);
        } catch (error) {
          options.guard();
          // A stale expected count may mean a previously accepted request. The
          // next sync reconciles history before deciding whether to replay it.
          if (error instanceof ApiError && error.status !== 409 && error.status < 500) { data.conflicts[id] = { message: error.message }; await repository.write(account.id, data); break; }
          throw error;
        }
      }
    }
    return data;
  });
}
