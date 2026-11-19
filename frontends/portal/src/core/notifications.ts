import type {Match} from './types';

/** A confirmed human move that hands control to a different human player. */
export function handsTurnToOpponent(before: Match, after: Match, userId: string): boolean {
  if (before.localMode || after.localMode || before.id !== after.id || before.status !== 'ongoing' || after.status !== 'ongoing' || after.move_count <= before.move_count) return false;
  const humans = before.players.filter(player => player.kind === 'human' && player.active !== false && player.user_id);
  const own = humans.find(player => player.user_id === userId);
  if (!own || humans.length < 2 || !before.turn_of_player_indices?.includes(own.player_index) || after.turn_of_player_indices?.includes(own.player_index)) return false;
  return after.players.some(player => player.kind === 'human' && player.active !== false && player.user_id && player.user_id !== userId && after.turn_of_player_indices?.includes(player.player_index));
}

/** Notification links only navigate within this server's player app. */
export function notificationTarget(raw: string, baseUrl: string): {kind: 'match' | 'invite' | 'rematch'; id: string} | null {
  try {
    const base = new URL(baseUrl), url = new URL(raw, base);
    if (url.origin !== base.origin) return null;
    const invitePath = /^\/i\/([^/]+)$/.exec(url.pathname);
    if (invitePath) return {kind: 'invite', id: decodeURIComponent(invitePath[1])};
    if (!['/', '/portal', '/static/portal.html', '/static/app/', '/static/app/index.html'].includes(url.pathname)) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const rematch = fragment.get('rematch') || url.searchParams.get('rematch');
    if (rematch) return {kind: 'rematch', id: rematch};
    const invite = fragment.get('invite') || url.searchParams.get('invite');
    const match = fragment.get('match') || url.searchParams.get('match');
    if (invite) return {kind: 'invite', id: invite};
    if (match) return {kind: 'match', id: match};
  } catch { /* Malformed and foreign links remain inert. */ }
  return null;
}
