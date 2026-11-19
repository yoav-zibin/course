import * as storage from '../platform/storage';
import type { AccountData } from './types';
import { redactedArchive } from './redaction';
import {isQuotaError,utf8Size} from '../platform/recoverable-cache';
export {utf8Size} from '../platform/recoverable-cache';
import {originEvictions} from '../platform/origin-cache';
import {protectedResponsePaths} from './cache-policy';
export interface StorageAdapter { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem?(key: string): Promise<void>; keys(): Promise<string[]>; exclusive<T>(name: string, run: () => Promise<T>): Promise<T> }
export const emptyAccountData = (): AccountData => ({ version: 1, responses: {}, queues: {}, conflicts: {}, local: {}, archives: [], archivedMatches: [], selectedId: null });
export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
export function requestId(): string { return globalThis.crypto?.randomUUID?.() ?? `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
const RECOVERABLE_BUDGET = 1_000_000, QUOTA_RETRIES = 8;
function validRecency(value: unknown): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0; }
function touchResponse(data: AccountData, path: string): void {
  const entries = data.responseRecency && typeof data.responseRecency === 'object' && !Array.isArray(data.responseRecency) ? data.responseRecency : {};
  data.responseRecency = Object.fromEntries(Object.keys(data.responses).map(key => [key,validRecency(entries[key])]));
  let clock = Math.max(Date.now(), validRecency(data.cacheClock) + 1, ...Object.values(data.responseRecency).map(at => at + 1));
  if (!Number.isSafeInteger(clock)) { const sorted = Object.keys(data.responseRecency).sort((a,b) => data.responseRecency![a]-data.responseRecency![b]); sorted.forEach((key,index) => {data.responseRecency![key]=index;}); clock=Math.max(Date.now(),sorted.length); }
  data.cacheClock = clock; data.responseRecency[path] = clock;
}
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
  private activeGames = new Map<string,{id: string; version?: number}>();
  constructor(public backend = '', public adapter: StorageAdapter = storage) {}
  protectGame(id: string, gameId: string | null, version?: number) { if (gameId) this.activeGames.set(id,{id:gameId,version}); else this.activeGames.delete(id); }
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
    this.trim(data,id);
    let candidates: {key: string; at: number; bytes?: number; evict: () => Promise<void>}[] | null = null;
    for (let attempt=0;;attempt++) {
      try {await this.adapter.setItem(this.key(id), JSON.stringify(data));return;}
      catch (error) {
        if (!isQuotaError(error) || attempt >= QUOTA_RETRIES) throw error;
        if (!candidates) {
          const pinned = protectedResponsePaths(data,this.activeGames.get(id));
          candidates = Object.keys(data.responses).filter(path => !pinned.has(path)).map(path => ({key:path,at:validRecency(data.responseRecency?.[path]),bytes:utf8Size(JSON.stringify(data.responses[path])),evict:async()=>{delete data.responses[path];if(data.responseRecency)delete data.responseRecency[path];}}));
          candidates.push(...await originEvictions(this.adapter,this.key(id)));
          candidates.sort((a,b) => a.at-b.at || a.key.localeCompare(b.key));
        }
        if (!candidates.length) throw error;
        const batch = [];let freed=0;
        const target=32768*2**attempt;
        // Retry before removing the newest remaining cache entry. Small old
        // metadata must not consume every retry before reaching a large cache.
        while(candidates.length&&(batch.length===0||(freed<target&&candidates.length>1))){const candidate=candidates.shift()!;batch.push(candidate);freed+=candidate.bytes||1;}
        for (const candidate of batch) await candidate.evict();
      }
    }
  }
  async mutate<T>(id: string, update: (data: AccountData) => T | Promise<T>): Promise<T> {
    return this.lock(id, async () => { const data = await this.read(id); const result = await update(data); await this.write(id, data); return result; });
  }
  async cache(id: string, path: string, value: any): Promise<any> {
    return (await this.cacheData(id,path,value)).value;
  }
  async cacheData(id: string, path: string, value: any): Promise<{value: any; data: AccountData}> {
    return this.lock(id, async () => {
      const data = await this.read(id);
      const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1]; const previous = data.responses[path];
      // A slow poll cannot roll an accepted move backwards, and an ordinary GET
      // cannot replace the base beneath an unresolved durable action.
      if (matchId && previous && (data.queues[matchId]?.length || data.conflicts[matchId] || previous.move_count > value?.move_count)) value=previous;
      data.responses[path] = value; touchResponse(data,path);
      try {await this.write(id,data);} catch (error) {
        // A replaceable download may be served from memory. Durable mutation
        // callers still receive write failures and never lose their old save.
        if (!isQuotaError(error)) throw error;
        const persisted = await this.read(id); return {value,data:persisted};
      }
      return {value,data};
    });
  }
  async touch(id: string, path: string): Promise<void> {
    try {await this.lock(id,async()=>{const data=await this.read(id);if(!Object.hasOwn(data.responses,path))return;touchResponse(data,path);await this.write(id,data);});}
    catch { /* Recency is optional even when the cached value remains readable. */ }
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
  trim(data: AccountData, id?: string) {
    const pinned = protectedResponsePaths(data,id ? this.activeGames.get(id) : undefined);
    let bytes = utf8Size(JSON.stringify(data.responses));
    const paths = Object.keys(data.responses).filter(path => !pinned.has(path)).sort((a,b) => validRecency(data.responseRecency?.[a])-validRecency(data.responseRecency?.[b]) || a.localeCompare(b));
    for (const path of paths) {
      if (bytes <= RECOVERABLE_BUDGET) break;
      bytes -= utf8Size(JSON.stringify(data.responses[path])) + utf8Size(JSON.stringify(path)) + 2;
      delete data.responses[path]; if (data.responseRecency) delete data.responseRecency[path];
    }
  }
}
