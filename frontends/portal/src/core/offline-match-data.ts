import type {Game, Match} from './types';

/** Use the same bounded history window when downloading and restoring a board. */
export function presentationHistoryPath(match: Pick<Match, 'id' | 'move_count'>, paginated: boolean): string | null {
  if (typeof match.id !== 'string' || !match.id || !Number.isSafeInteger(match.move_count) || match.move_count <= 0) return null;
  const id = encodeURIComponent(match.id);
  if (!paginated) return match.move_count <= 12 ? `/matches/${id}/moves` : null;
  const start = Math.max(0, match.move_count - 12);
  return `/v2/matches/${id}/history?start=${start}&limit=${match.move_count - start}`;
}

/** Catalog summaries and a newer version cannot replace a match's full package. */
export function isValidDownloadedGame(value: unknown, id: string, version: number): value is Game {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(version) || version < 1) return false;
  const game = value as Partial<Game>, ui = game.declarative_ui;
  return game.id === id && game.version === version
    && typeof game.name === 'string' && !!game.name.trim()
    && typeof game.description === 'string'
    && Array.isArray(game.allowed_player_counts) && game.allowed_player_counts.length > 0
    && game.allowed_player_counts.every(count => Number.isSafeInteger(count) && count > 0)
    && typeof game.server_code === 'string' && !!game.server_code.trim()
    && !!ui && typeof ui === 'object' && !Array.isArray(ui)
    && ui.format === 'buildplay-ui' && ui.version === 1 && typeof ui.ui_code === 'string';
}
