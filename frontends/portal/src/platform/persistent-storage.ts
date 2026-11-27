export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
export const DELETED_VALUE = '\u0000buildplay.deleted.v1';

/** Serialize operations on each key and share reads of installation metadata. */
export function createPersistentStorage(fallback: StorageBackend, native: StorageBackend | null, cachedKeys:ReadonlySet<string>=new Set()) {
  const backend = native ?? fallback;
  const pending = new Map<string, Promise<void>>();
  const cached = new Map<string, Promise<string|null>>();
  function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const result = (pending.get(key) || Promise.resolve()).then(run, run);
    const settled = result.then(() => {}, () => {}); pending.set(key, settled);
    void settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
    return result;
  }
  const read = (key: string): Promise<string | null> => serial(key, async () => {
    const value = await backend.getItem(key);
    if (value === null || value === DELETED_VALUE) return null;
    if (typeof value !== 'string') throw new Error('Saved native data has an invalid format');
    return value;
  });
  // Sync and a foreground move can request the same account snapshot together.
  // Share that in-flight read. After it settles, only installation metadata
  // stays cached, so a later account read sees changes from other writers.
  const getItem = (key: string): Promise<string|null> => {
    const existing=cached.get(key);
    if(existing)return existing;
    const clear=()=>{if(cached.get(key)===result)cached.delete(key);};
    const result=read(key).then(value=>{
      if(!cachedKeys.has(key))clear();
      return value;
    },error=>{clear();throw error;});
    cached.set(key,result);
    return result;
  };
  const setItem = (key: string, value: string): Promise<void> => {
    cached.delete(key);
    return serial(key, () => backend.setItem(key, value));
  };
  const removeItem = (key: string): Promise<void> => {
    cached.delete(key);
    return serial(key, () => backend.removeItem(key));
  };
  const keys = async (): Promise<string[]> =>
    [...await backend.getAllKeys()];
  return { getItem, setItem, removeItem, keys };
}
