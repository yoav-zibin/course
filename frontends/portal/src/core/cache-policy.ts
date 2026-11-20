import type {AccountData} from './types';

const knownGame=(value:any)=>typeof value?.game_id==='string'&&value.game_id.length>0&&Number.isSafeInteger(value.game_version)&&value.game_version>=1;

/** Replaceable downloads use this order both before and during quota recovery.
 * Durable local games, pending moves and conflicts are protected separately. */
export function matchRetentionPriority(match: any, userId?: string): number {
  if (match?.status === 'ongoing') {
    const turn = userId && Array.isArray(match.players) && match.players.some((player: any) =>
      player?.user_id === userId && player.active !== false && match.turn_of_player_indices?.includes(player.player_index));
    return turn ? 4 : 3;
  }
  return match?.status === 'waiting_for_players' ? 2 : 1;
}

export function responseRetentionPriorities(data: AccountData, userId?: string): Map<string, number> {
  const priorities = new Map<string, number>();
  const matchPriorities = new Map<string, number>();
  const keep = (path: string, priority: number) => priorities.set(path, Math.max(priorities.get(path) || 0, priority));
  const listed = data.responses['/matches'];
  if (Array.isArray(listed)) {
    keep('/matches', 5);
    for (const summary of listed) {
      if (!knownGame(summary) || typeof summary.id !== 'string') continue;
      const paths = [`/matches/${summary.id}`, `/matches/${encodeURIComponent(summary.id)}`];
      const match = paths.map(path => data.responses[path]).find(value => knownGame(value) && value.id === summary.id
        && (!Number.isFinite(summary.move_count) || value.move_count >= summary.move_count)) || summary;
      const priority = matchRetentionPriority(match, userId);
      matchPriorities.set(summary.id, priority);
      matchPriorities.set(encodeURIComponent(summary.id), priority);
      for (const path of paths) keep(path, priority);
      for (const id of new Set([match.game_id, encodeURIComponent(match.game_id)])) {
        keep(`/games/${id}/versions/${match.game_version}`, priority);
        if (data.responses[`/games/${id}`]?.version === match.game_version) keep(`/games/${id}`, priority);
      }
      const players = new Set<string>((Array.isArray(match.players) ? match.players : [])
        .map((player: any) => player?.user_id).filter((id: unknown): id is string => typeof id === 'string'));
      for (const id of players) {
        keep(`/users/${id}`, priority);
        keep(`/users/${encodeURIComponent(id)}`, priority);
      }
    }
  }
  for (const path of Object.keys(data.responses)) {
    const related = /^\/(?:v2\/)?matches\/([^/?]+)\/(?:history|moves)(?:\?|$)/.exec(path);
    const priority = related && matchPriorities.get(related[1]);
    if (priority) keep(path, priority);
    // A retained login alias may resolve to the canonical player profile. Keep
    // that response so a fresh offline launch can recover its turn identity.
    if (userId && /^\/users\/[^/?]+$/.test(path) && data.responses[path]?.id === userId) keep(path, 5);
  }
  // Small display metadata survives when a full game package no longer fits.
  if (data.responses['/portal/match-games']) keep('/portal/match-games', 5);
  return priorities;
}

export function protectedResponsePaths(data: AccountData, activeGame?: {id: string; version?: number}): Set<string> {
  const matches = new Set([...Object.keys(data.queues), ...Object.keys(data.creations || {}), ...Object.keys(data.conflicts), ...Object.keys(data.local), ...(data.selectedId ? [data.selectedId] : [])]);
  const knownGames = new Set<string>();
  const paths = new Set<string>(); const visited = new Set<object>(); let inspected = 0, conservative = false;
  const inspect = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    if (depth > 40 || ++inspected > 20000) {conservative=true;return;}
    visited.add(value);
    if(typeof value.id==='string'&&(Array.isArray(value.moves)||value.conflict||value.source)){matches.add(value.id);if(knownGame(value.match))knownGames.add(value.id);}
    if (knownGame(value)) {
      paths.add(`/games/${value.game_id}/versions/${value.game_version}`);
      paths.add(`/games/${encodeURIComponent(value.game_id)}/versions/${value.game_version}`);
      if (typeof value.id === 'string') {matches.add(value.id);knownGames.add(value.id);}
    }
    for (const [key, child] of Object.entries(value)) {if (/^\/games\/[^/]+\/versions\/[^/?]+$/.test(key)) paths.add(key); inspect(child,depth+1);}
  };
  inspect(data.local); inspect(data.archives); inspect(data.archivedMatches);
  for (const id of matches) {
    const references=[data.local[id],data.responses[`/matches/${id}`],data.responses[`/matches/${encodeURIComponent(id)}`],data.conflicts[id]?.remote];
    if(references.some(knownGame))knownGames.add(id);
    for(const value of references)inspect(value);
    if(!knownGames.has(id))conservative=true;
  }
  for (const path of Object.keys(data.responses)) {
    const match = /^\/(?:v2\/)?matches\/([^/?]+)(?:\/(?:history|moves))?(?:\?|$)/.exec(path);
    let id = match?.[1]; try {if (id) id=decodeURIComponent(id);} catch { /* Retain the literal identity. */ }
    if (id && matches.has(id)) paths.add(path);
    if (activeGame && (path === `/games/${activeGame.id}` || path === `/games/${encodeURIComponent(activeGame.id)}`
      || (activeGame.version === undefined ? path.startsWith(`/games/${encodeURIComponent(activeGame.id)}/versions/`) : path === `/games/${encodeURIComponent(activeGame.id)}/versions/${activeGame.version}`))) paths.add(path);
    if (conservative) paths.add(path);
  }
  return paths;
}
