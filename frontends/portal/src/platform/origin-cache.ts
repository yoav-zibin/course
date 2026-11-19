import {protectedResponsePaths} from '../core/cache-policy';
import type {AccountData} from '../core/types';
import {translationEvictions,utf8Size} from './recoverable-cache';

interface OriginStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
export interface OriginEviction {key: string; at: number; bytes?: number; evict(): Promise<void>}
const PREFIX = 'game-platform.portal.v1.';
const DELETED = '__portal_offline_deleted__';
const record = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const blank = (): AccountData => ({version:1,responses:{},queues:{},conflicts:{},local:{},archives:[],archivedMatches:[],selectedId:null});
const optional = (run:()=>Promise<void>) => async () => {try {await run();} catch { /* The caller retries the real write; no reclaimed space is assumed. */ }};

async function json(storage: OriginStorage, key: string): Promise<any> {
  const text = await storage.getItem(key);
  return text === null || text === DELETED ? undefined : JSON.parse(text);
}
function normalize(raw: any): AccountData {
  if (!record(raw) || !record(raw.responses) || !record(raw.queues) || !record(raw.local)
    || raw.conflicts !== undefined && !record(raw.conflicts)
    || raw.archives !== undefined && !Array.isArray(raw.archives)
    || raw.archivedMatches !== undefined && !Array.isArray(raw.archivedMatches)
    || raw.selectedId != null && typeof raw.selectedId !== 'string') throw new Error('Unknown legacy account format');
  if (!Object.values(raw.queues).every(Array.isArray) || !Object.values(raw.local).every(record)
    || raw.conflicts && !Object.values(raw.conflicts).every(record)) throw new Error('Unreadable legacy durable record');
  return {...blank(),...raw,conflicts:raw.conflicts || {},archives:raw.archives || [],archivedMatches:raw.archivedMatches || [],selectedId:raw.selectedId ?? null};
}
function baseFor(key: string): string {
  const suffix = key.slice(PREFIX.length);
  const piece = /\.[rqcl]\./.exec(suffix);
  if (piece) return key.slice(0,PREFIX.length + piece.index);
  return key.replace(/\.(?:meta|recency|lru|archives|archived|selected)$/, '');
}

/** Read every durable dependency, including a retained pre-migration backup.
 * Response bodies are needed only for pinned match snapshots. An optional
 * malformed response never makes a queue/local/archive eligible for removal. */
async function legacyState(storage: OriginStorage, base: string, keys: string[]) {
  const raw = await json(storage,base);
  const original = raw === undefined ? blank() : normalize(raw);
  const split = blank();
  const responseKeys = new Map<string,string>();
  for (const key of keys) {
    for (const [part,group] of [['q','queues'],['c','conflicts'],['l','local']] as const) {
      if (!key.startsWith(`${base}.${part}.`)) continue;
      const id = decodeURIComponent(key.slice(base.length + 3));
      const value = await json(storage,key);
      if (value === undefined) continue;
      if (part === 'q' ? !Array.isArray(value) : !record(value)) throw new Error('Unreadable legacy durable record');
      Object.defineProperty(split[group],id,{value,writable:true,enumerable:true,configurable:true});
    }
    if (key.startsWith(`${base}.r.`)) {
      try {
        const path = decodeURIComponent(key.slice(base.length + 3));
        if (!path.startsWith('/')) continue;
        responseKeys.set(path,key); split.responses[path] = undefined;
      } catch { /* An undecodable key is preserved rather than guessed. */ }
    }
  }
  for (const [suffix,field] of [['archives','archives'],['archived','archivedMatches'],['selected','selectedId']] as const) {
    const value = await json(storage,`${base}.${suffix}`);
    if (value === undefined) continue;
    if (field === 'selectedId' ? value !== null && typeof value !== 'string' : !Array.isArray(value)) throw new Error('Unreadable legacy recovery record');
    (split as any)[field] = value;
  }
  const manifest=await json(storage,`${base}.meta`);
  if (manifest !== undefined) {
    if (!record(manifest)) throw new Error('Unreadable legacy manifest');
    for (const group of ['queues','conflicts','local'] as const) {
      const listed=manifest[group];
      if (listed !== undefined && (!Array.isArray(listed) || listed.some(id=>typeof id !== 'string'))) throw new Error('Unknown legacy manifest');
      for (const id of listed || []) if (!Object.hasOwn(split[group],id) && !Object.hasOwn(original[group],id)) throw new Error('Legacy durable record needs recovery');
    }
  }
  const ids = new Set([...Object.keys(original.queues),...Object.keys(original.conflicts),...Object.keys(split.queues),...Object.keys(split.conflicts),
    ...[original.selectedId,split.selectedId].filter((id):id is string => !!id)]);
  for (const id of ids) {
    for (const path of new Set([`/matches/${id}`,`/matches/${encodeURIComponent(id)}`])) {
      const key = responseKeys.get(path);
      if (key) split.responses[path] = await json(storage,key);
    }
    const references = [original.local[id],split.local[id],original.conflicts[id]?.remote,split.conflicts[id]?.remote,
      original.responses[`/matches/${id}`],original.responses[`/matches/${encodeURIComponent(id)}`],
      split.responses[`/matches/${id}`],split.responses[`/matches/${encodeURIComponent(id)}`]];
    if (!references.some(match => typeof match?.game_id === 'string' && match.game_version !== undefined)) throw new Error('Legacy pinned package cannot be identified');
  }
  const merged:AccountData = {...blank(),responses:{...original.responses,...Object.fromEntries(Object.entries(split.responses).filter(([,value])=>value !== undefined))},queues:{...original.queues,...split.queues},
    conflicts:{...original.conflicts,...split.conflicts},local:{...original.local,...split.local},
    archives:[...original.archives,...split.archives],archivedMatches:[...original.archivedMatches,...split.archivedMatches],selectedId:split.selectedId || original.selectedId};
  const pinned = new Set([...protectedResponsePaths(original),...protectedResponsePaths(split),...protectedResponsePaths(merged)]);
  const recency = new Map<string,number>();
  for (const [path,at] of Object.entries(raw?.cacheAccess || {})) recency.set(path,time(at));
  // Recency is optional. Corrupt metadata never changes protected records.
  for (const suffix of ['lru','recency']) try {
    const saved = await json(storage,`${base}.${suffix}`);
    if (suffix === 'lru' && record(saved)) for (const [path,at] of Object.entries(saved)) recency.set(path,Math.max(recency.get(path) || 0,time(at)));
    if (Array.isArray(saved?.entries)) for (const entry of saved.entries) if (typeof entry?.path === 'string') recency.set(entry.path,Math.max(recency.get(entry.path) || 0,time(entry.at)));
  } catch { /* Optional access times can be rebuilt. */ }
  return {raw,pinned,responseKeys,recency};
}

/** Candidates contain only refetchable responses in the retired Portal layout
 * and public translations. New account blobs, credentials, preferences and
 * unknown keys are never candidates. Caller holds its storage write lock. */
export async function originEvictions(storage: OriginStorage, currentAccountKey: string): Promise<OriginEviction[]> {
  const candidates:OriginEviction[] = [];
  let keys:string[];
  try {keys=await storage.keys();} catch {return candidates;}
  for (const entry of await translationEvictions(storage)) {
    let size=0;try {size=utf8Size(await storage.getItem(entry.key) || '');} catch { /* Optional estimate. */ }
    candidates.push({...entry,bytes:size,evict:optional(async()=>{await storage.removeItem?.(entry.key);})});
  }
  const bases = new Set(keys.filter(key => key !== currentAccountKey && key.startsWith(PREFIX)).map(baseFor));
  for (const base of bases) {
    let state:Awaited<ReturnType<typeof legacyState>>;
    try {state=await legacyState(storage,base,keys);} catch {continue;}
    for (const [path,key] of state.responseKeys) {
      if (state.pinned.has(path) || !storage.removeItem) continue;
      let size=0;try {size=utf8Size(await storage.getItem(key) || '');} catch {continue;}
      candidates.push({key,at:state.recency.get(path) || 0,bytes:size,evict:optional(async()=>{
        // Re-read pins: a queue, selection or local game may have appeared
        // since the quota-recovery list was collected.
        const latest=await legacyState(storage,base,await storage.keys());
        if (!latest.pinned.has(path) && latest.responseKeys.get(path) === key) await storage.removeItem!(key);
      })});
    }
    if (!state.raw) continue;
    for (const path of Object.keys(state.raw.responses)) {
      if (state.pinned.has(path)) continue;
      candidates.push({key:base,at:state.recency.get(path) || 0,bytes:utf8Size(JSON.stringify(state.raw.responses[path])) + utf8Size(JSON.stringify(path)) + 2,evict:optional(async()=>{
        const latest=await legacyState(storage,base,await storage.keys());
        if (!latest.raw || latest.pinned.has(path) || !Object.hasOwn(latest.raw.responses,path)) return;
        // Atomic replacement retains every durable and unknown field. Never
        // delete a retained migration backup to make a new write fit.
        delete latest.raw.responses[path];
        if (record(latest.raw.cacheAccess)) delete latest.raw.cacheAccess[path];
        await storage.setItem(base,JSON.stringify(latest.raw));
      })});
    }
  }
  return candidates.sort((a,b)=>a.at-b.at || a.key.localeCompare(b.key));
}
