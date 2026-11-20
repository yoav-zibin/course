import type {AccountData, LocalMatch, Match, MatchKind} from './types';

export function singlePlayerKind(match: Match): Exclude<MatchKind, 'multiplayer'> | null {
  if (match.match_kind === 'computer' || match.match_kind === 'pass_and_play') return match.match_kind;
  if (match.match_kind === 'multiplayer') return null;
  if (!match.localMode) return null;
  return match.players?.some(player => player.kind === 'computer') ? 'computer' : 'pass_and_play';
}

export function localRevision(match: LocalMatch): number { return Number.isSafeInteger(match.local_revision) && match.local_revision! >= 1 ? match.local_revision! : 1; }
export function needsCloudSave(match: LocalMatch): boolean {
  return !match.cloud_revision || localRevision(match) > (match.synced_local_revision || 0);
}

/** Only game state crosses the sync boundary. UI state and account credentials
 * never become part of a saved match or its idempotency comparison. */
export function singlePlayerSnapshot(match: LocalMatch, owner: string): LocalMatch {
  const humanSeat = match.players.find(player => player.kind === 'human')?.player_index;
  const snapshot: LocalMatch = {
    id: match.id, game_id: match.game_id, game_version: match.game_version,
    owner_user_id: owner, match_kind: singlePlayerKind(match)!,
    localMode: singlePlayerKind(match) === 'computer' ? 'computer' : 'pass',
    players: match.players.map(player => ({id: player.id, player_index: player.player_index, kind: player.kind,
      user_id: player.kind === 'human' && player.player_index === humanSeat ? owner : null,
      active: player.active !== false, ...(player.name ? {name: player.name} : {})})),
    status: match.status, state: match.state, logicState: match.logicState,
    practiceSeed: match.practiceSeed, moves: (match.moves || []).map(move => Object.fromEntries(
      ['move_number','player_index','new_state','next_turn_player_indices','move','player_id','created_at'].filter(key => Object.hasOwn(move,key)).map(key => [key,move[key]]))),
    initialState: match.initialState, initialTurn: match.initialTurn,
    turn_of_player_indices: match.turn_of_player_indices, move_count: match.move_count,
    created_at: match.created_at,
    ...(match.end_reason ? {end_reason: match.end_reason} : {}),
    ...(match.last_move_player_index !== undefined ? {last_move_player_index: match.last_move_player_index} : {}),
    awaitingHandoff: match.awaitingHandoff === true,
  };
  return JSON.parse(JSON.stringify(snapshot));
}

/** An authoritative private snapshot is usable on every signed-in device, but
 * must never replace this device's unsent branch during an ordinary download. */
export function hydrateSinglePlayer(data: AccountData, cloud: Match): LocalMatch | null {
  const snapshot = cloud.single_player_state;
  if (!singlePlayerKind(cloud) || !snapshot || snapshot.id !== cloud.id || !Array.isArray(snapshot.players)
    || !Number.isSafeInteger(cloud.cloud_revision) || cloud.cloud_revision! < 1) return null;
  const current = data.local[cloud.id];
  if (current && (needsCloudSave(current) || data.conflicts[cloud.id]
    || (current.cloud_revision || 0) >= cloud.cloud_revision!)) return current;
  const match: LocalMatch = {...snapshot, id: cloud.id, owner_user_id: cloud.owner_user_id,
    match_kind: cloud.match_kind, localMode: cloud.match_kind === 'computer' ? 'computer' : 'pass',
    cloud_revision: cloud.cloud_revision, local_revision: 1, synced_local_revision: 1, cloud_pending: false};
  data.local[cloud.id] = match;
  return match;
}
