import * as storage from './storage';
let locale = 'en';
let messages: Record<string, string> = {};
let bundle: any = null;
let direction: 'ltr' | 'rtl' = 'ltr';
let baseUrl = '';
let offlineOnly = false;
let locales: any[] = [{ code: 'en', name: 'English', direction: 'ltr' }, { code: 'es', name: 'Español', direction: 'ltr' }, { code: 'fr', name: 'Français', direction: 'ltr' }, { code: 'de', name: 'Deutsch', direction: 'ltr' }, { code: 'pt', name: 'Português', direction: 'ltr' }, { code: 'zh', name: '中文', direction: 'ltr' }, { code: 'hi', name: 'हिन्दी', direction: 'ltr' }, { code: 'ar', name: 'العربية', direction: 'rtl' }];
const listeners = new Set<() => void>();
export function t(key: string, params: Record<string, any> = {}, fallback = key): string {
  return (messages[key] ?? fallback).replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
export function plural(key: string, count: number, params: Record<string, any> = {}, fallbacks: Record<string, string> = {}): string {
  const form = new Intl.PluralRules(locale).select(count); return t(`${key}_${form}`, { count, ...params }, fallbacks[form] ?? fallbacks.many ?? key);
}
export const getLocale = () => locale;
export const getDirection = () => direction;
export const getLocales = () => locales;
export const subscribeI18n = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function gameTexts(game: any): any {
  const translated = bundle?.games?.[game?.id]; if (translated?.version === game?.version) return translated;
  // A pinned older package includes translations for its own immutable version;
  // the latest catalog bundle must never substitute another version's strings.
  const pinned = game?.translations?.[locale]; return pinned && typeof pinned === 'object' ? { ...pinned, strings: pinned.client_strings ?? pinned.strings ?? {} } : null;
}
export function localizeGame<T extends { id: string; version: number; name: string; description: string; [key: string]: any }>(game: T): T {
  const source = game._sourceText || { name: game.name, description: game.description }; const texts = gameTexts(game);
  return { ...game, _sourceText: source, name: texts?.name || source.name, description: texts?.description || source.description };
}
async function cacheGet(key: string) { try { const text = await storage.getItem(key); return text ? JSON.parse(text) : null; } catch { return null; } }
async function cacheSet(key: string, value: any) { try { await storage.setItem(key, JSON.stringify(value)); } catch { /* translations are recoverable */ } }
function adopt(value: any) { bundle = value; messages = value.catalog?.messages ?? value.messages ?? {}; direction = value.direction ?? value.catalog?.direction ?? 'ltr'; listeners.forEach(fn => fn()); }
export async function configureI18n(base: string, preferred?: string, localOnly = false): Promise<void> {
  baseUrl = base; offlineOnly = localOnly;
  const savedLocales = await cacheGet('game-platform.i18n-locales.v1'); locales = (Array.isArray(savedLocales) ? savedLocales : savedLocales?.locales) ?? locales;
  if (!offlineOnly) try { const response = await fetch(`${baseUrl}/i18n/locales`); if (response.ok) { const data = await response.json(); locales = data.locales; await cacheSet('game-platform.i18n-locales.v1', data); } } catch { /* offline list */ }
  const stored = await storage.getItem('game-platform.locale.v1').catch(() => null);
  await setLocale(preferred || stored || 'en');
}
export async function setLocale(value: string): Promise<void> {
  locale = value; direction = locales.find(item => item.code === value)?.direction ?? 'ltr';
  await storage.setItem('game-platform.locale.v1', value).catch(() => {});
  const key = `game-platform.i18n-bundle.v1:${value}`;
  const saved = await cacheGet(key); if (saved?.data) adopt(saved.data); else { messages = {}; bundle = null; listeners.forEach(fn => fn()); }
  if (!offlineOnly) try { const response = await fetch(`${baseUrl}/i18n/bundle/${encodeURIComponent(value)}`); if (response.ok && locale === value) { const data = await response.json(); adopt(data); await cacheSet(key, { data }); } } catch { /* cached catalogs and supplied English fallbacks remain usable */ }
}
export const I18n = { t, plural, code: getLocale, direction: getDirection, locales: getLocales, gameTexts, setLocale };
