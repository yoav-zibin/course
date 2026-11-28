import type {Game, Match, PortalState} from '../core/types';

interface MatchGameSources {
  matchGames?: Record<string, Game>;
  selectedGame: Game | null;
  games: Game[];
  savedGames: Game[];
  recentGames: Game[];
  popularGames: Game[];
  categoryGames?: PortalState["categoryGames"];
}

/** A match's downloaded package is independent of catalog search and pages. */
export function matchGameName(match: Pick<Match, 'game_id' | 'game_version'>, sources: MatchGameSources, bundledName = 'Tic-tac-toe'): string | undefined {
  const candidates = [sources.matchGames?.[`${match.game_id}@${match.game_version}`], sources.selectedGame,
    ...sources.games, ...sources.savedGames, ...sources.recentGames, ...sources.popularGames, ...Object.values(sources.categoryGames ?? {}).flat()];
  const named = (game: Game | null | undefined): game is Game => game?.id === match.game_id && typeof game.name === 'string' && !!game.name.trim();
  const exact = candidates.find(game => named(game) && game.version === match.game_version);
  const game = exact || candidates.find(named);
  return game?.name || (match.game_id === 'bundled-tictactoe' ? bundledName : undefined);
}
