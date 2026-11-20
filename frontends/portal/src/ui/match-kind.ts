import type {Match, MatchKind} from '../core/types';

export function matchKind(match: Match): MatchKind {
  if (match.match_kind === 'computer' || match.match_kind === 'pass_and_play' || match.match_kind === 'multiplayer') return match.match_kind;
  if (match.localMode === 'pass') return 'pass_and_play';
  if (match.localMode === 'computer' || match.players.some(player => player.kind === 'computer')) return 'computer';
  return 'multiplayer';
}

export function isSinglePlayerMatch(match: Match): boolean { return matchKind(match) !== 'multiplayer'; }

export function singlePlayerMatches(cloud: Match[], device: Match[]): Match[] {
  const matches = new Map<string, Match>();
  for (const match of [...cloud, ...device]) if (isSinglePlayerMatch(match)) matches.set(match.id, match);
  return [...matches.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}
