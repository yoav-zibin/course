import * as storage from './storage';
import {touchTranslationCache} from './recoverable-cache';
import sharedCopy from './ui-copy.json';
let locale = 'en';
let messages: Record<string, string> = {};
let bundle: any = null;
let direction: 'ltr' | 'rtl' = 'ltr';
let baseUrl = '';
let offlineOnly = false;
let localeRequest = 0;
let locales: any[] = [{ code: 'en', name: 'English', direction: 'ltr' }, { code: 'es', name: 'Español', direction: 'ltr' }, { code: 'fr', name: 'Français', direction: 'ltr' }, { code: 'de', name: 'Deutsch', direction: 'ltr' }, { code: 'pt', name: 'Português', direction: 'ltr' }, { code: 'zh', name: '中文', direction: 'ltr' }, { code: 'hi', name: 'हिन्दी', direction: 'ltr' }, { code: 'ar', name: 'العربية', direction: 'rtl' }];
const listeners = new Set<() => void>();
const copyCatalog = sharedCopy as Record<string, Record<string, string>>;
// Explicitly authored interface copy only. Game text and account names enter
// through parameters and are never used as translation keys.
export function copyText(source: string, params: Record<string, any> = {}): string {
  const value = locale === 'en' ? source : copyCatalog[source]?.[locale] ?? source;
  return value.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
export function t(key: string, params: Record<string, any> = {}, fallback = key): string {
  return (messages[key] ?? copyText(fallback)).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
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
  const previous=game._sourceText||{},original=(key:string,fallback:any)=>Object.hasOwn(previous,key)?previous[key]:fallback;
  const source={name:original('name',game.name),description:original('description',game.description),
    game_logic_rules:original('game_logic_rules',game.game_logic_rules??game.rules),
    game_ui_rules:original('game_ui_rules',game.game_ui_rules??game.ui_instructions),
    tutorial_text:original('tutorial_text',game.tutorial_text??game.tutorial?.text)};
  const texts=gameTexts(game),authored=locale==='en'?null:game.translations?.[locale];
  const translated=(value:unknown)=>typeof value==='string'&&value.trim()?value:undefined;
  return {...game,_sourceText:source,name:translated(texts?.name)||translated(texts?.display_name)||source.name,description:translated(texts?.description)||translated(texts?.short_description)||source.description,
    game_logic_rules:translated(authored?.game_logic_rules)||source.game_logic_rules,
    game_ui_rules:translated(authored?.game_ui_rules)||source.game_ui_rules,
    tutorial_text:translateTutorial(source.tutorial_text,authored?.tutorial_strings)};
}
function translateTutorial(source:unknown,table:unknown):unknown {
  if(typeof source!=='string'||!table||typeof table!=='object')return source;
  const entries=Object.entries(table).filter(([key,value])=>key&&typeof value==='string'&&value&&source.includes(key));
  if(!entries.length)return source;
  const values=Object.fromEntries(entries),pattern=entries.map(([key])=>key).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  // One literal pass: translated output must never become another source key.
  return source.replace(new RegExp(pattern,'g'),key=>values[key] as string);
}
async function cacheGet(key: string) { try { const text = await storage.getItem(key); if (!text) return null; const value = JSON.parse(text); await touchTranslationCache(storage,key); return value; } catch { return null; } }
async function cacheSet(key: string, value: any) { try { await storage.setItem(key, JSON.stringify(value)); await touchTranslationCache(storage,key); } catch { /* translations are recoverable */ } }
function adopt(value: any) { bundle = value; messages = value.catalog?.messages ?? value.messages ?? {}; direction = value.direction ?? value.catalog?.direction ?? 'ltr'; listeners.forEach(fn => fn()); }
export async function configureI18n(base: string, preferred?: string, localOnly = false): Promise<void> {
  baseUrl = base; offlineOnly = localOnly;
  const savedLocales = await cacheGet('game-platform.i18n-locales.v1'); locales = (Array.isArray(savedLocales) ? savedLocales : savedLocales?.locales) ?? locales;
  if (!offlineOnly) try { const response = await fetch(`${baseUrl}/i18n/locales`); if (response.ok) { const data = await response.json(); locales = data.locales; await cacheSet('game-platform.i18n-locales.v1', data); } } catch { /* offline list */ }
  const stored = await storage.getItem('game-platform.locale.v1').catch(() => null);
  await setLocale(preferred || stored || 'en');
}
export async function setLocale(value: string): Promise<boolean> {
  const request = ++localeRequest, base = baseUrl, localOnly = offlineOnly;
  const current = () => request === localeRequest;
  locale = value; direction = locales.find(item => item.code === value)?.direction ?? 'ltr';
  await storage.setItem('game-platform.locale.v1', value).catch(() => {});
  if (!current()) return false;
  const key = `game-platform.i18n-bundle.v1:${value}`;
  const saved = await cacheGet(key); if (!current()) return false;
  if (saved?.data) adopt(saved.data); else { messages = {}; bundle = null; listeners.forEach(fn => fn()); }
  if (!localOnly) try { const response = await fetch(`${base}/i18n/bundle/${encodeURIComponent(value)}`); if (response.ok && current()) { const data = await response.json(); if (!current()) return false; adopt(data); await cacheSet(key, { data }); } } catch { /* cached catalogs and supplied English fallbacks remain usable */ }
  return current();
}
export const I18n = { t, plural, code: getLocale, direction: getDirection, locales: getLocales, gameTexts, setLocale };
