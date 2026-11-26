import {reportCacheFailure} from './cache-diagnostics';

export interface LegacyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
export interface PersistentBackend {
  getPersistentItem(key: string): Promise<string | null>;
  setPersistentItem(key: string, value: string): Promise<void>;
  removePersistentItem(key: string): Promise<void>;
  getPersistentKeys(): Promise<string[]>;
}
export const DELETED_VALUE = '\u0000buildplay.deleted.v1';

/** Bulk saves use atomic native files, avoiding Android AsyncStorage's database
 * and per-row limits. Originals remain available after interrupted migration. */
export function createPersistentStorage(legacy: LegacyStorage, native: PersistentBackend | null, cachedKeys:ReadonlySet<string>=new Set()) {
  const pending = new Map<string, Promise<void>>();
  const cached = new Map<string, Promise<string|null>>();
  function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const result = (pending.get(key) || Promise.resolve()).then(run, run);
    const settled = result.then(() => {}, () => {}); pending.set(key, settled);
    void settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
    return result;
  }
  const read = (key: string, retryMigration?:()=>void): Promise<string | null> => serial(key, async () => {
    if (!native) return legacy.getItem(key);
    const current = await native.getPersistentItem(key);
    if (current === DELETED_VALUE) return null;
    if (current !== null) { if (typeof current !== 'string') throw new Error('Saved native data has an invalid format'); return current; }
    const original = await legacy.getItem(key);
    if (original !== null) {
      try {await native.setPersistentItem(key, original);}
      catch (error) {retryMigration?.();reportCacheFailure('migration',error);}
    }
    // The retained original is still readable if the optional copy failed.
    // No marker is written, so a later read retries the atomic migration.
    return original;
  });
  // Only cache the small installation metadata needed by every request.
  // Successful reads include missing values. Failed reads are retried.
  const getItem = (key: string): Promise<string|null> => {
    if(!cachedKeys.has(key))return read(key);
    const existing=cached.get(key);
    if(existing)return existing;
    const clear=()=>{if(cached.get(key)===result)cached.delete(key);};
    const result=read(key,clear).catch(error=>{clear();throw error;});
    cached.set(key,result);
    return result;
  };
  const setItem = (key: string, value: string): Promise<void> => {
    cached.delete(key);
    return serial(key, () => native ? native.setPersistentItem(key, value) : legacy.setItem(key, value));
  };
  const removeItem = (key: string): Promise<void> => {
    cached.delete(key);
    return serial(key, () => native ? native.setPersistentItem(key, DELETED_VALUE) : legacy.removeItem(key));
  };
  const keys = async (): Promise<string[]> => {
    const oldKeys = await legacy.getAllKeys(); if (!native) return [...oldKeys];
    const all = [...new Set([...oldKeys, ...await native.getPersistentKeys()])];
    const visible = await Promise.all(all.map(async key => (await serial(key, () => native.getPersistentItem(key))) === DELETED_VALUE ? null : key));
    return visible.filter((key): key is string => key !== null);
  };
  return { getItem, setItem, removeItem, keys };
}
