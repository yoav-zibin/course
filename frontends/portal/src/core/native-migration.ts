import { readLegacyPortal } from '../platform/legacy';
import * as storage from '../platform/storage';
import type { Account, LocalMatch } from './types';
import { AccountRepository } from './repository';
import bundled from './bundled-tictactoe.json';
import { redactedArchive as redactedNativeArchive } from './redaction';
import { loadAccounts, saveAccounts } from '../platform/credentials';
export { redactedArchive as redactedNativeArchive } from './redaction';
export async function restoreAccounts(baseUrl: string, repository: AccountRepository): Promise<Account[]> {
  const marker = `buildplay.native-import.v1.${encodeURIComponent(baseUrl)}`;
  const [accounts, imported] = await Promise.all([loadAccounts(baseUrl), storage.getItem(marker)]);
  if (imported) return accounts;
  const merged = await importNativeLegacy(baseUrl, repository, accounts, marker);
  // Commit the marker only after legacy credentials and game data are durable.
  if (merged.length) await saveAccounts(merged, baseUrl);
  await storage.setItem(marker, '1');
  return merged;
}
async function importNativeLegacy(baseUrl: string, repository: AccountRepository, accounts: Account[], marker: string): Promise<Account[]> {
  const raw = await readLegacyPortal(baseUrl);
  if (raw.errors?.length) {
    await storage.setItem(`${marker}.archive`, redactedNativeArchive(raw));
    throw new Error(`Earlier app data could not yet be fully read: ${raw.errors.join('; ')}. Reopen after unlocking the device to retry migration`);
  }
  // Both native modules return a platform object even on a clean install.
  if (!Object.keys(raw.android ?? {}).length && !Object.keys(raw.ios ?? {}).length) return accounts;
  // Keep game data before interpreting it. Credentials stay in encrypted native
  // storage; copying their decrypted export into AsyncStorage would weaken it.
  await storage.setItem(`${marker}.archive`, redactedNativeArchive(raw));
  const found = [raw.android?.user, raw.ios?.identity].filter(Boolean) as Account[];
  const merged = [...accounts];
  for (const user of found) if (!merged.some(a => a.id === user.id)) merged.push({ ...user, display_name: user.display_name || 'Player' });
  const onlineId = raw.ios?.identity?.id || raw.android?.user?.id || 'visitor';
  await repository.mutate(onlineId, data => {
    if (raw.android?.selectedMatchId) data.selectedId ||= raw.android.selectedMatchId;
    const snapshots = Object.values(raw.ios?.onlineSnapshots ?? {}) as any[];
    for (const snapshot of snapshots) {
      if (!snapshot || snapshot.account !== onlineId) continue;
      for (const match of snapshot.matches ?? []) if (match?.id && !data.responses[`/matches/${match.id}`]) data.responses[`/matches/${match.id}`] = match;
      // Legacy iOS queues contain opaque proposed states, no semantic action.
      // Never replay them against the new API. Preserve branch and conflict.
      for (const [id, entries] of Object.entries(snapshot.pending ?? {})) if (Array.isArray(entries) && entries.length) {
        data.archives.push({ id, moves: entries, source: 'legacy-ios', savedAt: new Date().toISOString() });
        data.conflicts[id] = { message: 'Saved moves from the previous iOS game protocol are preserved in the migration archive. Review before using the server version.' };
      }
    }
  });
  const portal = raw.ios?.portal as any;
  if (portal?.matches?.length) await repository.mutate(onlineId, data => {
    data.responses[`/games/${bundled.id}/versions/1`] = bundled;
    for (const saved of portal.matches) {
      if (!saved?.id || !Array.isArray(saved.board) || saved.board.length !== 9 || !Array.isArray(saved.names)) continue;
      const id = `local-ios-${saved.id}`; if (data.local[id]) continue;
      const board = saved.board.map((mark: any) => mark === 'X' ? 0 : mark === 'O' ? 1 : -1);
      const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      const line = lines.find(line => board[line[0]] !== -1 && line.every(i => board[i] === board[line[0]]));
      const over = !!line || board.every((v: number) => v !== -1); const turn = saved.turn === 1 ? 1 : 0;
      const state = { board, turn, scores: [0,0], selected: [], matched: [], roll: 0, total: 0, winner: line ? board[line[0]] : -1, turns: board.filter((v: number) => v !== -1).length, over };
      const view = { ...state, legal: over ? [] : board.flatMap((v: number, cell: number) => v === -1 ? [{ cell }] : []) };
      const created = new Date().toISOString();
      data.local[id] = { id, game_id: bundled.id, game_version: 1, owner_user_id: onlineId, status: over ? 'over' : 'ongoing', end_reason: over ? 'finished' : null,
        state: view, logicState: state, players: [0,1].map(i => ({ player_index: i, id: `local-player-${i}`, kind: 'human', user_id: i === 0 ? onlineId : null, name: saved.names[i] || `Player ${i+1}` })),
        turn_of_player_indices: over ? null : [turn], move_count: 0, created_at: created, localMode: 'pass', practiceSeed: 0, moves: [], initialState: view, initialTurn: over ? null : [turn], awaitingHandoff: saved.awaitingHandoff === true } as LocalMatch;
    }
  });
  return merged;
}
