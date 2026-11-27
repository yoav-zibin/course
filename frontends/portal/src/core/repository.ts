import {requestId} from './random-id';
import {equal} from './account-data';
import {recordDiagnosticEvent} from './diagnostics';
import * as storage from '../platform/storage';
import {DeviceTurns,type TurnStorage} from './device-turns';
import type { AccountData, LocalMatch } from './types';
import { redactedArchive } from './redaction';
import {isQuotaError,utf8Size} from '../platform/recoverable-cache';
import {reportCacheFailure} from '../platform/cache-diagnostics';
export {utf8Size} from '../platform/recoverable-cache';
import {originEvictions} from '../platform/origin-cache';
import {protectedResponsePaths,responseRetentionPriorities} from './cache-policy';
import {apiOrigin,DEFAULT_API_ORIGIN} from '../platform/credential-vault';
import {hydrateSinglePlayer,needsCloudSave} from './single-player';
export const LEGACY_ORIGIN_KEY='game-platform.portal.origin.v1';
export interface StorageAdapter { turnStorage?: TurnStorage; supportsBrowserImports?: boolean; getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem?(key: string): Promise<void>; keys(): Promise<string[]>; exclusive<T>(name: string, run: () => Promise<T>): Promise<T> }
export const emptyAccountData = (): AccountData => ({ version: 1, responses: {}, queues: {}, conflicts: {}, local: {}, archives: [], archivedMatches: [], selectedId: null });
export {equal} from './account-data';
export {requestId} from './random-id';
const RECOVERABLE_BUDGET = 1_000_000, MATCH_BUDGET = 20_000_000, QUOTA_RETRIES = 8;
const LOCAL_BUDGET = 2_000_000, ARCHIVE_BUDGET = 1_000_000, PRUNE_ON_LOAD_BYTES = 3_000_000;
function entryBytes(key: string, value: unknown): number { return utf8Size(JSON.stringify(value)) + utf8Size(JSON.stringify(key)) + 2; }
function savedTimestamp(value: any): number {
  for (const field of ['savedAt', 'created_at', 'saved_at']) { const at = Date.parse(value?.[field]); if (Number.isFinite(at)) return at; }
  return 0;
}
function oldestFirst<T>(entries: [string, T][], stamp: (value: T) => number): [string, T][] {
  return entries.map(([key, value], index) => ({key, value, index, at: stamp(value)}))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({key, value}) => [key, value] as [string, T]);
}
/** A local match may be shed only once the cloud has acknowledged every
 * revision and nothing durable still references it. Pending actions, unsynced
 * single-player history and conflict branches are never shed. */
function sheddableLocalMatch(data: AccountData, id: string): boolean {
  const match = data.local[id]; if (!match) return false;
  if (match.status === 'ongoing' || match.status === 'waiting_for_players') return false;
  if (match.cloud_inflight || match.cloud_pending || needsCloudSave(match)) return false;
  if (data.queues[id]?.length || data.conflicts[id] || data.creations?.[id]) return false;
  return data.selectedId !== id;
}
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
// Several stores can share the native module in one process. They must also
// share the writer for the same account and backend.
const deviceJournals=new WeakMap<TurnStorage,Map<string,DeviceTurns>>();
export class AccountRepository {
  private checkpoints = new Map<string,Promise<void>>();
  deviceTurns(id:string):DeviceTurns|undefined {
    if(!this.adapter.turnStorage)return;
    const backend=this.adapter.turnStorage,key=this.key(id);
    let journals=deviceJournals.get(backend);
    if(!journals){journals=new Map();deviceJournals.set(backend,journals);}
    let journal=journals.get(key);
    if(!journal){journal=new DeviceTurns(backend,'buildplay.turns.v1.'+key);journals.set(key,journal);}
    return journal;
  }
  checkpointTurns(id:string):Promise<void>{
    const journal=this.deviceTurns(id),key=this.key(id),running=this.checkpoints.get(key);
    if(running)return running;
    if(!journal?.hasSaved)return Promise.resolve();
    // Give React a frame and combine rapid turns. The journal is already
    // durable, including if iOS suspends the app before this timer fires.
    const pending:Promise<void>=new Promise<void>(resolve=>setTimeout(resolve,250)).then(()=>{
      const queued=performance.now();
      return this.adapter.exclusive(key,async()=>{
        const start=performance.now();
        const count=await journal.checkpoint(()=>this.readAccount(id),data=>this.write(id,data));
        if(count)recordDiagnosticEvent('local_move_checkpoint',{turns:count,wait_for_store_ms:Math.round(start-queued),duration_ms:Math.round(performance.now()-start)});
      });
    })
      .finally(()=>{this.checkpoints.delete(key);})
      .then(()=>{if(journal.hasSaved)return this.checkpointTurns(id);});
    this.checkpoints.set(key,pending);return pending;
  }
  private activeGames = new Map<string,{id: string; version?: number}>();
  private matchUsers = new Map<string,string>();
  constructor(public backend = '', public adapter: StorageAdapter = storage) {}
  protectGame(id: string, gameId: string | null, version?: number) { if (gameId) this.activeGames.set(id,{id:gameId,version}); else this.activeGames.delete(id); }
  prioritizeMatches(id: string, userId = id) { this.matchUsers.set(id,userId); }
  key(id: string) { const scope = !this.backend || this.backend === 'https://buildplay.fun' ? '' : `${encodeURIComponent(this.backend)}.`; return `buildplay.shared.v1.${scope}${id}`; }
  lock<T>(id:string,run:()=>Promise<T>):Promise<T>{
    const journal=this.deviceTurns(id);
    return this.adapter.exclusive(this.key(id),async()=>{
      if(journal?.hasPending)await journal.persist();
      return run();
    });
  }
  async read(id:string):Promise<AccountData> {
    const journal=this.deviceTurns(id);if(!journal)return this.readAccount(id);
    const cursor=journal.cursor;
    const [data]=await Promise.all([this.readAccount(id),journal.load()]);
    const restored=journal.restore(data,cursor);
    if(journal.hasSaved)void this.checkpointTurns(id).catch(error=>reportCacheFailure('turn-checkpoint',error));
    return restored;
  }
  private async readAccount(id: string): Promise<AccountData> {
    const text = await this.adapter.getItem(this.key(id));
    if (text) { const parsed = JSON.parse(text); if (parsed?.version !== 1 || !parsed.responses || !parsed.queues || !parsed.local) throw new Error('Saved portal data needs recovery; the original data was kept.'); if (text.length * 3 > PRUNE_ON_LOAD_BYTES && utf8Size(text) > PRUNE_ON_LOAD_BYTES) this.trim(parsed, id); return parsed; }
    if (this.adapter.supportsBrowserImports === false) return emptyAccountData();
    // Previous browser saves belong to their serving origin.
    const legacyOrigin=await this.adapter.getItem(LEGACY_ORIGIN_KEY);
    const originalOrigin=typeof globalThis.location?.origin==='string'?globalThis.location.origin:DEFAULT_API_ORIGIN;
    if(apiOrigin(this.backend)!==apiOrigin(legacyOrigin??originalOrigin))return emptyAccountData();
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
  async write(id: string, data: AccountData, options: {optionalCache?: boolean} = {}): Promise<void> {
    // One atomic replacement commits queue+snapshot together on every platform.
    let serialized = JSON.stringify(data);
    // Each quota group is a subset of this record. Small saves need neither
    // a second serialization nor a scan of every match and downloaded asset.
    const smallestBudget = Math.min(RECOVERABLE_BUDGET, MATCH_BUDGET, ARCHIVE_BUDGET, LOCAL_BUDGET);
    if (serialized.length * 3 > smallestBudget && utf8Size(serialized) > smallestBudget) {
      this.trim(data,id);
      serialized = JSON.stringify(data);
    }
    type Candidate = {key: string; at: number; priority?: number; bytes?: number; evict: () => Promise<void>};
    let candidates: Candidate[] | null = null;
    // Quota recovery sheds in a fixed order: replaceable downloads and legacy
    // origin caches, recovery copies of already-removed matches, finished
    // local matches the cloud has acknowledged, and only then the remaining
    // downloads pinned by durable records (everything except the active
    // game's own package). Queues, conflicts, creations and local state
    // itself are never shed, so a pending save can always drain once the
    // recoverable bulk around it is gone.
    let stage = 0;
    const buildStage = async (): Promise<Candidate[]> => {
      const priorities = responseRetentionPriorities(data,this.matchUsers.get(id) || id);
      const responseCandidate = (path: string): Candidate => ({key:path,priority:priorities.get(path) || 0,at:validRecency(data.responseRecency?.[path]),bytes:utf8Size(JSON.stringify(data.responses[path])),evict:async()=>{delete data.responses[path];if(data.responseRecency)delete data.responseRecency[path];}});
      const byPriority = (a: Candidate, b: Candidate) => (a.priority || 0)-(b.priority || 0) || a.at-b.at || a.key.localeCompare(b.key);
      if (stage === 0) {
        const pinned = protectedResponsePaths(data,this.activeGames.get(id));
        const list = Object.keys(data.responses).filter(path => !pinned.has(path)).map(responseCandidate);
        list.push(...await originEvictions(this.adapter,this.key(id)));
        return list.sort(byPriority);
      }
      if (stage === 1) {
        return data.archivedMatches.map((entry, index) => ({entry, index, at: savedTimestamp(entry)}))
          .sort((a, b) => a.at - b.at || a.index - b.index)
          .map(({entry, at}) => ({key:`archived:${String(entry?.id ?? '')}`,at,bytes:utf8Size(JSON.stringify(entry)),evict:async()=>{const index = data.archivedMatches.indexOf(entry); if (index >= 0) data.archivedMatches.splice(index, 1);}}));
      }
      if (stage === 2) {
        return oldestFirst(Object.keys(data.local).filter(matchId => sheddableLocalMatch(data, matchId)).map(matchId => [matchId, data.local[matchId]] as [string, LocalMatch]), match => savedTimestamp(match))
          .map(([matchId, match]) => ({key:`local:${matchId}`,at:savedTimestamp(match),bytes:entryBytes(matchId, match),evict:async()=>{delete data.local[matchId];}}));
      }
      const active = this.activeGames.get(id);
      const keepActive = (path: string) => !!active && (path === `/games/${active.id}` || path === `/games/${encodeURIComponent(active.id)}`
        || (active.version === undefined ? path.startsWith(`/games/${encodeURIComponent(active.id)}/versions/`) : path === `/games/${encodeURIComponent(active.id)}/versions/${active.version}`));
      return Object.keys(data.responses).filter(path => !keepActive(path)).map(responseCandidate).sort(byPriority);
    };
    for (let attempt=0;;attempt++) {
      try {await this.adapter.setItem(this.key(id), attempt === 0 ? serialized : JSON.stringify(data));return;}
      catch (error) {
        if (!isQuotaError(error)) throw error;
        if (attempt > 200) throw error;
        if (!candidates) candidates = await buildStage();
        while (!candidates.length) {
          // Optional downloads/access times must not displace the rules or
          // history required by saved work. Durable writes can use the final
          // recovery stage; failed writes leave the stored copy untouched.
          if (stage >= (options.optionalCache ? 2 : 3)) throw error;
          stage++; candidates = await buildStage();
        }
        const batch = [];let freed=0;
        const target=32768*2**Math.min(attempt, QUOTA_RETRIES);
        // Retry before removing the newest remaining cache entry. Small old
        // metadata must not consume every retry before reaching a large cache.
        const priority = candidates[0].priority || 0;
        while(candidates.length&&(batch.length===0||(freed<target&&candidates.length>1&&(candidates[0].priority || 0)===priority))){const candidate=candidates.shift()!;batch.push(candidate);freed+=candidate.bytes||1;}
        for (const candidate of batch) await candidate.evict();
      }
    }
  }
  async mutate<T>(id: string, update: (data: AccountData) => T | Promise<T>, options: {optionalCache?: boolean} = {}): Promise<T> {
    return this.lock(id, async () => { const data = await this.read(id); const result = await update(data); await this.write(id, data,options); return result; });
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
      // Tabs and foreground/background downloads can start from different name
      // dictionaries. Merge while holding the shared storage lock so a later
      // writer cannot discard names another download has already persisted.
      if (path === '/portal/match-games' && value && typeof value === 'object' && !Array.isArray(value)) {
        value = {...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),...value};
      }
      data.responses[path] = value;
      if (matchId) hydrateSinglePlayer(data,value);
      touchResponse(data,path);
      try {await this.write(id,data,{optionalCache:true});} catch (error) {
        // A replaceable download may be served from memory. Durable mutation
        // callers still receive write failures and never lose their old save.
        reportCacheFailure('download',error);
        const persisted = await this.read(id); return {value,data:persisted};
      }
      return {value,data};
    });
  }
  async touch(id: string, path: string): Promise<void> {
    try {await this.lock(id,async()=>{const data=await this.read(id);if(!Object.hasOwn(data.responses,path))return;touchResponse(data,path);await this.write(id,data,{optionalCache:true});});}
    catch (error) {reportCacheFailure('recency',error);}
  }
  async preserveMergedAccounts(targetId: string, sourceIds: string[]): Promise<void> {
    const sources: { id: string; data: AccountData }[] = [];
    for (const id of [...new Set(sourceIds)].filter(id => id && id !== targetId)) {
      await this.deviceTurns(id)?.persist();
      const data=await this.read(id);
      if(id==='visitor' && data.visitor_claimed_by && data.visitor_claimed_by!==targetId)continue;
      sources.push({id,data});
    }
    if (!sources.length) return;
    await this.mutate(targetId, target => {
      for (const { id, data: source } of sources) {
        const collisions: Record<string, any> = {}; const packages: Record<string, any> = {}; const matches: Record<string, any> = {}; const copied: string[] = []; const copiedCreations:string[]=[];
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
        for(const [matchId,creation] of Object.entries(source.creations || {})) {
          const snapshot=source.responses[`/matches/${matchId}`];if(!snapshot)continue;
          const path=`/games/${snapshot.game_id}/versions/${snapshot.game_version}`, sourcePackage=source.responses[path], targetPackage=target.responses[path];
          if(target.creations?.[matchId] && !equal(target.creations[matchId],creation)
            || sourcePackage && targetPackage && !equal(sourcePackage,targetPackage))continue;
          target.creations ||= {};target.creations[matchId]=JSON.parse(JSON.stringify(creation));copiedCreations.push(matchId);
          if(!target.responses[`/matches/${matchId}`])target.responses[`/matches/${matchId}`]={...JSON.parse(JSON.stringify(snapshot)),owner_user_id:targetId,
            players:snapshot.players.map((player:any)=>({...player,...(player.user_id===id?{user_id:targetId}:{})}))};
          if(sourcePackage&&!targetPackage)target.responses[path]=JSON.parse(JSON.stringify(sourcePackage));
        }
        for (const matchId of new Set([...Object.keys(source.queues), ...Object.keys(source.conflicts)])) {
          const snapshot = source.responses[`/matches/${matchId}`]; if (!snapshot) continue;
          matches[matchId] = snapshot; const path = `/games/${snapshot.game_id}/versions/${snapshot.game_version}`; if (source.responses[path]) packages[path] = source.responses[path];
        }
        const record = JSON.parse(redactedArchive({ kind: 'account-merge', sourceAccount: id, localIds: copied, localMatches: collisions, matches, packages, queues: source.queues, creations:source.creations, conflicts: source.conflicts, previousArchives: source.archives, archivedMatches: source.archivedMatches }));
        // Online intents never become the surviving account's outgoing queue.
        // Their original request IDs and bases remain available for review.
        if (!target.archives.some(existing => { if (existing.kind !== record.kind || existing.sourceAccount !== id) return false; const { savedAt: _savedAt, ...previous } = existing; return equal(previous, record); })) target.archives.push({ ...record, savedAt: new Date().toISOString() });
        if (!target.selectedId && source.selectedId && (target.local[source.selectedId] || copiedCreations.includes(source.selectedId))) target.selectedId = source.selectedId;
      }
    });
    if(sources.some(source=>source.id==='visitor'))await this.mutate('visitor',data=>{data.visitor_claimed_by=targetId;});
  }
  trim(data: AccountData, id?: string) {
    const pinned = protectedResponsePaths(data,id ? this.activeGames.get(id) : undefined);
    const priorities = responseRetentionPriorities(data,id ? this.matchUsers.get(id) || id : undefined);
    const paths = Object.keys(data.responses);
    // Match packages need substantially more room than catalog/search responses.
    // Actual device quota still wins, using the same priority order in write().
    for (const matches of [false,true]) {
      const entries = paths.filter(path => priorities.has(path) === matches);
      let bytes = entries.reduce((total,path) => total+utf8Size(JSON.stringify(data.responses[path]))+utf8Size(JSON.stringify(path))+2,2);
      entries.sort((a,b) => (priorities.get(a) || 0)-(priorities.get(b) || 0) || validRecency(data.responseRecency?.[a])-validRecency(data.responseRecency?.[b]) || a.localeCompare(b));
      for (const path of entries) {
        if (bytes <= (matches ? MATCH_BUDGET : RECOVERABLE_BUDGET)) break;
        if (pinned.has(path)) continue;
        bytes -= utf8Size(JSON.stringify(data.responses[path])) + utf8Size(JSON.stringify(path)) + 2;
        delete data.responses[path]; if (data.responseRecency) delete data.responseRecency[path];
      }
    }
    // Archived matches are recovery copies of games already removed from the
    // live lists; retain only a bounded newest window of them.
    if (data.archivedMatches.length) {
      let bytes = data.archivedMatches.reduce((total, entry) => total + utf8Size(JSON.stringify(entry)), 0);
      if (bytes > ARCHIVE_BUDGET) {
        const drop = new Set<number>();
        const order = data.archivedMatches.map((entry, index) => ({entry, index, at: savedTimestamp(entry)})).sort((a, b) => a.at - b.at || a.index - b.index);
        for (const {entry, index} of order) { if (bytes <= ARCHIVE_BUDGET) break; drop.add(index); bytes -= utf8Size(JSON.stringify(entry)); }
        if (drop.size) data.archivedMatches = data.archivedMatches.filter((_, index) => !drop.has(index));
      }
    }
    // Finished local matches the cloud has acknowledged can be downloaded
    // again, so bound their retained payloads oldest-first. Anything pending,
    // unsynced, conflicted or selected is durable and always kept.
    const localIds = Object.keys(data.local);
    if (localIds.length) {
      let bytes = localIds.reduce((total, localId) => total + entryBytes(localId, data.local[localId]), 0);
      if (bytes > LOCAL_BUDGET) {
        for (const [localId, match] of oldestFirst(localIds.map(localId => [localId, data.local[localId]] as [string, LocalMatch]), match => savedTimestamp(match))) {
          if (bytes <= LOCAL_BUDGET) break;
          if (!sheddableLocalMatch(data, localId)) continue;
          bytes -= entryBytes(localId, match); delete data.local[localId];
        }
      }
    }
  }
}
