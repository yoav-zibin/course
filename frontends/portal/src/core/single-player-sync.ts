import {ApiError, type PortalApi} from './api';
import {type AccountRepository, equal} from './repository';
import {localRevision, needsCloudSave, singlePlayerKind, singlePlayerSnapshot} from './single-player';
import type {Account, Match} from './types';
import {isMissingSaveRoute, missingRouteReason, RetryableSyncCompatibilityError} from './sync-compatibility';

function isTransferredAncestor(remote:Match, snapshot:Match):boolean {
  const saved=remote.single_player_state;
  if(!saved || remote.owner_user_id!==snapshot.owner_user_id || remote.match_kind!==snapshot.match_kind
    || !Number.isSafeInteger(remote.cloud_revision) || remote.cloud_revision!<1
    || !Array.isArray(saved.moves) || saved.moves.length>snapshot.moves.length
    || saved.move_count!==saved.moves.length)return false;
  for(const field of ['id','game_id','game_version','match_kind','created_at','practiceSeed','players','initialState','initialTurn']) {
    if(!equal(saved[field],snapshot[field]))return false;
  }
  if(!equal(saved.moves,snapshot.moves.slice(0,saved.moves.length)))return false;
  const frame=saved.moves.length?snapshot.moves[saved.moves.length-1]:null;
  return equal(saved.state,frame?frame.new_state:snapshot.initialState)
    && equal(saved.turn_of_player_indices,frame?frame.next_turn_player_indices:snapshot.initialTurn);
}

/** Snapshot uploads hold no storage lock during networking. A player can keep
 * taking turns while a slow request is in flight; its acknowledgement marks
 * only the submitted revision saved and the next upload catches up. */
export async function syncSinglePlayerMatches(api: PortalApi, repository: AccountRepository, account: Account,
  options: {guard(): void; matchId?: string}): Promise<void> {
  const initial = await repository.read(account.id); options.guard();
  // Checking a clean match must not parse the entire account file again.
  // Each queued mutation requests another sync and dirty saves are rechecked
  // under the storage lock before an upload starts.
  const ids = options.matchId ? [options.matchId] :
    Object.keys(initial.local).filter(id=>needsCloudSave(initial.local[id]));
  for (const id of ids) {
    while (true) {
      options.guard();
      const data = await repository.read(account.id); options.guard();
      const local = data.local[id];
      const conflict=data.conflicts[id],legacyReason=conflict?.message.match(/^Cloud saving needs attention: (.+)\. Your saved turns are preserved\.$/)?.[1];
      if(local && !local.cloud_revision && conflict && !conflict.remote && legacyReason && missingRouteReason(legacyReason)) {
        await repository.mutate(account.id,current=>{
          options.guard();if(current.local[id] && !current.local[id].cloud_revision && equal(current.conflicts[id],conflict))delete current.conflicts[id];
        });
        continue;
      }
      if (!local || !needsCloudSave(local) || data.conflicts[id]) break;
      const kind = singlePlayerKind(local), humans = local.players?.filter(player => player.kind === 'human').length || 0,
        computers = local.players?.filter(player => player.kind === 'computer').length || 0;
      if (!kind || kind === 'computer' && (humans !== 1 || computers < 1) || kind === 'pass_and_play' && (!humans || computers)) {
        await repository.mutate(account.id, current => {
          options.guard(); current.archivedMatches.push({id, match: current.local[id], reason: 'Invalid mixed human/computer match', savedAt: new Date().toISOString()});
          delete current.local[id];
        });
        break;
      }
      // Persist the exact upload before sending it. If its acknowledgement is
      // lost and the player takes more turns, retry that same snapshot first;
      // otherwise a stale expected revision would look like another device.
      const inflight = await repository.mutate(account.id, current => {
        options.guard(); const latest=current.local[id]; if (!latest || current.conflicts[id]) return null;
        latest.cloud_inflight ||= {snapshot:singlePlayerSnapshot(latest,account.canonical_user_id || account.id),
          local_revision:localRevision(latest),expected_revision:latest.cloud_revision || 0};
        // Linking accounts changes authentication ownership, never the player
        // IDs stored inside game state. Retry an accepted source-account save
        // with the same normalized account fields as the server merge.
        if(latest.cloud_inflight.snapshot.owner_user_id!==(account.canonical_user_id || account.id)) {
          latest.cloud_inflight.snapshot=singlePlayerSnapshot(latest.cloud_inflight.snapshot,account.canonical_user_id || account.id);
        }
        return latest.cloud_inflight;
      });
      if (!inflight) break;
      const sentRevision=inflight.local_revision, snapshot=inflight.snapshot;
      let remote: Match;
      try {
        remote = await api.request('POST', '/matches/single-player-sync', {match: snapshot, expected_revision: inflight.expected_revision}, account);
        options.guard();
        if (remote?.id !== id || remote.match_kind !== kind || !Number.isSafeInteger(remote.cloud_revision) || remote.cloud_revision! < 1
          || remote.single_player_state?.id !== id) throw new Error('Invalid cloud match response; the device save was kept.');
      } catch (error) {
        options.guard();
        if (!(error instanceof ApiError) || error.status >= 500) throw error;
        if(isMissingSaveRoute(error))throw new RetryableSyncCompatibilityError(error);
        let server: Match | undefined;
        if (error.status === 409) try {server = await api.request('GET', `/matches/${encodeURIComponent(id)}`, undefined, account); options.guard();} catch {options.guard();}
        // Account merge advances the cloud revision. Rebase only this known
        // ownership transition, with a byte-for-byte ancestor history and its
        // matching retained view; an unrelated device branch still conflicts.
        if(error.status===409 && server && local.owner_user_id!==snapshot.owner_user_id && isTransferredAncestor(server,snapshot)) {
          await repository.mutate(account.id,current=>{
            options.guard();const latest=current.local[id];
            if(!latest?.cloud_inflight || !equal(latest.cloud_inflight.snapshot,snapshot))return;
            latest.cloud_inflight.expected_revision=server!.cloud_revision!;
            latest.cloud_revision=server!.cloud_revision;
            latest.owner_user_id=snapshot.owner_user_id;
          });
          continue;
        }
        await repository.mutate(account.id, current => {
          options.guard(); if (!current.local[id]) return;
          current.conflicts[id] = {message: error.status === 409
            ? 'This match changed on another device. Your saved turns are preserved; review them before using the cloud version.'
            : `Cloud saving needs attention: ${error.message}. Your saved turns are preserved.`, ...(server ? {remote: server} : {})};
        });
        break;
      }
      await repository.mutate(account.id, current => {
        options.guard(); const latest = current.local[id]; if (!latest) return;
        // Another tab may already have acknowledged a newer cloud revision.
        if ((latest.cloud_revision || 0) > remote.cloud_revision!) return;
        latest.cloud_revision = remote.cloud_revision;
        latest.synced_local_revision = Math.max(latest.synced_local_revision || 0, sentRevision);
        latest.local_revision = localRevision(latest);
        if (latest.cloud_inflight?.local_revision === sentRevision && equal(latest.cloud_inflight.snapshot,snapshot)) delete latest.cloud_inflight;
        latest.match_kind = kind;
        latest.owner_user_id = snapshot.owner_user_id;
        latest.cloud_pending = needsCloudSave(latest);
        current.responses[`/matches/${id}`] = remote;
        // Preserve the exact locally executed snapshot. In particular, do not
        // replace a newer local move with the request that just finished.
        if (equal(singlePlayerSnapshot(latest,snapshot.owner_user_id), snapshot)) latest.cloud_pending = false;
      });
    }
  }
}
