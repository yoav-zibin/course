import * as storage from '../platform/storage';
import type { AccountData, Match } from './types';
import { redactedArchive } from './redaction';
export interface StorageAdapter { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; keys(): Promise<string[]>; exclusive<T>(name: string, run: () => Promise<T>): Promise<T> }
export const emptyAccountData = (): AccountData => ({ version: 1, responses: {}, queues: {}, conflicts: {}, local: {}, archives: [], archivedMatches: [], selectedId: null });
export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
export function requestId(): string { return globalThis.crypto?.randomUUID?.() ?? `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
export function migrateLegacy(raw: any): AccountData {
  const data = emptyAccountData();
  for (const key of ['responses', 'queues', 'conflicts', 'local'] as const) if (raw?.[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) (data[key] as any) = raw[key];
  data.archives = Array.isArray(raw?.archives) ? raw.archives : [];
  data.archivedMatches = Array.isArray(raw?.archivedMatches) ? raw.archivedMatches : [];
  data.selectedId = typeof raw?.selectedId === 'string' ? raw.selectedId : null;
  // Keep unsupported legacy intents for explicit recovery rather than issuing an
  // obsolete new_state request against the current semantic-move endpoint.
  for (const [id, queue] of Object.entries(data.queues)) {
    if (!Array.isArray(queue)) throw new Error(`Saved queue ${id} needs recovery`);
    if (queue.some(item => !item?.body || !Object.hasOwn(item.body, 'move'))) {
      data.conflicts[id] = { message: 'This saved branch uses an earlier game protocol. It is preserved; review it before loading the server version.' };
    }
  }
  data.imported = true; return data;
}
export class AccountRepository {
  constructor(public backend = '', public adapter: StorageAdapter = storage) {}
  key(id: string) { const scope = !this.backend || this.backend === 'https://buildplay.fun' ? '' : `${encodeURIComponent(this.backend)}.`; return `buildplay.shared.v1.${scope}${id}`; }
  lock<T>(id: string, run: () => Promise<T>): Promise<T> { return this.adapter.exclusive(this.key(id), run); }
  async read(id: string): Promise<AccountData> {
    const text = await this.adapter.getItem(this.key(id));
    if (text) { const parsed = JSON.parse(text); if (parsed?.version !== 1 || !parsed.responses || !parsed.queues || !parsed.local) throw new Error('Saved portal data needs recovery; the original data was kept.'); return parsed; }
    const base = `game-platform.portal.v1.${id}`;
    const legacyText = await this.adapter.getItem(base);
    let raw = legacyText ? JSON.parse(legacyText) : {};
    // Import the split browser store, including partially completed migrations.
    for (const key of await this.adapter.keys()) {
      if (!key.startsWith(`${base}.`)) continue;
      const suffix = key.slice(base.length + 1); const text = await this.adapter.getItem(key);
      if (!text || text === '__portal_offline_deleted__') continue;
      const value = JSON.parse(text);
      const part = /^([rqcl])\.(.*)$/.exec(suffix);
      if (part) { const group = ({ r: 'responses', q: 'queues', c: 'conflicts', l: 'local' } as any)[part[1]]; raw[group] ??= {}; raw[group][decodeURIComponent(part[2])] = value; }
      else if (suffix === 'archives') raw.archives = value;
      else if (suffix === 'archived') raw.archivedMatches = value;
      else if (suffix === 'selected') raw.selectedId = value;
    }
    return migrateLegacy(raw);
  }
  async write(id: string, data: AccountData): Promise<void> {
    // One atomic replacement commits queue+snapshot together on every platform.
    await this.adapter.setItem(this.key(id), JSON.stringify(data));
  }
  async mutate<T>(id: string, update: (data: AccountData) => T | Promise<T>): Promise<T> {
    return this.lock(id, async () => { const data = await this.read(id); const result = await update(data); await this.write(id, data); return result; });
  }
  async cache(id: string, path: string, value: any): Promise<any> {
    return this.mutate(id, data => {
      const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1]; const previous = data.responses[path];
      // A slow poll cannot roll an accepted move backwards, and an ordinary GET
      // cannot replace the base beneath an unresolved durable action.
      if (matchId && previous && (data.queues[matchId]?.length || previous.move_count > value?.move_count)) return previous;
      data.responses[path] = value; this.trim(data); return value;
    });
  }
  async preserveMergedAccounts(targetId: string, sourceIds: string[]): Promise<void> {
    const sources: { id: string; data: AccountData }[] = [];
    for (const id of [...new Set(sourceIds)].filter(id => id && id !== targetId)) sources.push({ id, data: await this.read(id) });
    if (!sources.length) return;
    await this.mutate(targetId, target => {
      for (const { id, data: source } of sources) {
        const collisions: Record<string, any> = {}; const packages: Record<string, any> = {}; const matches: Record<string, any> = {}; const copied: string[] = [];
        for (const [localId, match] of Object.entries(source.local)) {
          const path = `/games/${match.game_id}/versions/${match.game_version}`; const sourcePackage = source.responses[path]; const targetPackage = target.responses[path];
          if (target.local[localId] && !equal(target.local[localId], match) || sourcePackage && targetPackage && !equal(sourcePackage, targetPackage)) {
            collisions[localId] = match; if (sourcePackage) packages[path] = sourcePackage; continue;
          }
          // Preserve game identities, full logic state, move history and seed
          // byte-for-byte. A local game's player IDs are independent of login.
          target.local[localId] = JSON.parse(JSON.stringify(match)); copied.push(localId);
          if (sourcePackage && !targetPackage) target.responses[path] = JSON.parse(JSON.stringify(sourcePackage));
        }
        for (const matchId of new Set([...Object.keys(source.queues), ...Object.keys(source.conflicts)])) {
          const snapshot = source.responses[`/matches/${matchId}`]; if (!snapshot) continue;
          matches[matchId] = snapshot; const path = `/games/${snapshot.game_id}/versions/${snapshot.game_version}`; if (source.responses[path]) packages[path] = source.responses[path];
        }
        const record = JSON.parse(redactedArchive({ kind: 'account-merge', sourceAccount: id, localIds: copied, localMatches: collisions, matches, packages, queues: source.queues, conflicts: source.conflicts, previousArchives: source.archives, archivedMatches: source.archivedMatches }));
        // Online intents never become the surviving account's outgoing queue.
        // Their original request IDs and bases remain available for review.
        if (!target.archives.some(existing => { if (existing.kind !== record.kind || existing.sourceAccount !== id) return false; const { savedAt: _savedAt, ...previous } = existing; return equal(previous, record); })) target.archives.push({ ...record, savedAt: new Date().toISOString() });
        if (!target.selectedId && source.selectedId && target.local[source.selectedId]) target.selectedId = source.selectedId;
      }
    });
  }
  trim(data: AccountData) {
    const pinnedMatches = new Set([...Object.keys(data.queues), ...Object.keys(data.conflicts), ...(data.selectedId ? [data.selectedId] : [])]);
    const pinnedGames = new Set<string>();
    for (const match of [...Object.values(data.local), ...[...pinnedMatches].map(id => data.responses[`/matches/${id}`]).filter(Boolean)] as Match[]) pinnedGames.add(`/games/${match.game_id}/versions/${match.game_version}`);
    let bytes = JSON.stringify(data.responses).length;
    for (const path of Object.keys(data.responses)) {
      if (bytes <= 1_000_000) break;
      if (pinnedGames.has(path) || [...pinnedMatches].some(id => path === `/matches/${id}`)) continue;
      bytes -= JSON.stringify(data.responses[path]).length; delete data.responses[path];
    }
  }
}
