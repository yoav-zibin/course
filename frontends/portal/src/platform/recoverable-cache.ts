/** Public translation responses are replaceable; preferences and saves are not. */
export const I18N_RECENCY_KEY = 'game-platform.i18n-recency.v1';
export function utf8Size(value: string): number {
  let size = 0;
  for (const point of value) { const code = point.codePointAt(0)!; size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return size;
}
interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  keys(): Promise<string[]>;
  removeItem?(key: string): Promise<void>;
}
export function isQuotaError(error: unknown): boolean {
  const value = error as {name?: string; code?: string | number; message?: string} | null;
  return !!value && (/^(QuotaExceededError|NS_ERROR_DOM_QUOTA_REACHED)$/.test(value.name || '')
    || [22, 1014, 'ENOSPC', 'SQLITE_FULL'].includes(value.code!)
    || /quota.{0,30}(?:exceed|full)|(?:disk|database)(?: is)? full|no space left on device/i.test(value.message || ''));
}
export function isTranslationCacheKey(key: string): boolean {
  return key === 'game-platform.i18n-locales.v1'
    || /^game-platform\.i18n-(?:catalog|games|bundle)\.v1:[A-Za-z0-9_-]{1,35}$/.test(key);
}
async function recency(storage: CacheStorage) {
  try {
    const saved = JSON.parse(await storage.getItem(I18N_RECENCY_KEY) || 'null');
    const entries = new Map<string, number>();
    for (const entry of Array.isArray(saved?.entries) ? saved.entries.slice(-64) : []) {
      if (typeof entry?.key === 'string' && isTranslationCacheKey(entry.key) && Number.isSafeInteger(entry.at) && entry.at >= 0) entries.set(entry.key, Math.max(entries.get(entry.key) || 0, entry.at));
    }
    return {clock: Number.isSafeInteger(saved?.clock) && saved.clock >= 0 ? saved.clock : 0, entries};
  } catch { return {clock: 0, entries: new Map<string, number>()}; }
}
export async function touchTranslationCache(storage: CacheStorage, key: string): Promise<void> {
  if (!isTranslationCacheKey(key)) return;
  try {
    const saved = await recency(storage);
    const clock = Math.max(Date.now(), saved.clock + 1, ...[...saved.entries.values()].map(at => at + 1));
    saved.entries.set(key, clock);
    await storage.setItem(I18N_RECENCY_KEY, JSON.stringify({clock, entries: [...saved.entries].sort((a,b) => a[1]-b[1]).slice(-64).map(([key,at]) => ({key,at}))}));
  } catch { /* Optional timestamps must not turn a cache hit into an error. */ }
}
export async function translationEvictions(storage: CacheStorage): Promise<{key: string; at: number}[]> {
  if (!storage.removeItem) return [];
  try {
    const saved = await recency(storage);
    return (await storage.keys()).filter(isTranslationCacheKey).slice(0,64).map(key => ({key, at: saved.entries.get(key) || 0}));
  } catch { return []; }
}
