import {AccountScopeChangedError,visibleErrorMessage} from './account-scope';
import {deviceTurn} from './device-turns';
import {playerLink} from './links';
import type {InviteShareChannel} from './invite-sharing';
import {withoutPersonalReferral} from './account-data';
import { useSyncExternalStore } from 'react';
import { PortalApi, ApiError,InactiveSignInError } from './api';
import {recordDiagnosticEvent,recordDiagnosticLog,setDiagnosticScope} from './diagnostics';
import { AccountRepository, emptyAccountData, equal, requestId } from './repository';
import {protectedResponsePaths, matchRetentionPriority} from './cache-policy';
import {gameSearchPrefix,gameSuggestions} from './game-search';
import {isValidDownloadedGame, presentationHistoryPath} from './offline-match-data';
import {isQuotaError,utf8Size} from '../platform/recoverable-cache';
import {reportCacheFailure} from '../platform/cache-diagnostics';
import { syncAccount } from './sync';
import {RetryableSyncCompatibilityError} from './sync-compatibility';
import {hiddenMatchIds, hydrateSinglePlayer, localRevision, needsCloudSave, REMOVED_SAVED_MATCH, removedSavedMatch, savedMatchBranch, singlePlayerKind} from './single-player';
import {handsTurnToOpponent, pendingNotifications} from './notifications';
import {redactedArchive} from './redaction';
import * as storage from '../platform/storage';
import { loadAccounts, saveAccounts, loadCurrentAccount, currentAccountKey } from '../platform/credentials';
import { isOnline, watchConnectivity } from '../platform/connectivity';
import { configureI18n, setLocale, getLocale, getDirection, gameTexts, localizeGame, subscribeI18n, t, copyText } from '../platform/i18n';
import bundled from './bundled-tictactoe.json';
import { browserLogin } from '../platform/browser-login';
import { rememberUrlAttribution, newAccountAttribution, forgetMatchAttribution, purgePersonalAttribution,type MatchAttribution } from './attribution';
import type { Account, AccountData, Game, GameCarousel, Match, LocalMatch, ListKind, PortalState, PracticeOptions, InAppNotification } from './types';
export * from './types';
export { t } from '../platform/i18n';

const initial = (): PortalState => ({ ready: false, baseUrl: '', account: null, accounts: [], profile: null, deletionUpdating: false, profiles: {}, authConfig: {}, games: [], popularGames: [], recentGames: [], myMatches: [], matchGames: {}, savedGames: [], notifications: [], notificationCursor: null, unreadNotifications: 0, notificationPrompt: false, notificationPromptReady: false, localMatches: [], selectedMatch: null, selected: null, selectedGame: null, game: null, selectedGameId: null, history: null, replayIndex: null, pending: 0, conflicts: {}, archived: [], network: isOnline(), loading: false, error: null, storageError: null, locale: 'en', query: '', cursors: {} });
const listPaths: Record<ListKind, string> = { games: '/games', myMatches: '/matches', savedGames: '/users/me/saved-games' };
const carouselPaths: Record<GameCarousel, string> = {
  popularGames: '/games/popular',
  recentGames: '/users/me/recent-games',
};
const CAROUSEL_PAGE_SIZE = 8;
const unique = <T extends { id?: string; token?: string }>(values: T[]): T[] => [...new Map(values.map(v => [v.id || v.token, v])).values()];
const savedList = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];
const localHumanSeat = (match: Match) => match.players.find(player => player.kind === 'human' && player.active !== false)?.player_index ?? 0;
const LOCAL_COMPUTER_MOVE_LIMIT = 200;
class RemovedSavedMatchError extends Error {
  constructor(){super(copyText('This saved copy was removed from this device. Its recovery data is available in Preserved previous app data.'));}
}

export class PortalStore {
  constructor(private rulesExecutor: (game: { server_code: string; game_schemas?: unknown }, name: string, args: unknown[], ctx: unknown, seed: number | string, now: number) => Promise<any> = async (...args) => (await import('../game/runtime')).executeGame(...args), private loginBrowser: (baseUrl: string) => Promise<any> = browserLogin, private writeCurrentAccount: (id: string, base?: string) => Promise<void> = (id, base) => storage.setItem(currentAccountKey(base), id)) {}
  private state = initial();
  private listeners = new Set<() => void>();
  private data = emptyAccountData();
  private generation = 0;
  private profileRevision = 0;
  private selection = 0;
  private replaySelection = 0;
  private localOnly = false;
  private accountSelectionWrites: Promise<void> = Promise.resolve();
  private paginated = false;
  private paginatedCarousels = false;
  private carouselRequests = new Map<string, Promise<void>>();
  private expandedCarouselGeneration: Partial<Record<GameCarousel, number>> = {};
  private refreshPromise: Promise<void> | null = null;
  private pendingPackages = new Map<string,Promise<Game>>();
  private preparedPackage?: {generation:number; owner:string; game:Game};
  private offlineDownloadPromise: Promise<void> | null = null;
  private offlineDownloadScope = '';
  private offlineDownloadAfter = 0;
  private syncPromise: Promise<void> | null = null;
  private notificationPromise: Promise<void> | null = null;
  private dismissedNotificationIds = new Set<string>();
  private dailyLoginPromise: {key:string; promise:Promise<void>} | null = null;
  private dailyLoginDays = new Map<string,string>();
  private dailyLoginRetryAfter = new Map<string,number>();
  private notificationPromptClaim: Promise<void> | null = null;
  private offeredNotificationPrompt = new Set<string>();
  private bootstrapPromise: Promise<void> | null = null;
  private stopConnectivity?: () => void;
  private observations = new Map<string, any[]>();
  private selectedInvite: {matchId: string; token: string} | null = null;
  private requestedLink:{kind:'match'|'invite';id:string}|null=null;
  private inviteMatchIds=new Map<string,string>();
  private inviteAcceptance:{key:string;pending:Promise<Match|null>}|null=null;
  private retryAfter = 0;
  private syncCompatibilityRetryAfter = 0;
  private api = new PortalApi('', getLocale);
  private repository = new AccountRepository();
  private turnCheckpoint?:Promise<void>;
  private get turnSaveError(){return copyText('Move is in memory. Device storage could not save it yet. Keep the app open while it retries.');}
  private volatileResponses = new Map<string,Map<string,any>>();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(update: Partial<PortalState>) { if (Object.hasOwn(update, 'selectedMatch')) update.selected = update.selectedMatch; if (Object.hasOwn(update, 'game')) update.selectedGame = update.game; this.state = { ...this.state, ...update }; setDiagnosticScope(JSON.stringify([this.state.baseUrl, this.identity()])); this.listeners.forEach(fn => fn()); }
  private localize() { this.patch({ locale: getLocale(), matchGames:this.downloadedGameNames(), games: this.state.games.map(localizeGame), savedGames: this.state.savedGames.map(localizeGame), popularGames: this.state.popularGames.map(localizeGame), recentGames: this.state.recentGames.map(localizeGame), game: this.state.game ? localizeGame(this.state.game) : null }); }
  private identity() { return this.state.account?.id || 'visitor'; }
  private turnIdentity() { return this.state.profile?.id || this.state.account?.canonical_user_id || this.identity(); }
  private downloadedGameNames(): Record<string, Game> {
    const names = {...this.data.responses['/portal/match-games']};
    for (const [path, game] of Object.entries(this.data.responses)) {
      if (/^\/games\/[^/]+\/versions\/\d+$/.test(path) && game?.id && game?.name) names[`${game.id}@${game.version}`] = game;
    }
    names[`${bundled.id}@${bundled.version}`] = bundled;
    return Object.fromEntries(Object.entries(names).filter(([,game]) => game && typeof (game as Game).name === 'string').map(([key,game]) => [key,localizeGame(game as Game)]));
  }
  private async rememberMatchGame(game: Game) {
    if (!game?.id || !game.name || !Number.isSafeInteger(game.version)) return;
    const translations = Object.fromEntries(Object.entries(game.translations || {}).map(([locale, value]: [string, any]) =>
      [locale,Object.fromEntries(['name','display_name'].filter(key => typeof value?.[key] === 'string').map(key => [key,value[key]]))]));
    const metadata = {id:game.id,version:game.version,name:game._sourceText?.name || game.name,description:'',allowed_player_counts:game.allowed_player_counts || [],translations};
    const key = `${game.id}@${game.version}`, names = this.data.responses['/portal/match-games'] || {};
    if (!equal(names[key],metadata)) await this.cache('/portal/match-games',{...names,[key]:metadata});
    this.patch({matchGames:this.downloadedGameNames()});
  }
  private capture() { const epoch = this.generation, account = this.identity(), base = this.state.baseUrl; return () => { if (epoch !== this.generation || account !== this.identity() || base !== this.state.baseUrl) throw new AccountScopeChangedError(); }; }
  private async perform<T>(run: () => Promise<T>, loading = true): Promise<T> {
    // Bootstrap adopts its origin and initial account within this operation.
    // Explicit account transitions advance generation and own the new UI state.
    const epoch=this.generation;
    const guard=()=>{if(epoch!==this.generation)throw new AccountScopeChangedError();};
    if (loading) this.patch({ loading: true }); this.patch({ error: null });
    try { return await run(); }
    catch (error) { guard();const message=visibleErrorMessage(error);if(message!==null&&!(error instanceof InactiveSignInError))this.patch({ error: message }); throw error; }
    finally { if (loading) { try { guard(); this.patch({ loading: false }); } catch { /* The new account owns its loading state. */ } } }
  }
  private awaitingLocalHandoff(match: LocalMatch | undefined, data = this.data): boolean {
    if (!match?.awaitingHandoff) return false;
    const game = match.game_id === bundled.id && match.game_version === bundled.version ? bundled : data.responses[`/games/${match.game_id}/versions/${match.game_version}`];
    return game?.all_state_public !== true;
  }
  private decorate(match: Match | null): Match | null {
    if (!match) return null;
    const local = this.data.local[match.id];
    return {...match, ...(local || {}), ...(local ? {match_kind: singlePlayerKind(local)!, cloud_pending: needsCloudSave(local), saving_on_device:this.repository.deviceTurns(this.identity())?.isSaving(local.id)??false, awaitingHandoff: this.awaitingLocalHandoff(local)} : {cloud_pending:!!this.data.creations?.[match.id]}),
      pending: this.data.queues[match.id]?.length || 0, conflict: this.data.conflicts[match.id] || null};
  }
  private publishData(data: AccountData) {
    data=this.repository.deviceTurns(this.identity())?.display(data)??data;
    this.mergeVolatile(data);this.data = data; const selected = this.state.selectedMatch;
    const retired = selected && removedSavedMatch(data,selected.id), hidden = hiddenMatchIds(data);
    // Another tab can retire the selected device branch. Do not retain its
    // old board, but preserve any newer navigation to an unrelated match.
    if(retired){this.selectedInvite=null;++this.replaySelection;}
    const next = selected && !retired ? data.local[selected.id] || data.responses[`/matches/${selected.id}`] || selected : null;
    // Restore an absent profile, without replacing confirmed edits with older cached data.
    const ownProfile = this.state.account ? data.responses[`/users/${encodeURIComponent(this.state.account.id)}`] : undefined;
    const profiles: Record<string, any> = {};
    for (const [path,value] of Object.entries(data.responses)) {
      if (/^\/users\/[^/?]+$/.test(path) && value?.id) profiles[value.id] = value;
      else if (path.startsWith('/users?ids=') && Array.isArray(value)) for (const profile of value) if (profile?.id) profiles[profile.id] = profile;
    }
    this.patch({matchGames:this.downloadedGameNames(),profiles:{...profiles,...this.state.profiles},
      ...(this.state.storageError===this.turnSaveError&&!this.repository.deviceTurns(this.identity())?.hasPending?{storageError:null}:{}),
      ...(ownProfile && !this.state.profile && !this.state.deletionUpdating ? {profile: ownProfile, account: {...this.state.account!, canonical_user_id: ownProfile.id}} : {}), ...(retired ? {history:null,replayIndex:null} : {}), localMatches: Object.values(data.local).map(match => this.decorate(match) as LocalMatch), conflicts: data.conflicts, archived: [...data.archivedMatches, ...data.archives], pending: Object.values(data.queues).reduce((n, q) => n + q.length, 0) + Object.values(data.local).filter(needsCloudSave).length + Object.keys(data.creations || {}).length, selectedMatch: this.decorate(next), myMatches: this.state.myMatches.filter(match=>!hidden.has(match.id)).map(m => this.decorate(data.responses[`/matches/${m.id}`] || m)!) });
  }
  private mergeVolatile(data: AccountData) {
    const pending=this.volatileResponses.get(this.identity());if(!pending)return;
    for(const [path,value]of pending){const matchId=/^\/matches\/([^/]+)$/.exec(path)?.[1],saved=data.responses[path];if(matchId&&(data.queues[matchId]?.length||data.conflicts[matchId]))continue;if(equal(saved,value)||matchId&&saved?.move_count>value?.move_count)pending.delete(path);else data.responses[path]=value;}
  }
  private rememberVolatile(path:string,value:any,persisted:any) {
    const id=this.identity();let pending=this.volatileResponses.get(id);if(!pending){pending=new Map();this.volatileResponses.set(id,pending);}
    pending.delete(path);if(!equal(value,persisted))pending.set(path,value);
    const pinned=protectedResponsePaths(this.data,this.state.selectedGameId?{id:this.state.selectedGameId,version:this.state.game?.version}:undefined);
    let bytes=[...pending.values()].reduce((n,item)=>n+utf8Size(JSON.stringify(item)),0);
    for(const [key,item]of pending){if(pending.size<=64&&bytes<=1000000)break;if(key===path||pinned.has(key))continue;pending.delete(key);delete this.data.responses[key];bytes-=utf8Size(JSON.stringify(item));}
  }
  private async reloadData() { const id = this.identity(); const guard = this.capture(); try { const data = await this.repository.read(id); guard(); this.publishData(data); } catch (error) { guard(); if(isQuotaError(error))reportCacheFailure('read',error);else this.patch({ storageError: `Saved data is unavailable: ${(error as Error).message}. Existing saves were kept.` }); } }
  private async cache(path: string, value: any) {
    const id=this.identity(), guard=this.capture(), matchId=/^\/matches\/([^/]+)$/.exec(path)?.[1], matchPath=!!matchId;
    const preserve=(previous:any,next:any)=>matchPath&&previous&&(this.data.queues[matchId!]?.length||this.data.conflicts[matchId!]||previous.move_count>next?.move_count)?previous:next;
    const previous=this.data.responses[path];
    value=preserve(previous,value);
    this.repository.protectGame(id,this.state.selectedGameId,this.state.game?.version);
    this.repository.prioritizeMatches(id,this.turnIdentity());
    try {
      const saved=await this.repository.cacheData(id,path,value);guard();value=saved.value;
      // A later request can finish while storage is awaiting its lock. Keep a
      // newer RAM-only observation even when the older download persisted.
      const durableBranch=matchId&&(saved.data.queues[matchId]?.length||saved.data.conflicts[matchId]);
      if(!durableBranch)value=preserve(this.data.responses[path],value);
      const persisted=saved.data.responses[path];this.mergeVolatile(saved.data);
      this.data.responses=saved.data.responses;this.data.responseRecency=saved.data.responseRecency;this.data.cacheClock=saved.data.cacheClock;
      this.data.local=(this.repository.deviceTurns(id)?.display(saved.data)??saved.data).local;
      if (matchId && this.data.local[matchId]) this.patch({localMatches:Object.values(this.data.local).map(match => this.decorate(match) as LocalMatch)});
      this.rememberVolatile(path,value,persisted);
    } catch(error) {guard();value=preserve(this.data.responses[path],value);this.rememberVolatile(path,value,this.data.responses[path]);reportCacheFailure('download',error);}
    guard();this.data.responses[path]=value;return value;
  }
  private async cached(path: string): Promise<any> {const value=this.data.responses[path],guard=this.capture();await this.repository.touch(this.identity(),path);guard();return this.data.responses[path]??value;}
  private exactPackage(id:string,version:number):Game|undefined {
    const game=this.data.responses[`/games/${id}/versions/${version}`]||this.data.responses[`/games/${encodeURIComponent(id)}/versions/${version}`]||(bundled.id===id&&bundled.version===version?bundled:undefined);
    return game?.id===id&&game.version===version?game:undefined;
  }
  async request(method: string, path: string, body?: any,linkOpen?:boolean): Promise<any> { if (this.localOnly) throw new Error('This test launch runs entirely on this device.'); const guard = this.capture(); try { const result = await this.api.request(method, path, body, this.state.account,undefined,linkOpen); guard(); return result; } catch (error) { guard(); throw error; } }
  private preserveOwnDeletion(path: string, value: any, revision: number) {
    if (revision === this.profileRevision || !path.startsWith('/users') || !this.state.account) return value;
    const own = this.state.profile, ids = new Set([this.state.account.id, this.state.account.canonical_user_id, own?.id].filter(Boolean));
    if (!own) return value;
    const fields = {deletion_requested_at: own.deletion_requested_at ?? null, deletion_scheduled_at: own.deletion_scheduled_at ?? null, deletion_started_at: own.deletion_started_at ?? null};
    return Array.isArray(value) ? value.map(item => ids.has(item?.id) ? {...item,...fields} : item) : ids.has(value?.id) ? {...value,...fields} : value;
  }
  private async read(path: string, allowCached = true,linkOpen?:boolean): Promise<any> {
    const guard = this.capture(), ownProfile = !!this.state.account && path === `/users/${encodeURIComponent(this.state.account.id)}`, revision = this.profileRevision;
    if (this.localOnly) { if (allowCached && Object.hasOwn(this.data.responses, path)) return this.cached(path); throw new TypeError('This device launch is offline.'); }
    try { if (!isOnline() || Date.now() < this.retryAfter) throw new TypeError('Offline'); const result = await this.api.request('GET', path, undefined, this.state.account,undefined,linkOpen); guard(); if (ownProfile && revision !== this.profileRevision && this.state.profile) return this.state.profile; this.retryAfter = 0; this.patch({ network: isOnline() }); const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1]; if (matchId && this.data.conflicts[matchId]?.message.startsWith('The outcome of this unsaved action')) delete this.data.conflicts[matchId]; let saved = await this.cache(path, this.preserveOwnDeletion(path,result,revision)); guard(); const latest=this.preserveOwnDeletion(path,saved,revision); if(!equal(saved,latest)){saved=await this.cache(path,latest);guard();} return ownProfile && revision !== this.profileRevision && this.state.profile ? this.state.profile : saved; }
    catch (error) { guard(); if (error instanceof ApiError && error.status < 500) throw error; if (Date.now() >= this.retryAfter) this.retryAfter = Date.now() + 10000; this.patch({ network: false }); if (allowCached && Object.hasOwn(this.data.responses, path)) return this.cached(path); throw error; }
  }
  private async list(kind: ListKind, more = false): Promise<void> {
    const guard = this.capture(); const search = this.state.query; const query = new URLSearchParams(); query.set('limit', '50');
    if (more && !this.state.cursors[kind]) return;
    if (kind === 'games' && this.state.query) query.set('q', this.state.query);
    if (more && this.state.cursors[kind]) query.set('cursor', this.state.cursors[kind]!);
    const path = this.paginated ? `/v2${listPaths[kind]}?${query}` : listPaths[kind];
    const result = await this.read(path); guard(); if (kind === 'games' && search !== this.state.query) return;
    let items = this.paginated ? result.items : result;
    if (!Array.isArray(items)) throw new Error('Invalid list response');
    if (!this.paginated && kind === 'games' && this.state.query) items = items.filter((g: Game) => [g.name,g.description,...(g.alternative_names??[])].join(' ').toLowerCase().includes(this.state.query.toLowerCase()));
    const preserveTail = !more && this.paginated && this.state[kind].length > 50;
    if (more || kind === 'myMatches') items = unique([...(this.state[kind] as any[]), ...items]);
    else if (preserveTail) items = unique([...items, ...(this.state[kind] as any[]).slice(50)]);
    if (kind === 'myMatches') items = items.map((m: Match) => this.decorate(m));
    if (kind === 'games' || kind === 'savedGames') items = items.map(localizeGame);
    if (kind === 'myMatches') { const archived = hiddenMatchIds(this.data); items = items.filter((m: Match) => !archived.has(m.id)); }
    this.patch({ [kind]: items, cursors: { ...this.state.cursors, [kind]: preserveTail ? this.state.cursors[kind] : result.next_cursor || null } });
    // Stable aliases restore useful lists when the next launch is offline.
    await this.cache(listPaths[kind], kind === 'myMatches' ? this.matchSummaries(items) : items);
  }
  private loadCarousel(kind: GameCarousel, more = false): Promise<void> {
    if (more && (!this.state.cursors[kind] || !this.state.network)) return Promise.resolve();
    const key = `${this.generation}:${kind}`;
    const pending = this.carouselRequests.get(key);
    if (pending) return pending;
    const load = this.readCarousel(kind, more).finally(() => this.carouselRequests.delete(key));
    this.carouselRequests.set(key, load);
    return load;
  }

  private async readCarousel(kind: GameCarousel, more: boolean): Promise<void> {
    const guard = this.capture();
    const path = carouselPaths[kind];
    const previous = this.state[kind];
    let cursor = more ? this.state.cursors[kind] : null;
    let items: Game[];
    if (!this.paginatedCarousels) {
      items = await this.read(path);
    } else {
      const visited = new Set<string | null | undefined>();
      const existing = new Set(more ? previous.map(game => game.id) : []);
      // A page can contain no visible titles. Follow its cursor until a
      // card can be added or the server signals the end.
      do {
        visited.add(cursor);
        const params = new URLSearchParams({limit: String(CAROUSEL_PAGE_SIZE)});
        if (cursor) params.set('cursor', cursor);
        const response = await this.read(`/v2${path}?${params}`);
        guard();
        items = response.items;
        cursor = visited.has(response.next_cursor) ? null : response.next_cursor;
      } while (cursor && Array.isArray(items) && items.every(game => existing.has(game.id)));
    }
    guard();
    if (!Array.isArray(items)) throw new Error('Invalid game carousel response');
    const keepTail = !more && this.paginatedCarousels && this.expandedCarouselGeneration[kind] === this.generation;
    const refreshedIds = new Set(items.map(game => game.id));
    const games = (more ? unique([...previous, ...items]) :
      keepTail ? [...items, ...previous.filter(game => !refreshedIds.has(game.id))] : items).map(localizeGame);
    if (more) this.expandedCarouselGeneration[kind] = this.generation;
    this.patch({[kind]: games, cursors: {...this.state.cursors,
      [kind]: keepTail ? this.state.cursors[kind] : cursor ?? null}});
    if (this.paginatedCarousels) await this.cache(path, games);
  }

  private async suggestGames(query: string): Promise<Game[]> {
    const guard=this.capture(),prefix=gameSearchPrefix(query);
    const games=[...this.state.recentGames,...this.state.popularGames,...this.state.games,...this.state.savedGames];
    if(!prefix||this.localOnly)return gameSuggestions(games,query);
    try{
      if(!this.paginated){
        const result=await this.read('/games');guard();
        if(!Array.isArray(result))throw new Error('Invalid list response');
        games.push(...result.map(localizeGame));
      }else{
        let cursor:string|null=null;
        const seen=new Set<string>();
        // Bound broad word-prefix matches while allowing description-only
        // matches on an early page to yield to actual title suggestions.
        for(let page=0;page<3;page++){
          const params=new URLSearchParams({q:prefix,limit:'50'});if(cursor)params.set('cursor',cursor);
          const result=await this.read(`/v2/games?${params}`);guard();
          if(!Array.isArray(result?.items))throw new Error('Invalid list response');
          games.push(...result.items.map(localizeGame));
          cursor=result.next_cursor||null;
          if(!cursor||seen.has(cursor)||gameSuggestions(games,query).length>=6)break;
          seen.add(cursor);
        }
      }
    }catch(error){
      guard();
      if(error instanceof ApiError&&error.status===400&&error.message==='search requires one word prefix of 2 to 24 characters'){
        // Browser and server Unicode versions can recognize different word
        // characters. Keep ordinary typing free of index validation copy.
        recordDiagnosticEvent('game_search_prefix_fallback',{reason:'unsupported_index_prefix'});
        return gameSuggestions(games,query);
      }
      if(error instanceof ApiError&&error.status<500||this.state.network)throw error;
      // Offline typing can still find downloaded/recent games. Suggestions
      // never replace the stable catalog or saved-library cache aliases.
    }
    return gameSuggestions(games,query);
  }
  private matchSummaries(matches: Match[]) {
    return matches.map(({state: _state, pending: _pending, conflict: _conflict, ...summary}) => summary);
  }
  private async saveMatchIndex(matches: Match[], complete = false) {
    const hidden = hiddenMatchIds(this.data);
    const combined = new Map((complete ? [] : this.state.myMatches).map(match => [match.id,match]));
    // A match disappearing from a server page must not hide a pending action.
    for (const id of new Set([...Object.keys(this.data.queues),...Object.keys(this.data.creations || {}),...Object.keys(this.data.conflicts)])) {
      const match = this.data.responses[`/matches/${encodeURIComponent(id)}`];
      if (match) combined.set(id,match);
    }
    for (const match of matches) {
      const saved = this.data.responses[`/matches/${encodeURIComponent(match.id)}`];
      combined.set(match.id,saved && (this.data.queues[match.id]?.length || this.data.conflicts[match.id] || saved.move_count > match.move_count) ? saved : match);
    }
    const items = [...combined.values()].filter(match => !hidden.has(match.id)).sort((a,b) => matchRetentionPriority(b,this.turnIdentity())-matchRetentionPriority(a,this.turnIdentity()));
    this.patch({myMatches:items.map(match => this.decorate(match)!),...(complete ? {cursors:{...this.state.cursors,myMatches:null}} : {})});
    await this.cache('/matches',this.matchSummaries(items));
  }
  /** Downloads use the same account-scoped cache and pending-action guards as
   * opening a match, without changing the selected screen or blocking it. */
  private startOfflineDownloads() {
    if (this.localOnly || !this.state.account || !isOnline() || !this.state.network) return;
    const scope = JSON.stringify([this.state.baseUrl,this.identity(),this.generation]);
    if (scope === this.offlineDownloadScope && (this.offlineDownloadPromise || Date.now() < this.offlineDownloadAfter)) return;
    this.offlineDownloadScope = scope;
    this.offlineDownloadAfter = Date.now()+60000;
    const guard = this.capture();
    const pending = this.downloadOwnMatches(guard).catch(() => {
      // Optional downloads never turn a working online view into an error.
      if (scope === this.offlineDownloadScope) this.offlineDownloadAfter = Date.now()+15000;
    }).finally(() => {if (this.offlineDownloadPromise === pending) this.offlineDownloadPromise = null;});
    this.offlineDownloadPromise = pending;
  }
  private async downloadOwnMatches(guard: () => void) {
    const all = new Map<string,Match>();
    let failed = false;
    const statuses = this.paginated ? ['ongoing','waiting_for_players','over'] : ['all'];
    const download = async (match: Match) => {
      guard(); if (!isOnline()) throw new TypeError('Offline');
      if (hiddenMatchIds(this.data).has(match.id)) return;
      let snapshot: Match;
      try {
        snapshot = Object.hasOwn(match,'state') ? await this.cache(`/matches/${encodeURIComponent(match.id)}`,match) : await this.read(`/matches/${encodeURIComponent(match.id)}`);
        guard();
        const cached = this.exactPackage(snapshot.game_id,snapshot.game_version);
        const game = isValidDownloadedGame(cached,snapshot.game_id,snapshot.game_version) ? cached : await this.pinnedGame(snapshot.game_id,snapshot.game_version,snapshot.id); guard();
        await this.rememberMatchGame(game);guard();
        if (!isValidDownloadedGame(game,snapshot.game_id,snapshot.game_version)) throw new Error('Incomplete downloaded game');
      } catch (error) {guard();failed=true;if (!isOnline() || !this.state.network) throw error;return;}
      // Recent filtered history restores animation/dice presentation offline.
      // Full replay histories are fetched only when the player requests them.
      const historyPath = presentationHistoryPath(snapshot,this.paginated);
      if (historyPath && !Object.hasOwn(this.data.responses,historyPath)) try {await this.read(historyPath);guard();} catch {guard();failed=true;}
    };
    for (const status of statuses) {
      const matches: Match[] = [], cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        guard();if (!isOnline()) throw new TypeError('Offline');
        const query = new URLSearchParams({status,limit:'100'});
        if (cursor) query.set('cursor',cursor);
        const result = await this.request('GET',this.paginated ? `/v2/matches?${query}` : '/matches');guard();
        const items = this.paginated ? result.items : result;
        if (!Array.isArray(items)) throw new Error('Invalid match list');
        for (const match of items) {
          if (typeof match?.id !== 'string' || typeof match.game_id !== 'string' || !Number.isSafeInteger(match.game_version) || !Array.isArray(match.players)) continue;
          all.set(match.id,match);matches.push(match);
        }
        await this.saveMatchIndex([...all.values()]);guard();
        cursor = this.paginated ? result.next_cursor || null : null;
        if (cursor && cursors.has(cursor)) throw new Error('Repeated match cursor');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      // See every ongoing page before ordering: your turn always comes before
      // somebody else's turn, even when the server returned it on a later page.
      matches.sort((a,b) => matchRetentionPriority(b,this.turnIdentity())-matchRetentionPriority(a,this.turnIdentity()));
      for (const match of matches) {await download(match);guard();}
      const ids = [...new Set(matches.flatMap(match => match.players.map(player => player.user_id).filter((id): id is string => !!id)))];
      for (let start=0;start<ids.length;start+=100) {
        guard();
        try {
          const profiles = await this.request('GET',`/users?ids=${encodeURIComponent(ids.slice(start,start+100).join(','))}`);guard();
          if (Array.isArray(profiles)) for (const profile of profiles) {
            if (typeof profile?.id !== 'string') continue;
            if (profile.id === this.identity() || profile.id === this.turnIdentity()) continue;
            await this.cache(`/users/${encodeURIComponent(profile.id)}`,profile);guard();
            this.patch({profiles:{...this.state.profiles,[profile.id]:profile}});
          }
        } catch {guard();failed=true;}
      }
    }
    await this.saveMatchIndex([...all.values()],true);guard();
    // A later ordinary refresh retries partial downloads without discarding any
    // already usable snapshot, package, or compact game-name metadata.
    this.offlineDownloadAfter = Date.now()+(failed ? 15000 : 60000);
  }
  async bootstrap(baseUrl?: string, localOnly = false, initialUrl?:string|Promise<string|null>, openMatchLink=false): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.perform(async () => {
      const base = (baseUrl ?? (typeof location !== 'undefined' ? location.origin : process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun')).replace(/\/$/, '');
      this.localOnly = localOnly;
      this.api = new PortalApi(base, getLocale, localOnly ? async () => { throw new Error('This test launch runs entirely on this device.'); } : fetch); this.repository = new AccountRepository(base); this.patch({ baseUrl: base, network: !localOnly && isOnline() });
      const [accounts,id,incoming] = await Promise.all([
        loadAccounts(base).catch(error=>{
          if(isQuotaError(error))reportCacheFailure('read',error);
          else this.patch({storageError:`Saved accounts are unavailable: ${(error as Error).message}`});
          return [];
        }),
        loadCurrentAccount(base).catch(()=>null),
        initialUrl??(typeof location!=='undefined'?location.href:null),
      ]);
      // Only old installs without a selection may restore their first login.
      // An explicit visitor marker or a removed selected account stays out.
      const account = (id === null ? accounts[0] : accounts.find(a => a.id === id)) || null;
      this.patch({ accounts, account });
      const target=openMatchLink && incoming ? playerLink(incoming,base) : null;
      const initialMatchId=target?.kind==='match'?target.id:undefined;
      await Promise.all([this.reloadData(),incoming?this.rememberAttribution(incoming):purgePersonalAttribution()]);
      const snapshot = this.data, hidden = hiddenMatchIds(snapshot);
      this.patch({ games: savedList(snapshot.responses['/games']), myMatches: savedList<Match>(snapshot.responses['/matches']).filter(match=>!hidden.has(match.id)), savedGames: savedList(snapshot.responses['/users/me/saved-games']), authConfig:snapshot.responses['/auth/config']||{},
        popularGames: savedList<Game>(snapshot.responses[carouselPaths.popularGames]).map(localizeGame),
        recentGames: account ? savedList<Game>(snapshot.responses[carouselPaths.recentGames]).map(localizeGame) : [] });
      if (!initialMatchId && snapshot.selectedId && !removedSavedMatch(snapshot,snapshot.selectedId)) {
        const match = snapshot.local[snapshot.selectedId] || snapshot.responses[`/matches/${snapshot.selectedId}`];
        if (match) {
          const token=this.selection,guard=this.capture();
          this.patch({selectedMatch:this.decorate(match),selectedGameId:match.game_id});
          // The stored package is the author's original. Restore through the
          // same presentation repair as an explicit open before mounting SVG.
          if (this.exactPackage(match.game_id,match.game_version)) {
            const game=await this.pinnedGame(match.game_id,match.game_version,match.localMode?undefined:match.id);
            guard();if(token===this.selection)this.patch({game});
          }
        }
      }
      // A cold native link can begin as soon as its account and attribution are
      // known. Opening the board does not depend on React mounting or the catalog.
      const opening = initialMatchId
        ? this.perform(() => this.selectMatch(initialMatchId,undefined,undefined,true,true),false).catch(() => {})
        : Promise.resolve();
      subscribeI18n(() => this.localize());
      this.paginated = Object.keys(snapshot.responses).some(key=>key.startsWith('/v2/'));
      const capabilities = localOnly ? Promise.resolve() : this.api.request('GET','/storage/capabilities').then(result=>{
        this.paginated=result.pagination===true;
        this.paginatedCarousels=result.game_carousels===true;
      }).catch(()=>{});
      let showLocalData!:()=>void;
      const localReady=new Promise<void>(resolve=>{showLocalData=resolve;});
      const translations=configureI18n(base,account?.locale,localOnly,showLocalData).catch(()=>{}).finally(showLocalData);
      await localReady;
      this.patch({ready:true});
      const initialRefresh=opening.then(()=>this.refresh(capabilities,true,initialMatchId));
      if(!localOnly){
        let lastOnline=isOnline();
        this.stopConnectivity=watchConnectivity(online=>{
          const reconnected=online&&!lastOnline;lastOnline=online;
          this.patch({network:online});
          if(reconnected){this.retryAfter=0;void this.refresh().catch(()=>{});}
        });
      }
      await Promise.all([translations,initialRefresh]);
    });
    return this.bootstrapPromise;
  }
  async refresh(capabilities?:Promise<void>, startup=false, freshlyOpenedId?:string): Promise<void> {
    if(!this.state.ready)return;
    await this.flushDeviceTurns();
    if (this.refreshPromise) return this.refreshPromise;
    const guard = this.capture();
    const pending = (async () => {
      if(capabilities)await capabilities;
      if(!startup)await this.reloadData();
      guard();
      if (this.localOnly) { this.patch({ network: false }); return; }
      if (this.state.account && isOnline()) await this.sync().catch(() => {});
      guard();
      const updateAuth=()=>this.read('/auth/config').then(authConfig=>{guard();this.patch({authConfig});});
      if (this.state.selectedMatch) { this.startOfflineDownloads();await Promise.all([this.state.selectedMatch.id===freshlyOpenedId?undefined:this.refreshMatch(),startup?updateAuth().catch(()=>{}):undefined]); return; }
      const jobs: Promise<any>[] = [this.list('games'), updateAuth(), this.loadCarousel('popularGames')];
      if (this.state.account) jobs.push(this.refreshNotifications(), this.list('myMatches'), this.list('savedGames'), this.loadCarousel('recentGames'), this.refreshProfile());
      const results = await Promise.allSettled(jobs); guard();
      await this.claimDailyLogin().catch(() => {}); guard();
      const first = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (first && !this.state.games.length) this.patch({ error: first.reason?.message || 'Could not refresh' });
      await this.loadProfiles().catch(() => {});
      guard();this.startOfflineDownloads();
    })().finally(() => { if (this.refreshPromise === pending) this.refreshPromise = null; });
    this.refreshPromise = pending; return pending;
  }
  private async claimDailyLogin(): Promise<void> {
    const account=this.state.account;
    if(this.localOnly||!account||!isOnline())return;
    const guard=this.capture(),scope=JSON.stringify([this.state.baseUrl,account.id]),day=new Date().toISOString().slice(0,10);
    const profile=this.state.profile,linked=account.linked??account.linked_accounts;
    const verified=profile?.is_verified===true||account.is_verified===true||linked?.some((item:any)=>['google','email','phone'].includes(item?.kind))?true:profile?.is_verified??account.is_verified;
    const lastDay=profile?.last_token_grant_day??account.last_token_grant_day,total=profile?.free_tokens_granted??account.free_tokens_granted;
    if(verified===false||lastDay>=day||typeof total==='number'&&total>=100||this.dailyLoginDays.get(scope)===day||(this.dailyLoginRetryAfter.get(scope)||0)>Date.now())return;
    const key=JSON.stringify([scope,day]);
    if(this.dailyLoginPromise?.key===key)return this.dailyLoginPromise.promise;
    const pending=(async()=>{
      try{
        if(verified!==true){
          await this.refreshProfile();guard();
          if(this.state.profile?.is_verified!==true){this.dailyLoginDays.set(scope,day);return;}
        }
        const saved=await this.request('POST','/auth/daily-login');guard();
        if(typeof saved?.id!=='string'||typeof saved.token_balance!=='number'||typeof saved.free_tokens_granted!=='number')throw new Error('Invalid daily login response');
        const fields={token_balance:saved.token_balance,free_tokens_granted:saved.free_tokens_granted,last_token_grant_day:saved.last_token_grant_day,is_verified:saved.is_verified};
        const own={...saved,...this.state.profile,id:saved.id,...fields};
        this.patch({profile:own,account:{...this.state.account!,...fields},accounts:this.state.accounts.map(item=>item.id===account.id?{...item,...fields}:item)});
        await this.cache(`/users/${encodeURIComponent(account.id)}`,own);guard();
        this.dailyLoginDays.set(scope,day);this.dailyLoginRetryAfter.delete(scope);
      }catch(error){guard();this.dailyLoginRetryAfter.set(scope,Date.now()+60000);throw error;}
    })().finally(()=>{if(this.dailyLoginPromise?.promise===pending)this.dailyLoginPromise=null;});
    this.dailyLoginPromise={key,promise:pending};return pending;
  }
  async refreshNotifications(more = false): Promise<void> {
    if (!this.state.account || this.localOnly || !isOnline()) return;
    if (this.notificationPromise) return this.notificationPromise;
    if (more && !this.state.notificationCursor) return;
    const guard = this.capture(), cursor = more ? this.state.notificationCursor : null;
    // Once both pages are loaded, refresh the whole bounded inbox. Reusing the
    // old tail loses entries shifted across page 50 and retains evicted ones.
    const query = new URLSearchParams({limit: !more && this.state.notifications.length > 50 ? '100' : '50'}); if (cursor) query.set('cursor', cursor);
    const pending = (async () => {
      const result = await this.request('GET', `/users/me/notifications?${query}`); guard();
      if (!more) await this.refreshProfile().catch(() => {}); guard();
      if (!Array.isArray(result.items)) return;
      const pendingItems = pendingNotifications(result.items, this.state.baseUrl);
      const incoming = pendingItems.filter(item => !this.dismissedNotificationIds.has(item.id));
      const notifications = pendingNotifications(more ? [...this.state.notifications, ...incoming] : incoming, this.state.baseUrl).filter(item => !this.dismissedNotificationIds.has(item.id));
      const complete = !more && !result.next_cursor;
      const acknowledged = pendingItems.length - incoming.length;
      this.patch({notifications, notificationCursor: result.next_cursor || null, unreadNotifications: complete || result.unread_count === undefined ? notifications.length : Math.max(notifications.length,result.unread_count-acknowledged)});
    })().finally(() => {if (this.notificationPromise === pending) this.notificationPromise = null;});
    this.notificationPromise = pending; return pending;
  }
  async readNotification(id: string) {
    const guard = this.capture();
    const saved = await this.request('POST', `/users/me/notifications/${encodeURIComponent(id)}/read`); guard();
    // The acknowledgement names the consumed snapshot and its older match
    // updates. Exact IDs preserve a newer move even when timestamps are equal.
    for (const dismissed of [id, ...(saved.dismissed_notification_ids || [])]) this.dismissedNotificationIds.add(dismissed);
    const notifications = this.state.notifications.filter(item => !this.dismissedNotificationIds.has(item.id));
    this.patch({notifications, unreadNotifications: Math.max(0, this.state.unreadNotifications - (this.state.notifications.length - notifications.length))});
    return saved;
  }
  private async offerNotificationPrompt(before: Match, after: Match) {
    const account = this.state.account; if (!account || !handsTurnToOpponent(before, after, account.id)) return;
    const key = JSON.stringify([this.state.baseUrl, account.id]);
    if (this.offeredNotificationPrompt.has(key) || this.state.profile?.notification_prompt_seen || account.notification_prompt_seen || this.state.profile?.notifications_enabled === false || account.notifications_enabled === false) return;
    this.offeredNotificationPrompt.add(key);
    const guard = this.capture();
    try {
      await this.refreshProfile(); guard();
      if (this.state.profile?.notification_prompt_seen || this.state.profile?.notifications_enabled === false) return;
      this.patch({notificationPrompt: true});
    } catch { /* Notification permission must never make an accepted move fail. */ }
  }
  async claimNotificationPrompt(): Promise<void> {
    if (!this.state.account || !this.state.notificationPrompt || this.state.notificationPromptReady) return;
    if (this.notificationPromptClaim) return this.notificationPromptClaim;
    const guard = this.capture();
    const pending = (async () => {
      await this.refreshProfile(); guard();
      if (this.state.profile?.notification_prompt_seen || this.state.profile?.notifications_enabled === false) {this.patch({notificationPrompt: false}); return;}
      await this.updateProfile({notification_prompt_seen: true}); guard();
      if (this.state.notificationPrompt) this.patch({notificationPromptReady: true});
    })().finally(() => {if (this.notificationPromptClaim === pending) this.notificationPromptClaim = null;});
    this.notificationPromptClaim = pending; return pending;
  }
  private async loadProfiles() {
    const guard = this.capture(); const ids = [...new Set([...this.state.myMatches, ...(this.state.selectedMatch ? [this.state.selectedMatch] : [])].flatMap(m => m.players || []).map(p => p.user_id).filter(Boolean))].filter(id => !this.state.profiles[id!]).slice(0, 200);
    if (!ids.length) return; const profiles = await this.read(`/users?ids=${encodeURIComponent(ids.join(','))}`); guard(); this.patch({ profiles: { ...this.state.profiles, ...Object.fromEntries(profiles.map((p: any) => [p.id, p])) } });
  }
  async refreshMatch() {
    await this.flushDeviceTurns();
    const selected = this.state.selectedMatch; if (!selected) return;
    const guard = this.capture(); const token = this.selection;
    this.startOfflineDownloads();
    await this.claimDailyLogin().catch(() => {}); guard(); if (token !== this.selection) return;
    if(this.data.creations?.[selected.id]) {
      await this.sync(undefined,selected.id).catch(()=>{});guard();
      await this.reloadData();guard();
      if(this.data.creations?.[selected.id])return;
    }
    if (this.data.local[selected.id]) {
      if (!this.localOnly && this.state.account && isOnline()) {
        await this.sync(undefined,selected.id).catch(() => {}); guard();
        if (this.data.local[selected.id] && !needsCloudSave(this.data.local[selected.id]) && !this.data.conflicts[selected.id]) {
          try {await this.read(`/matches/${encodeURIComponent(selected.id)}`);}
          catch(error) {
            guard();
            if(error instanceof ApiError && error.status===404)await this.archiveMatch(selected.id,{deleted:true,onlySynced:true});
          }
          guard();
        }
      }
      await this.reloadData(); return;
    }
    let match: Match;
    if (this.data.queues[selected.id]?.length) { await this.sync().catch(() => {}); guard(); match = this.data.responses[`/matches/${selected.id}`] || selected; }
    else match = await this.read(`/matches/${encodeURIComponent(selected.id)}`);
    await this.reloadData();guard(); if (token !== this.selection || removedSavedMatch(this.data,selected.id)) return;
    this.patch({ selectedMatch: this.decorate(match) });
    const game = await this.pinnedGame(match.game_id, match.game_version,match.localMode?undefined:match.id); await this.reloadData();guard(); if (token !== this.selection || removedSavedMatch(this.data,selected.id)) return;
    this.patch({ game, selectedGameId: game.id }); await this.loadProfiles().catch(() => {}); guard(); if (token !== this.selection) return;
    await this.recoverPresentation(match, selected).catch(() => {});
    if (match.status !== selected.status || match.token_pot !== selected.token_pot || !equal(match.token_payouts, selected.token_payouts)) await this.refreshProfile().catch(() => {});
  }
  private pinnedGame(id: string, version?: number, matchId?: string, prefetched?:Promise<Game|undefined>): Promise<Game> {
    const generation=this.generation,owner=this.identity(),prepared=this.preparedPackage;
    // Polls for the same immutable rules can reuse the verified presentation.
    // Only a versioned lookup can do this. Catalog opens must check the latest version.
    if(version!==undefined&&prepared?.generation===generation&&prepared.owner===owner&&
      prepared.game.id===id&&prepared.game.version===version&&this.exactPackage(id,version))
      return Promise.resolve(localizeGame(prepared.game));
    const key=JSON.stringify([generation,this.state.baseUrl,owner,id,version,matchId]);
    const current=this.pendingPackages.get(key);
    if(current)return current;
    const pending=this.loadPinnedGame(id,version,matchId,prefetched).then(game=>{
      if(this.generation===generation&&this.identity()===owner)this.preparedPackage={generation,owner,game};
      return game;
    }).finally(()=>this.pendingPackages.delete(key));
    this.pendingPackages.set(key,pending);
    return pending;
  }
  private async loadPinnedGame(id: string, version?: number, matchId?: string, prefetched?:Promise<Game|undefined>): Promise<Game> {
    if (id === bundled.id) return localizeGame(bundled as Game);
    const guard = this.capture();
    const path = version === undefined ? `/games/${encodeURIComponent(id)}` : `/games/${encodeURIComponent(id)}/versions/${version}`;
    const cached = version !== undefined && isValidDownloadedGame(this.data.responses[path],id,version);
    let game: Game;
    if (cached) game = await this.cached(path);
    else {
      // Verify identity and completeness before saving: a partial response or a
      // different version must never become an immutable offline package.
      try {
        if (this.localOnly || !isOnline() || Date.now() < this.retryAfter) throw new TypeError('Offline');
        const candidate=prefetched ? await prefetched : undefined;
        guard();
        if (candidate && version!==undefined && isValidDownloadedGame(candidate,id,version)) game=candidate;
        else try { game = await this.request('GET',path); }
        catch (error) {
          guard();
          // A catalog withdrawal does not hide the package needed to watch an
          // existing public match. This route returns only that pinned version.
          if (!(error instanceof ApiError) || error.status !== 404 || !matchId || version === undefined) throw error;
          game = await this.request('GET',`/matches/${encodeURIComponent(matchId)}/game`);
        }
        guard();this.retryAfter = 0;this.patch({network:isOnline()});
      } catch (error) {
        guard();if (error instanceof ApiError && error.status < 500) throw error;
        this.retryAfter = Date.now()+10000;this.patch({network:false});
        const previous = this.data.responses[path];
        if (!isValidDownloadedGame(previous,id,version ?? previous?.version)) throw error;
        game = await this.cached(path);guard();
      }
      if (!game?.declarative_ui) throw new Error('This game uses an earlier renderer. Its saved data is preserved in the archive.');
      if (!isValidDownloadedGame(game,id,version ?? game.version)) throw new Error('The downloaded game package is incomplete or has the wrong version.');
    }
    // Native digest work and persistence are independent once the pin is verified.
    const prepared=this.prepareGamePresentation(game);
    if (!cached) await this.cache(path,game);
    await this.rememberMatchGame(game);
    const exactPath=`/games/${game.id}/versions/${game.version}`;
    if (!cached && path !== exactPath) await this.cache(exactPath, game);
    // The player can switch languages while these storage writes are pending.
    return localizeGame(await prepared);
  }
  private async prepareGamePresentation(game:Game):Promise<Game> {
    let presentation = game.declarative_ui;
    if (['5f5293c3-2a3a-4eec-b631-9debf59be0ca','e299b14e-480d-44f3-8132-74282a46cebc'].includes(game.id)) {
      try { presentation = await (await import('../game/presentation')).presentationForGame(game); }
      catch { recordDiagnosticLog('warn','reviewed_presentation_fallback',{gameId:game.id,gameVersion:game.version}); }
    }
    // Display repair never mutates the persisted package or its version/rules.
    return { ...game, declarative_ui: presentation };
  }
  async selectGame(id: string) {
    const token = ++this.selection; const guard = this.capture(); const owner = this.identity();
    this.repository.protectGame(owner,id);
    // Clear the previous match before any await. A restored match must never be
    // displayed with the unrelated package requested by an incoming game URL.
    this.patch({ selectedMatch: null, selectedGameId: id, game: null, history: null, replayIndex: null });
    // Remembering the last open view is optional. A full device must still
    // display downloaded content without discarding saved games or moves.
    try { await this.repository.mutate(owner, data => { guard(); if (token === this.selection) data.selectedId = null; },{optionalCache:true}); }
    catch (error) { guard(); reportCacheFailure('selection',error); }
    guard(); if (token !== this.selection) return;
    const game = await this.pinnedGame(id); guard(); if (token === this.selection) this.patch({ selectedGameId: id, game }); return game;
  }
  private async rememberAttribution(url:string){const target=playerLink(url,this.state.baseUrl);this.requestedLink=target&&(target.kind==='match'||target.kind==='invite')?{kind:target.kind,id:target.id}:null;await rememberUrlAttribution(url,this.state.baseUrl,this.state.accounts);}
  async openInvite(token: string) {
    this.requestedLink={kind:'invite',id:token};
    const guard = this.capture(), selection = ++this.selection;
    const preview = await this.request('GET', `/invites/${encodeURIComponent(token)}`,undefined,true); guard(); if (selection !== this.selection) return null;
    this.inviteMatchIds.set(token,preview.match.id);
    await this.selectMatch(preview.match.id, token, preview.match); guard();
    return preview;
  }
  async acceptInvite(token:string):Promise<Match|null>{
    const key=JSON.stringify([this.generation,this.state.baseUrl,this.state.account?.id,token]);
    if(this.inviteAcceptance?.key===key)return this.inviteAcceptance.pending;
    const pending=this.acceptInviteNow(token);this.inviteAcceptance={key,pending};
    try{return await pending;}finally{if(this.inviteAcceptance?.pending===pending)this.inviteAcceptance=null;}
  }
  private async acceptInviteNow(token: string) {
    const guard = this.capture(), selection = ++this.selection;
    const match = await this.request('POST', `/invites/${encodeURIComponent(token)}/accept`); guard(); if (selection !== this.selection) return null;
    await this.selectMatch(match.id, token, match); guard();
    return match;
  }
  async selectMatch(id: string, inviteToken?: string, initialMatch?: Match,trackOpen=true,alreadyHydrated=false) {
    this.requestedLink=inviteToken?{kind:'invite',id:inviteToken}:{kind:'match',id};
    if (inviteToken) {this.selectedInvite = {matchId: id, token: inviteToken};this.inviteMatchIds.set(inviteToken,id);}
    else if (this.selectedInvite?.matchId !== id) this.selectedInvite = null;
    const token = ++this.selection; const guard = this.capture();
    if(!alreadyHydrated)await this.reloadData();
    guard(); if (token !== this.selection) return;
    if(removedSavedMatch(this.data,id))throw new RemovedSavedMatchError();
    const matchPath=`/matches/${encodeURIComponent(id)}`;
    // Both endpoints enforce the viewer's access. A known match already tells
    // us which immutable package to reuse from the offline cache.
    const prefetched = !initialMatch && !this.data.local[id] && !this.data.responses[matchPath]
      && !this.data.creations?.[id] && !this.localOnly && isOnline() && Date.now()>=this.retryAfter
      ? this.request('GET',matchPath+'/game').catch(()=>undefined) : undefined;
    const fetched = initialMatch || this.data.local[id] || (this.data.creations?.[id] ? this.data.responses[`/matches/${id}`] : await this.read(`/matches/${encodeURIComponent(id)}`,true,trackOpen)); guard(); if (token !== this.selection) return;
    if (initialMatch?.single_player_state) {
      await this.cache(`/matches/${encodeURIComponent(id)}`,initialMatch); guard();
    }
    const match = this.data.local[id] || fetched;
    const packageMatches = this.state.game?.id === match.game_id && this.state.game.version === match.game_version;
    try { await this.repository.mutate(this.identity(), data => { guard(); if (token === this.selection) {
      if(removedSavedMatch(data,id))throw new RemovedSavedMatchError();
      data.selectedId = id; if(!data.local[id])data.responses[`/matches/${id}`]=match;
    } },{optionalCache:true}); }
    catch (error) { guard(); if(error instanceof RemovedSavedMatchError)throw error;reportCacheFailure('selection',error); }
    guard(); if (token !== this.selection) return;
    this.patch({ selectedMatch: this.decorate(match), game: packageMatches ? this.state.game : null, selectedGameId: match.game_id, replayIndex: null, history: null });
    this.repository.protectGame(this.identity(),match.game_id,match.game_version);
    const game = await this.pinnedGame(match.game_id, match.game_version,match.localMode?undefined:match.id,prefetched); await this.reloadData();guard(); if (token !== this.selection || removedSavedMatch(this.data,id)) return;
    this.patch({ game, selectedGameId: game.id });
    await this.loadProfiles().catch(() => {});
    if (token === this.selection) await this.recoverPresentation(match).catch(() => {});
  }
  clearMatch() { this.requestedLink=null;this.selectedInvite = null; ++this.selection; this.patch({ selectedMatch: null, history: null, replayIndex: null }); void this.repository.mutate(this.identity(), data => { data.selectedId = null; },{optionalCache:true}).catch(error => reportCacheFailure('selection',error)); }
  clearGame() { this.clearMatch(); this.repository.protectGame(this.identity(),null);this.patch({ selectedGameId: null, game: null }); }
  private writeSelection(id:string,guard:()=>void) {
    const write=this.accountSelectionWrites.then(async()=>{
      guard();const previous=this.identity(),base=this.state.baseUrl;
      await this.writeCurrentAccount(id,base);
      try{guard();}catch(error){
        // A closed sign-in form must not leave a late persisted selection.
        // Newer switches/logout wait behind this rollback and write last.
        await this.writeCurrentAccount(previous,base).catch(()=>{});throw error;
      }
    });
    this.accountSelectionWrites=write.catch(()=>{});return write;
  }
  private async saveLogin(response: any, removeIds: string[] = [], intentGuard?:()=>void) {
    let selectionCommitted=false;
    const sessionGuard = this.capture(),guard=()=>{sessionGuard();if(!selectionCommitted)intentGuard?.();};guard();
    const matchAttribution=await this.attribution();guard();
    const id = response.user_id || response.id; if (!id || !response.password) throw new Error('Invalid account response');
    const account: Account = { ...withoutPersonalReferral(response), id, linked: response.linked_accounts ?? response.linked ?? [] };
    const sourceIds = [...new Set([...removeIds, response.merged_from_user_id, ...(!this.state.account ? ['visitor'] : [])].filter((value): value is string => typeof value === 'string' && !!value && value !== id))];
    // This durable write precedes removing an alias from either account index.
    // A failed write leaves the old login and every original namespace intact.
    try { await this.repository.preserveMergedAccounts(id, sourceIds); } catch (error) { guard(); this.patch({ storageError: 'Linked account data could not be copied. The previous account remains selectable and its saved games and pending actions were kept.' }); throw error; }
    guard();
    const accounts = [...this.state.accounts.filter(a => a.id !== id && a.id !== response.merged_from_user_id && !removeIds.includes(a.id)), account];
    try {
      if (sourceIds.length) {
        // Keep aliases during the two-key credential/index commit. Failure at
        // any point leaves them selectable until the next successful login.
        await saveAccounts([...this.state.accounts.filter(a => a.id !== id), account], this.state.baseUrl); guard(); await this.writeSelection(id,guard);selectionCommitted=true;guard();await saveAccounts(accounts, this.state.baseUrl);
      } else { await saveAccounts(accounts, this.state.baseUrl); guard(); await this.writeSelection(id,guard);selectionCommitted=true; }
    } catch (error) {
      guard();
      if (sourceIds.length) { this.patch({ storageError: 'Linked credentials could not be saved. Previous account entries and their saved data remain available.' }); throw error; }
      this.patch({ storageError: 'Credentials could not be saved on this device. Keep the app open to retain this online session.' });
    }
    guard();this.patch({ accounts });await this.switchAccount(id,undefined,matchAttribution);
  }
  async switchAccount(id: string,intentGuard?:()=>void,loginAttribution?:MatchAttribution) {
    intentGuard?.();
    const account = this.state.accounts.find(a => a.id === id); if (!account) throw new Error('Account not found on this device');
    const transition = ++this.generation; ++this.selection; this.refreshPromise = null; this.syncPromise = null; this.notificationPromise = null; this.dismissedNotificationIds.clear(); this.notificationPromptClaim = null; this.observations.clear();
    const current=()=>{if(transition!==this.generation)throw new AccountScopeChangedError();intentGuard?.();};
    await this.writeSelection(id,current).catch(()=>{});current();
    const target=loginAttribution??await newAccountAttribution(this.state.accounts);current();
    const { ready, baseUrl, accounts, authConfig, locale, storageError } = this.state;
    this.data = emptyAccountData(); this.patch({ ...initial(), ready, baseUrl, accounts, authConfig, account, locale, storageError, network: !this.localOnly && isOnline() }); const guard = this.capture(); await this.reloadData(); guard();
    this.patch({ games: savedList(this.data.responses['/games']), myMatches: savedList(this.data.responses['/matches']) }); await this.refresh(); guard();
    await this.completeLinkLogin(target);guard();
    const latest=await newAccountAttribution(this.state.accounts);guard();
    if(equal(latest,target))await forgetMatchAttribution();
  }
  private async completeLinkLogin(target:MatchAttribution){
    const guard=this.capture();
    try{
      if(target.invite_token){
        const token=target.invite_token,active=this.requestedLink?.kind==='invite'&&this.requestedLink.id===token;
        if(active){
          // The App may already be accepting the same invitation. Share that
          // request, and finish the handoff even when its React effect is absent.
          const selected=this.state.selectedMatch,ownIds=[this.state.account?.id,this.state.account?.canonical_user_id,this.state.profile?.id];
          if(!(this.selectedInvite?.token===token&&selected?.players.some(player=>player.active!==false&&ownIds.includes(player.user_id))))await this.acceptInvite(token);
        }else{
          const matchId=this.inviteMatchIds.get(token);
          if(matchId){const match=await this.read(`/matches/${encodeURIComponent(matchId)}`,true,false);guard();if(this.requestedLink?.kind==='match'&&this.requestedLink.id===matchId)await this.selectMatch(matchId,undefined,match,false);}
          else await this.request('GET',`/invites/${encodeURIComponent(token)}`,undefined,false);
        }
      }else if(target.invite_match_id){
        const id=target.invite_match_id,match=await this.read(`/matches/${encodeURIComponent(id)}`,true,false);guard();
        // Account selection can happen before the anonymous detail fetch has
        // completed. Restore the requested target, not just rendered state.
        if(this.requestedLink?.kind==='match'&&this.requestedLink.id===id)await this.selectMatch(id,undefined,match,false);
      }
    }catch{guard();/* A stale invite or lost connection must not undo login. */}
  }
  async logout(id = this.state.account?.id) {
    const accounts = this.state.accounts.filter(a => a.id !== id);
    if(id!==this.state.account?.id){const guard=this.capture();await saveAccounts(accounts,this.state.baseUrl);guard();this.patch({accounts});return;}
    const transition = ++this.generation; ++this.selection; this.refreshPromise = null; this.syncPromise = null; this.notificationPromise = null; this.dismissedNotificationIds.clear(); this.notificationPromptClaim = null; this.observations.clear();
    const guard=()=>{if(transition!==this.generation)throw new AccountScopeChangedError();};
    const warning=()=>{guard();this.patch({storageError:'Device storage could not be updated. This session was logged out; saved credentials may remain on this device.'});};
    await saveAccounts(accounts,this.state.baseUrl).catch(warning);guard();
    // Follow any older selection write; it must not resurrect another login.
    await this.writeSelection('visitor',guard).catch(warning);guard();const { ready, baseUrl, authConfig, locale,storageError } = this.state;
    this.data = emptyAccountData(); this.patch({ ...initial(), ready, baseUrl, accounts,authConfig, locale,storageError, network: !this.localOnly && isOnline() }); await this.reloadData();guard();await this.refresh();guard();
  }
  private async attribution(): Promise<any> {if(this.bootstrapPromise&&!this.state.ready)await this.bootstrapPromise;return newAccountAttribution(this.state.accounts);}
  async guest(name: string,intentGuard?:()=>void) { const guard = this.capture();intentGuard?.(); const attribution = await this.attribution(); guard();intentGuard?.(); const result = await this.api.request('POST', '/users', { display_name: name.trim() || 'Player', locale: getLocale(), ...attribution }); guard();intentGuard?.(); await this.saveLogin(result,[],intentGuard); }
  async requestCode(method: 'email' | 'phone', value: string, delivery = 'sms') { return this.api.request('POST', `/auth/${method}/start`, method === 'email' ? { email: value } : { phone_number: value, delivery_method: delivery }); }
  async verifyCode(method: 'email' | 'phone', verificationId: string, code: string, name?: string, link = false,intentGuard?:()=>void) { const guard = this.capture();intentGuard?.();const account = this.state.account; const attribution = await this.attribution(); guard();intentGuard?.(); const result = await this.api.request('POST', `/auth/${method}/verify`, { verification_id: verificationId, code, ...(name ? { display_name: name } : {}), ...attribution }, link ? account : null); guard();intentGuard?.(); await this.saveLogin(result,[],intentGuard); }
  async google(idToken: string, link = false,intentGuard?:()=>void) { const guard = this.capture();intentGuard?.(); const account = this.state.account; const attribution = await this.attribution(); guard();intentGuard?.(); const result = await this.api.request('POST', '/auth/google', { id_token: idToken, ...attribution }, link ? account : null); guard();intentGuard?.(); await this.saveLogin(result,[],intentGuard); }
  async browserLogin(link = false,intentGuard?:()=>void,verifiedOnly=false) {
    if (this.localOnly) throw new Error('This test launch runs entirely on this device.');
    const guard = this.capture();intentGuard?.(); const previous = this.state.account;
    let response = await this.loginBrowser(this.state.baseUrl); guard();intentGuard?.();
    const id = response.user_id || response.id;
    if (!id || typeof response.password !== 'string' || !response.password) throw new Error('Invalid browser account response');
    const linked=response.linked_accounts??response.linked;
    if(verifiedOnly&&(!Array.isArray(linked)||!linked.some((item:any)=>['google','email','phone'].includes(item?.kind))))throw new Error(copyText('Use a verified login in your browser to continue.'));
    if (link && previous && previous.id !== id) {
      // The browser handoff proves the newly verified account. Explicit linking
      // also proves the original guest through headers; no credential enters a URL.
      await this.api.request('POST', `/users/${encodeURIComponent(previous.id)}/merge`, { into_user_id: id, into_password: response.password }, previous); guard();intentGuard?.();
      // The backend chooses the stronger login as survivor. Either input's
      // credentials remain an alias; ask for the canonical account before saving.
      response = await this.api.request('GET', '/auth/me', undefined, { ...response, id }); guard();intentGuard?.();
      await this.saveLogin(response, [previous.id, id],intentGuard);
    } else await this.saveLogin(response,[],intentGuard);
  }
  async updateProfile(patch: any) { const guard = this.capture(); const account = this.state.account; if (!account) throw new Error('Log in first'); const profile = await this.request('PATCH', `/users/${encodeURIComponent(account.id)}`, patch); const accounts = this.state.accounts.map(a => a.id === account.id ? { ...a, ...profile, id: a.id, password: a.password, canonical_user_id: profile.id } : a); await saveAccounts(accounts, this.state.baseUrl); guard(); this.patch({ account: accounts.find(a => a.id === account.id)!, accounts, profile }); }
  private async refreshProfile() { const account = this.state.account; if (!account) return; const guard = this.capture(), revision = this.profileRevision; const profile = await this.read(`/users/${encodeURIComponent(account.id)}`); guard(); if (revision === this.profileRevision) this.patch({ profile, account: {...this.state.account!, canonical_user_id: profile?.id} }); }
  async changeAccountDeletion(schedule: boolean) {
    const account = this.state.account, guard = this.capture(), canonicalId = this.state.profile?.id || this.state.account?.canonical_user_id || this.state.account?.id;
    if (!account) throw new Error('Log in first');
    if (!this.state.network || !isOnline() || this.localOnly) throw new Error(copyText('Connect to the internet to update account deletion.'));
    if (this.state.deletionUpdating) throw new Error(copyText('Account deletion is already being updated.'));
    this.patch({deletionUpdating: true});
    try {
      const profile = await this.request(schedule ? 'POST' : 'DELETE', '/users/me/deletion-request', schedule ? {confirmed: true} : undefined); guard();
      if (!profile?.id || ![account.id,canonicalId].includes(profile.id)) throw new Error('Invalid account deletion response');
      const ownIds = new Set([account.id,profile.id]);
      const fields = {canonical_user_id: profile.id, deletion_requested_at: profile.deletion_requested_at ?? null, deletion_scheduled_at: profile.deletion_scheduled_at ?? null, deletion_started_at: profile.deletion_started_at ?? null};
      ++this.profileRevision;
      const own = {...profile, ...fields};
      this.patch({profile: own, account: {...this.state.account!, ...fields}, accounts: this.state.accounts.map(item => ownIds.has(item.id) ? {...item, ...fields} : item), profiles: {...this.state.profiles, [account.id]: {...this.state.profiles[account.id], ...own}, [profile.id]: {...this.state.profiles[profile.id], ...own}}});
      // Update every cached representation of this user, including batched
      // profile responses. Keep all other users and namespaces untouched.
      const paths = Object.entries(this.data.responses).filter(([path,value]) => path.startsWith('/users') && (ownIds.has(value?.id) || Array.isArray(value) && value.some(item => ownIds.has(item?.id))));
      for (const [path,value] of paths) {guard(); await this.cache(path, Array.isArray(value) ? value.map(item => ownIds.has(item?.id) ? {...item, ...fields} : item) : {...value, ...fields});}
      guard(); await this.cache(`/users/${encodeURIComponent(account.id)}`, own); guard();
      try {
        const saved = await loadAccounts(this.state.baseUrl); guard();
        await saveAccounts(saved.map(item => ownIds.has(item.id) ? {...item, ...fields} : item), this.state.baseUrl); guard();
      } catch (error) {guard(); this.patch({storageError: copyText('Account deletion was updated on the server, but this device could not save its status. Refresh when connected to check it.')});}
      return own;
    } finally {try {guard(); this.patch({deletionUpdating: false});} catch { /* The selected account owns its state. */ }}
  }
  async createMatch(options: any) {
    const account=this.state.account;if(!account)throw new Error(copyText('Log in to save your matches in the cloud.'));
    const guard=this.capture(),game=await this.pinnedGame(options.game_id);guard();
    if(!game.allowed_player_counts.some(count=>count>=2))throw new Error(copyText('Single-player games use pass and play.'));
    const id=requestId(),owner=this.turnIdentity();
    const match:Match={id,game_id:game.id,game_version:game.version,owner_user_id:owner,match_kind:'multiplayer',
      status:'waiting_for_players',state:null,players:[{id:owner,user_id:owner,player_index:0,kind:'human',active:true,name:account.display_name}],
      turn_of_player_indices:null,move_count:0,created_at:new Date().toISOString(),cloud_pending:true,bet_per_player:options.bet_per_player || 0,token_pot:0};
    const body={...options,match_kind:'multiplayer',num_computer_opponents:0,client_match_id:id};
    await this.repository.mutate(account.id,data=>{guard();data.creations ||= {};data.creations[id]={requestId:id,body};data.responses[`/matches/${id}`]=match;
      data.responses[`/games/${game.id}/versions/${game.version}`]=this.exactPackage(game.id,game.version)||game;
      const listed=savedList<Match>(data.responses['/matches']);data.responses['/matches']=[match,...listed.filter(item=>item.id!==id)];data.selectedId=id;});
    guard();await this.reloadData();guard();this.patch({myMatches:unique([match,...this.state.myMatches])});await this.selectMatch(id,undefined,match);
    if(!this.localOnly&&isOnline())void this.sync().catch(()=>{});
    return this.decorate(match)!;
  }
  private async requestMatchAction(match: Match, action: string, body?: any) { const token = this.selection; const path=action==='join'&&this.selectedInvite?.matchId===match.id?`/invites/${encodeURIComponent(this.selectedInvite.token)}/accept`:`/matches/${encodeURIComponent(match.id)}/${action}`; const result = await this.request('POST', path, body); if (result?.id) { await this.cache(`/matches/${result.id}`, result); if (token === this.selection && this.state.selectedMatch?.id === match.id) this.patch({ selectedMatch: this.decorate(result) }); } await this.refreshProfile().catch(() => {}); return result; }
  async matchAction(action: string, body?: any) { const match = this.state.selectedMatch; if (!match) throw new Error('Choose a match first'); return this.requestMatchAction(match,action,body); }
  async removePlayer(userId: string) { const match = this.state.selectedMatch; if (!match) return; const token = this.selection; const result = await this.request('DELETE', `/matches/${encodeURIComponent(match.id)}/players/${encodeURIComponent(userId)}`); await this.cache(`/matches/${result.id}`, result); if (token === this.selection) this.patch({ selectedMatch: this.decorate(result) }); }
  async archiveMatch(id: string, { deleted = false, hidePermanently = true, onlySynced = false }: { deleted?: boolean; hidePermanently?: boolean; onlySynced?: boolean } = {}) {
    const guard = this.capture(), owner = this.identity(), token = this.selection;
    const archived=await this.repository.mutate(owner, data => {
      guard();
      // A turn may have been saved while the deletion-check GET was in flight.
      // Recheck under the storage lock before retiring a clean cloud mirror.
      if(onlySynced && (!data.local[id] || needsCloudSave(data.local[id]) || data.conflicts[id] || data.queues[id]?.length))return false;
      if (!deleted && !data.local[id] && (data.queues[id]?.length || data.conflicts[id] || this.data.conflicts[id])) throw new Error(copyText('Sync or resolve pending actions before hiding this match.'));
      const archives = hidePermanently ? data.archivedMatches : data.archives;
      archives.push({ id, match: data.local[id] || data.responses[`/matches/${id}`], moves: data.queues[id] || [], savedAt: new Date().toISOString() });
      delete data.local[id]; delete data.queues[id]; delete data.conflicts[id]; delete data.responses[`/matches/${id}`];
      if (Array.isArray(data.responses['/matches'])) data.responses['/matches'] = data.responses['/matches'].filter((match: Match) => match.id !== id);
      if (data.selectedId === id) data.selectedId = null;
      return true;
    });
    if(!archived)return;
    guard(); if (token === this.selection && this.state.selectedMatch?.id === id) this.clearMatch();
    await this.reloadData(); guard(); this.patch({ myMatches: this.state.myMatches.filter(m => m.id !== id) });
  }
  async leaveMatch(id?: string) {
    const guard = this.capture();
    if (id && (this.data.queues[id]?.length || this.data.conflicts[id])) throw new Error(copyText('Sync or resolve pending actions before leaving or deleting this match.'));
    const match = id ? await this.request('GET', `/matches/${encodeURIComponent(id)}`) as Match : this.state.selectedMatch;
    guard(); if (!match) return;
    if (id && (this.data.queues[id]?.length || this.data.conflicts[id])) throw new Error(copyText('Sync or resolve pending actions before leaving or deleting this match.'));
    const waiting = match.status === 'waiting_for_players', over = match.status === 'over';
    if (over || waiting && match.owner_user_id === this.state.account?.id) {
      // The existing endpoint hides a finished match for this player, or
      // cancels a waiting lobby and refunds its players when the host leaves.
      await this.request('DELETE', `/matches/${encodeURIComponent(match.id)}`); guard();
      await this.archiveMatch(match.id, { deleted: true });
      return;
    }
    const result = await this.requestMatchAction(match,waiting ? 'leave' : 'playerLeft'); guard();
    // A guest can rejoin this lobby later, so the server's membership list
    // should decide its visibility instead of a permanent local hide record.
    if (waiting) await this.archiveMatch(match.id, { deleted: true, hidePermanently: false });
    else if (id) {await this.reloadData();guard();}
    return result;
  }
  private async sync(freshRequestId?: string, matchId?: string): Promise<void> {
    if (this.localOnly || !this.state.account || !isOnline() || (!freshRequestId && Date.now() < Math.max(this.retryAfter,this.syncCompatibilityRetryAfter))) return;
    if (this.syncPromise) { await this.syncPromise; return this.sync(freshRequestId,matchId); }
    const account = this.state.account; const guard = this.capture();
    const confirmed: {before: Match; after: Match}[] = [];
    const pending = syncAccount(this.api, this.repository, account, { paginated: this.paginated, guard, freshRequestId, matchId, onConfirmed: (before, after) => confirmed.push({before, after}) }).then(async data => { guard(); const previous = this.state.selectedMatch; this.syncCompatibilityRetryAfter=0;this.patch({ network: isOnline() }); this.publishData(data); const selected = this.state.selectedMatch; if (selected && selected.move_count !== previous?.move_count) { await this.recoverPresentation(selected, previous || undefined).catch(() => {}); guard(); await this.refreshProfile().catch(() => {}); } for (const {before, after} of confirmed) {guard(); await this.offerNotificationPrompt(before, after);} }).catch(error => { guard(); if(error instanceof RetryableSyncCompatibilityError)this.syncCompatibilityRetryAfter=Date.now()+10000;else if (!(error instanceof ApiError) && !isQuotaError(error) && (error instanceof TypeError || /network|fetch|offline|connection|abort/i.test(error.message || ''))) { this.retryAfter = Date.now() + 10000; this.patch({ network: false }); } throw error; }).finally(() => { if (this.syncPromise === pending) this.syncPromise = null; }); this.syncPromise = pending; return pending;
  }
  async submitMove(move: any) {
    const match = this.state.selectedMatch; if (!match) return;
    if (this.data.local[match.id]) return this.practiceMove(move);
    const account = this.state.account; if (!account) throw new Error('Log in first');
    if (this.state.replayIndex !== null) throw new Error('Return to the live match before moving');
    const seat = match.players.find(p => p.user_id === account.id && p.active !== false);
    if (!seat || match.status !== 'ongoing' || !match.turn_of_player_indices?.includes(seat.player_index)) throw new Error('It is not your turn');
    const guard = this.capture(); const entry = { requestId: requestId(), body: { move, expected_move_count: match.move_count }, baseState: match.state, baseTurn: match.turn_of_player_indices, savedAt: new Date().toISOString() };
    const packagePath=`/games/${match.game_id}/versions/${match.game_version}`,gamePackage=this.exactPackage(match.game_id,match.game_version);
    try { await this.repository.mutate(account.id, data => { if (data.queues[match.id]?.length || data.conflicts[match.id]) throw new Error('Wait for the pending action to sync or resolve its conflict'); const saved = data.responses[`/matches/${match.id}`]; if (saved && saved.move_count !== match.move_count) throw new Error('The match changed in another window; refresh before moving');if(!data.responses[packagePath]){if(!gamePackage)throw new Error('Exact downloaded game rules are unavailable for an offline queue.');data.responses[packagePath]=gamePackage;} data.responses[`/matches/${match.id}`] = match; data.queues[match.id] = [entry]; }); }
    catch (error) {
      guard();
      if (!isOnline() || this.data.queues[match.id]?.length || this.data.conflicts[match.id] || !/quota|storage|disk|denied|unavailable/i.test(`${(error as Error).name} ${(error as Error).message}`) || /pending action|another window/.test((error as Error).message)) throw error;
      // Storage-denied browsers may still play online. This is one fresh POST;
      // uncertainty freezes play until a subsequent authoritative GET.
      reportCacheFailure('online-action',error);
      try { const updated = await this.api.request<Match>('POST', `/matches/${encodeURIComponent(match.id)}/moves`, entry.body, account, entry.requestId); guard(); await this.cache(`/matches/${match.id}`, updated); this.patch({ selectedMatch: this.decorate(updated) }); await this.refreshProfile().catch(() => {}); guard(); await this.offerNotificationPrompt(match, updated); return; }
      catch (requestError) { guard(); this.data.conflicts[match.id] = { message: 'The outcome of this unsaved action is unknown. Refresh the match before trying again.' }; this.patch({ selectedMatch: this.decorate(match) }); throw requestError; }
    }
    guard(); await this.reloadData();
    // A fresh online post needs no preliminary GET. Any retry reconciles history.
    try { await this.sync(entry.requestId, match.id); } catch (error) { if (error instanceof ApiError && error.status !== 409) throw error; this.patch({ error: 'Action saved on this device. It will sync after reconnecting.' }); }
  }
  async resolveConflict(id: string) { const remote = await this.request('GET', `/matches/${encodeURIComponent(id)}`); await this.repository.mutate(this.identity(), data => { data.archives.push({ id, ...(data.local[id] ? {match:data.local[id]} : {}), moves: data.queues[id] || [], conflict: data.conflicts[id], savedAt: new Date().toISOString() }); delete data.queues[id]; delete data.conflicts[id]; if (data.local[id] && remote.single_player_state) delete data.local[id]; data.responses[`/matches/${id}`] = remote; hydrateSinglePlayer(data,remote); }); await this.reloadData(); }
  private async callGame(game: Game, name: string, args: any[], match: LocalMatch): Promise<any> { if (!game.server_code) throw new Error('Download the game rules before playing locally'); return this.rulesExecutor({ server_code: game.server_code, game_schemas: game.game_schemas }, name, args, { players: match.players.map(p => ({ id: p.id, kind: p.kind, active: p.active !== false, display_name: p.name || `Player ${p.player_index + 1}`, picture_url: '', max_loss: 0 })), pot: 0, move_count: match.move_count }, (match.practiceSeed + match.move_count) >>> 0, Date.parse(match.created_at)); }
  private async practiceResult(game: Game, match: LocalMatch, result: any, record = true, actor: number | null = null) {
    const ids = match.players.map(p => p.id);
    if (!result || !Object.hasOwn(result, 'state') || !(result.turn === null || Array.isArray(result.turn) && result.turn.length && new Set(result.turn).size === result.turn.length && result.turn.every((id: string) => ids.includes(id)))) throw new Error('Local game returned an invalid state or turn');
    match.logicState = result.state; match.turn_of_player_indices = result.turn === null ? null : result.turn.map((id: string) => ids.indexOf(id)); match.status = result.turn === null ? 'over' : 'ongoing'; match.end_reason = result.turn === null ? 'finished' : null;
    if (record) { match.move_count++; match.last_move_player_index = actor; }
    const seat = match.localMode === 'pass' ? match.turn_of_player_indices?.find(i => match.players[i].kind === 'human') ?? localHumanSeat(match) : localHumanSeat(match);
    match.state = await this.callGame(game, 'viewFor', [match.logicState, ids[seat]], match);
    if (record) match.moves = [...(match.moves || []), { move_number: match.move_count, player_index: actor, new_state: match.state, next_turn_player_indices: match.turn_of_player_indices }];
  }
  private async practiceComputers(game: Game, match: LocalMatch) {
    for (let count = 0; match.status === 'ongoing'; count++) {
      const computer = match.turn_of_player_indices?.map(i => match.players[i]).find(p => p.kind === 'computer'); if (!computer) return;
      if (count >= LOCAL_COMPUTER_MOVE_LIMIT) throw new Error('Local game exceeded the computer move limit. The last saved board is unchanged.');
      const move = await this.callGame(game, 'computerMove', [match.logicState, computer.id], match);
      await this.practiceResult(game, match, await this.callGame(game, 'applyMove', [match.logicState, computer.id, move], match), true, computer.player_index);
    }
  }
  async startPractice(gameId: string, options: PracticeOptions = {}) {
    if (!this.state.account && !this.localOnly) throw new Error(copyText('Log in to save your matches in the cloud.'));
    const guard = this.capture();
    const viewed = !this.state.selectedMatch && this.state.selectedGameId === gameId ? this.state.game : null;
    // Game details already loaded and validated this exact version. Use it
    // when starting there instead of downloading the latest package twice.
    const game = viewed?.id === gameId && isValidDownloadedGame(this.exactPackage(gameId, viewed.version), gameId, viewed.version)
      ? viewed : await this.pinnedGame(gameId);
    guard();
    const humans = options.humans ?? 1, computers = options.computers ?? 1, humanSeat = options.humanSeat ?? 0, total = humans + computers;
    if (!Number.isInteger(humans) || humans < 1 || !Number.isInteger(computers) || computers < 0 || !Number.isInteger(humanSeat) || humanSeat < 0 || humanSeat + humans > total) throw new Error(copyText('Choose valid local player counts and a human seat.'));
    if (computers > 0 && humans !== 1) throw new Error(copyText('Computer matches have one human player. Use pass and play for several people on one device.'));
    if (!game.allowed_player_counts.includes(total)) throw new Error(`This game supports ${game.allowed_player_counts.join(', ')} players`);
    const id = `local-${requestId()}`; const owner = this.identity();
    const match = { id, game_id: game.id, game_version: game.version, owner_user_id: owner, players: Array.from({ length: total }, (_, i) => {
      const human = i >= humanSeat && i < humanSeat + humans;
      return { player_index: i, id: `local-player-${i}`, kind: human ? 'human' : 'computer', user_id: i === humanSeat ? owner : null, active: true, name: options.names?.[i] || (i === humanSeat ? this.state.account?.display_name || `Player ${i + 1}` : human ? `Player ${i + 1}` : `Computer ${i + 1}`) };
    }), status: 'ongoing', state: null, logicState: null, turn_of_player_indices: [0], move_count: 0, created_at: new Date().toISOString(), match_kind: computers ? 'computer' : 'pass_and_play', localMode: computers ? 'computer' : 'pass', practiceSeed: Math.floor(Math.random() * 4294967296), moves: [], initialState: null, initialTurn: [0], token_pot: 0, bet_per_player: 0, local_revision:1, synced_local_revision:0, cloud_revision:0, cloud_pending:true } as LocalMatch;
    await this.practiceResult(game, match, await this.callGame(game, 'newMatch', [], match), false); match.initialState = match.state; match.initialTurn = match.turn_of_player_indices; await this.practiceComputers(game, match); guard();
    const gamePackage=this.exactPackage(game.id,game.version);if(!gamePackage)throw new Error('Exact downloaded game rules are unavailable for offline play.');
    const committed=await this.repository.mutate(owner, data => {
      data.local[id]=match;data.responses[`/games/${game.id}/versions/${game.version}`]=gamePackage;data.selectedId=id;
      return data;
    });
    guard();this.publishData(committed);++this.selection;
    this.requestedLink={kind:'match',id};this.selectedInvite=null;this.repository.protectGame(owner,game.id,game.version);
    this.patch({selectedMatch:this.decorate(match),game,selectedGameId:game.id,history:null,replayIndex:null});
    if(match.move_count>0)await this.recoverPresentation(match);
    if (!this.localOnly && this.state.account && isOnline()) void this.sync().catch(() => {}); return match;
  }
  private async applyPracticeTurn(original:LocalMatch,game:Game,move:any) {
    // The game runtime returns fresh state. Only new frames are appended so a
    // turn can reuse the in-memory history without copying every previous board.
    const next={...original};
    const actor=next.localMode==='pass'?next.turn_of_player_indices?.find(i=>next.players[i].kind==='human'):localHumanSeat(next);
    if(actor===undefined||!next.turn_of_player_indices?.includes(actor))throw new Error('It is not your turn');
    await this.practiceResult(game,next,await this.callGame(game,'applyMove',[next.logicState,next.players[actor].id,move],next),true,actor);
    next.moves[next.moves.length-1].move=move;
    const human=performance.now();
    await this.practiceComputers(game,next);
    const computer=performance.now();
    next.awaitingHandoff=game.all_state_public!==true&&next.localMode==='pass'&&next.status==='ongoing'&&next.turn_of_player_indices?.[0]!==actor;
    next.local_revision=localRevision(original)+1;next.cloud_pending=true;
    return {next,human,computer};
  }
  private observePracticeTurn(next:LocalMatch) {
    if(next.localMode==='computer')this.observations.set(next.id,(next.moves||[]).slice(-(LOCAL_COMPUTER_MOVE_LIMIT+1)).map(move=>({
      view:move.new_state,move_count:move.move_number,last_move_player_index:move.player_index,
    })));
  }
  private async saveDeviceTurns(repository:AccountRepository,owner:string) {
    const journal=repository.deviceTurns(owner)!;
    const generation=this.generation;
    const current=()=>this.generation===generation&&this.repository===repository&&this.identity()===owner;
    const start=performance.now();
    try {await journal.persist();}
    catch(error){
      if(current())this.patch({storageError:this.turnSaveError});
      throw error;
    }
    if(current()){
      recordDiagnosticEvent('local_move_journal_saved',{duration_ms:Math.round(performance.now()-start)});
      this.publishData(this.data);
      if(this.state.storageError===this.turnSaveError)this.patch({storageError:null});
    }
    const checkpoint=repository.checkpointTurns(owner);
    if(this.turnCheckpoint!==checkpoint){
      this.turnCheckpoint=checkpoint;
      void checkpoint.catch(error=>reportCacheFailure('turn-checkpoint',error)).then(()=>{
        if(current()&&!this.localOnly&&this.state.account&&isOnline())void this.sync().catch(()=>{});
      });
    }
  }
  private async flushDeviceTurns(){
    const owner=this.identity();
    if(this.repository.deviceTurns(owner)?.hasPending)await this.saveDeviceTurns(this.repository,owner);
  }
  async practiceMove(move:any,options:{waitForSave?:boolean}={}) {
    if(!this.state.account&&!this.localOnly)throw new Error(copyText('Log in to save your matches in the cloud.'));
    const selected=this.state.selectedMatch as LocalMatch;
    if(!selected||!this.data.local[selected.id])throw new Error('Choose a local match first');
    if(this.state.replayIndex!==null||this.awaitingLocalHandoff(this.data.local[selected.id]))throw new Error('Return to the live board and confirm the next player is ready');
    const guard=this.capture(),owner=this.identity(),repository=this.repository;
    const started=performance.now(),packagePath=`/games/${selected.game_id}/versions/${selected.game_version}`;
    const apply=async(data:AccountData)=>{
      const original=data.local[selected.id];
      if(!original||original.move_count!==selected.move_count||original.status!=='ongoing'||this.awaitingLocalHandoff(original,data))throw new Error('Local match changed. Refresh before moving.');
      const game:Game=data.responses[packagePath]||(original.game_id===bundled.id&&original.game_version===bundled.version?bundled:undefined);
      if(!game?.server_code)throw new Error('Download this game once before playing offline');
      const result=await this.applyPracticeTurn(original,game,move);guard();
      return {...result,original,game};
    };
    const journal=repository.deviceTurns(owner);
    if(journal){
      const selection=this.selection;
      const {next,original,human,computer}=await apply(journal.display(this.data));
      const current=journal.display(this.data).local[next.id];
      if(selection!==this.selection||this.state.replayIndex!==null||!current||current.status!=='ongoing'||this.awaitingLocalHandoff(current)||
        current.move_count!==original.move_count||
        localRevision(current)!==localRevision(original)||!equal(current.logicState,original.logicState))
        throw new Error('Local match changed. Refresh before moving.');
      journal.stage(deviceTurn(requestId(),original,next));
      this.observePracticeTurn(next);
      this.publishData(this.data);
      recordDiagnosticEvent('local_move_timing',{in_memory:true,wait_for_store_ms:0,read_ms:0,
        human_rules_and_view_ms:Math.round(human-started),computer_ms:Math.round(computer-human),
        save_ms:0,publish_ms:Math.round(performance.now()-computer)});
      const saved=this.saveDeviceTurns(repository,owner);
      if(options.waitForSave===false)void saved.catch(()=>{});
      else await saved;
      return;
    }
    await repository.lock(owner,async()=>{
      const acquired=performance.now(),data=await repository.read(owner),read=performance.now();
      const {next,game,human,computer}=await apply(data);
      data.responses[packagePath]??=game;
      data.local[next.id]=next;await repository.write(owner,data);guard();
      const saved=performance.now();
      this.observePracticeTurn(next);this.publishData(data);
      recordDiagnosticEvent('local_move_timing',{wait_for_store_ms:Math.round(acquired-started),read_ms:Math.round(read-acquired),
        human_rules_and_view_ms:Math.round(human-read),computer_ms:Math.round(computer-human),save_ms:Math.round(saved-computer),
        publish_ms:Math.round(performance.now()-saved)});
    });
    if(!this.localOnly&&this.state.account&&isOnline())void this.sync().catch(()=>{});
  }
  async revealLocal() { const id = this.state.selectedMatch?.id; if (!id) return; await this.repository.mutate(this.identity(), data => { if (data.local[id]) {data.local[id].awaitingHandoff = false;data.local[id].local_revision = localRevision(data.local[id])+1;data.local[id].cloud_pending=true;} }); await this.reloadData(); if (!this.localOnly && this.state.account && isOnline()) void this.sync().catch(() => {}); }
  async removeSavedMatch(id: string, expected: Match) {
    const guard=this.capture(),owner=this.identity(),token=this.selection;
    await this.repository.mutate(owner,data=>{
      guard();
      const match=data.local[id];
      if (!match || !singlePlayerKind(match) || !needsCloudSave(match) && !data.conflicts[id] && !data.queues[id]?.length)
        throw new Error(copyText('Choose an unsynced single-player save first.'));
      const current={...match,pending:data.queues[id]?.length || 0,conflict:data.conflicts[id] || null};
      if (expected.id !== id || !equal(savedMatchBranch(current),savedMatchBranch(expected)))
        throw new Error(copyText('This saved copy changed. Review it again before removing it.'));
      // Keep the full pending branch and its retry intent before retiring it.
      // archives is durable: archivedMatches is a quota-sheddable cache.
      data.archives.push(JSON.parse(redactedArchive({kind:REMOVED_SAVED_MATCH,id,match,moves:data.queues[id] || [],
        conflict:data.conflicts[id],creation:data.creations?.[id],savedAt:new Date().toISOString()})));
      delete data.local[id];delete data.queues[id];delete data.conflicts[id];
      if(data.creations)delete data.creations[id];
      for(const path of [`/matches/${id}`,`/matches/${encodeURIComponent(id)}`])delete data.responses[path];
      if(Array.isArray(data.responses['/matches']))data.responses['/matches']=data.responses['/matches'].filter((item:Match)=>item.id!==id);
      if(data.selectedId===id)data.selectedId=null;
    });
    guard();
    const removedSelected=token===this.selection && this.state.selectedMatch?.id===id;
    if(removedSelected)this.clearMatch();
    await this.reloadData();guard();
    this.patch({myMatches:this.state.myMatches.filter(match=>match.id!==id)});
    return removedSelected && this.selection===token+1 && this.state.selectedMatch===null;
  }
  async deleteSinglePlayer(id: string) {
    const guard=this.capture(),match=this.data.local[id];
    if(!match) {
      if(this.localOnly)return this.archiveMatch(id);
      if(!this.state.account||!isOnline())throw new Error(copyText('Connect to the internet to delete this cloud match.'));
      const remote=await this.request('GET',`/matches/${encodeURIComponent(id)}`);guard();
      if(!singlePlayerKind(remote))throw new Error(copyText('Choose a single-player match first.'));
      await this.request('DELETE',`/matches/${encodeURIComponent(id)}`);guard();
      return this.archiveMatch(id,{deleted:true});
    }
    if (!this.localOnly) {
      if (!this.state.account || !isOnline()) throw new Error(copyText('Connect to the internet to delete this cloud match.'));
      await this.sync(undefined,id);guard();
      const latest=this.data.local[id];
      if (!latest || needsCloudSave(latest) || this.data.conflicts[id]) throw new Error(copyText('Save or resolve this match before deleting it.'));
      await this.request('DELETE',`/matches/${encodeURIComponent(id)}`);guard();
    }
    await this.archiveMatch(id,{deleted:true});
  }
  private localHistory(match: LocalMatch) {
    return { initial_state: match.initialState, initial_turn_player_indices: match.initialTurn, moves: match.moves, total: match.move_count };
  }
  async loadHistory() {
    const match = this.state.selectedMatch; if (!match) return;
    const guard = this.capture(); const token = this.selection; const replayToken = this.replaySelection;
    const local = this.data.local[match.id]; let history: any;
    if (local) history = this.localHistory(local);
    else if (this.paginated) {
      const result = await this.read(`/v2/matches/${encodeURIComponent(match.id)}/history?start=0&limit=100`); history = { ...result, moves: result.items, nextStart: result.next_start };
    } else history = await this.read(`/matches/${encodeURIComponent(match.id)}/history`);
    guard(); if (token === this.selection && replayToken === this.replaySelection) this.patch({ history }); return history;
  }
  async replay(index: number | null) {
    const replayToken = ++this.replaySelection; const match = this.state.selectedMatch; if (!match) return; if (index === null) { this.patch({ replayIndex: null }); return; }
    const local = this.data.local[match.id];
    if (this.awaitingLocalHandoff(local)) throw new Error(copyText('Confirm the next player is ready before viewing history.'));
    const guard = this.capture(); const token = this.selection; let wanted = Math.max(0, Math.min(match.move_count, index));
    let history = this.state.history;
    // Returning live keeps the last replay snapshot, even as new moves are saved.
    if (local) history = this.localHistory(local);
    else if (this.paginated) {
      const result = await this.read(`/v2/matches/${encodeURIComponent(match.id)}/history?start=${Math.max(0, wanted - 1)}&limit=1`); history = { ...result, moves: result.items, offset: Math.max(0, wanted - 1), total: result.total };
    } else if (!history) history = await this.loadHistory();
    guard(); if (token !== this.selection || replayToken !== this.replaySelection) return;
    if (wanted === 0 && match.move_count > 0 && history?.initial_turn_player_indices === null) wanted = 1;
    const move = wanted === 0 && history && Object.hasOwn(history, 'initial_state') ? { new_state: history.initial_state } : history?.moves?.[wanted - 1 - (history.offset || 0)];
    if (!move || !Object.hasOwn(move, 'new_state')) throw new Error(copyText('This history frame is not available. Try another move.'));
    this.patch({ history, replayIndex: wanted }); return wanted;
  }
  private async recoverPresentation(match: Match, previous?: Match) {
    const guard = this.capture(); const token = this.selection;
    if (this.state.selectedMatch?.id !== match.id) return;
    let snapshots = this.observations.get(match.id) || [];
    const delta = previous?.id === match.id ? match.move_count - previous.move_count : null;
    if (match.move_count > 0 && (delta === null || delta > 1 || delta < 0 || !snapshots.length)) {
      const start = Math.max(0, match.move_count - 12); let moves: any[] = [];
      if (this.data.local[match.id]) moves = this.data.local[match.id].moves.slice(start);
      else if (this.paginated) moves = (await this.read(`/v2/matches/${encodeURIComponent(match.id)}/history?start=${start}&limit=${match.move_count - start}`)).items;
      else if (match.move_count <= 12) moves = (await this.read(`/matches/${encodeURIComponent(match.id)}/moves`)).slice(start);
      guard(); if (token !== this.selection) return;
      if (Array.isArray(moves) && moves.length === match.move_count - start && moves.every((move, index) => Object.hasOwn(move, 'new_state') && Number.isInteger(move.player_index) && move.player_index >= 0 && move.player_index <= 9 && (move.move_number === start + index + 1 || this.data.local[match.id] && move.move_number === undefined))) snapshots = moves.map((move, index) => ({ view: move.new_state, move_count: start + index + 1, last_move_player_index: move.player_index }));
    }
    if (!snapshots.some(item => item.move_count === match.move_count)) snapshots = [...snapshots, { view: match.state, move_count: match.move_count, last_move_player_index: match.last_move_player_index ?? null }];
    this.observations.set(match.id, snapshots.filter(item => item.move_count <= match.move_count).slice(-12)); this.patch({});
  }
  presentationHistory() {
    const match=this.state.selectedMatch;
    return match&&this.state.replayIndex===null?this.observations.get(match.id)||[]:[];
  }
  presentationMessage(): any {
    const match = this.state.selectedMatch; if (!match) return null;
    const replay = this.state.replayIndex; const history = this.state.history; let view = match; let replayActor: number | null = null;
    if (replay !== null && history) { const move = replay === 0 ? { new_state: history.initial_state, next_turn_player_indices: history.initial_turn_player_indices } : history.moves?.[replay - 1 - (history.offset || 0)]; if (move) { view = { ...match, state: move.new_state, turn_of_player_indices: move.next_turn_player_indices, move_count: replay, status: move.next_turn_player_indices === null ? 'over' : 'ongoing' }; replayActor = Number.isInteger(move.player_index) ? move.player_index : null; } }
    // Local pass-and-play snapshots contain the next human's private view.
    // During replay its viewer must follow that frame, not the live match turn.
    const local = this.data.local[match.id]; const seat = local ? local.localMode === 'pass' ? view.turn_of_player_indices?.find(i => match.players[i].kind === 'human') ?? localHumanSeat(match) : localHumanSeat(match) : match.players.find(p => p.user_id === this.state.account?.id && p.active !== false)?.player_index ?? null;
    const allowed = replay === null && !match.pending && (local || !match.conflict) && (!local || this.state.account || this.localOnly) && !this.awaitingLocalHandoff(local) && view.status === 'ongoing' && seat !== null && view.turn_of_player_indices?.includes(seat);
    const texts = this.state.game ? gameTexts(this.state.game) : null;
    return { type: 'state_changed', state: view.state ?? null, view: view.state ?? null, players: match.players.map(p => ({ player_index: p.player_index, player_id: p.id, kind: p.kind, name: p.name || (p.user_id ? this.state.profiles[p.user_id]?.display_name || (p.user_id === this.state.account?.id ? this.state.account.display_name : `Player ${p.player_index + 1}`) : `Computer ${p.player_index + 1}`), picture_url: p.user_id ? this.state.profiles[p.user_id]?.picture_url || '' : '' })), turn_of_player_indices: view.turn_of_player_indices, turn_of_player_index: view.turn_of_player_indices?.[0] ?? null, my_player_index: seat, acting_for_player_index: allowed ? seat : null, status: view.status, end_reason: view.end_reason, move_count: view.move_count, last_move_player_index: replay === null ? match.last_move_player_index ?? null : replayActor, token_pot: view.token_pot || 0, replay: replay === null ? null : { index: replay, total: match.move_count }, presentation_history: this.presentationHistory().slice(-12), locale: getLocale(), direction: getDirection(), strings: texts?.strings || this.state.game?.declarative_ui?.strings || {} };
  }
  actions = {
    flushDeviceTurns: () => this.flushDeviceTurns(),
    refreshNotifications: (more = false) => this.refreshNotifications(more), readNotification: (id: string) => this.perform(() => this.readNotification(id), false), claimNotificationPrompt: () => this.claimNotificationPrompt(), dismissNotificationPrompt: () => this.patch({notificationPrompt: false, notificationPromptReady: false}),
    bootstrap: (baseUrl?: string, localOnly = false,initialUrl?:string) => this.bootstrap(baseUrl, localOnly,initialUrl), refresh: () => this.refresh(), refreshMatch: () => this.refreshMatch(),
    rememberAttribution:(url:string)=>this.rememberAttribution(url),
    watchInvite:()=>{if(this.requestedLink?.kind==='invite')this.requestedLink=this.state.selectedMatch?{kind:'match',id:this.state.selectedMatch.id}:null;},
    request: (method: string, path: string, body?: any) => this.perform(() => this.request(method, path, body), false),
    recordInviteShare:(id:string,channel:InviteShareChannel)=>this.request('POST',`/matches/${encodeURIComponent(id)}/share`,{channel}).catch(()=>{}),
    searchGames: (query: string) => this.perform(async () => { this.patch({ query, games: [], cursors: { ...this.state.cursors, games: null } }); await this.list('games'); }),
    suggestGames: (query: string) => this.suggestGames(query),
    loadMoreGames: (kind: GameCarousel) => this.loadCarousel(kind, true),
    loadMore: (kind: ListKind) => this.perform(() => this.list(kind, true)),
    selectGame: (id: string) => this.perform(() => this.selectGame(id)), selectMatch: (id: string) => this.perform(() => this.selectMatch(id)), clearMatch: () => this.clearMatch(), clearGame: () => this.clearGame(), importLogin: (response: any) => this.perform(() => this.saveLogin(response)),
    guest: (name: string,intentGuard?:()=>void) => this.perform(() => this.guest(name,intentGuard)), requestCode: (method: 'email' | 'phone', value: string, delivery?: string) => this.perform(() => this.requestCode(method, value, delivery)),
    browserLogin: (link = false,intentGuard?:()=>void,verifiedOnly=false) => this.perform(() => this.browserLogin(link,intentGuard,verifiedOnly)),
    verifyCode: (method: 'email' | 'phone', id: string, code: string, name?: string, link?: boolean,intentGuard?:()=>void) => this.perform(() => this.verifyCode(method, id, code, name, link,intentGuard)), google: (token: string, link?: boolean,intentGuard?:()=>void) => this.perform(() => this.google(token, link,intentGuard)),
    requestAccountDeletion: () => this.perform(() => this.changeAccountDeletion(true), false), cancelAccountDeletion: () => this.perform(() => this.changeAccountDeletion(false), false),
    switchAccount: (id: string,intentGuard?:()=>void) => this.perform(() => this.switchAccount(id,intentGuard)), logout: (id?: string) => this.perform(() => this.logout(id)), updateProfile: (patch: any) => this.perform(() => this.updateProfile(patch)),
    createMatch: (options: any) => this.perform(() => this.createMatch(options)),
    matchAction: (action: 'join' | 'start' | 'leave' | 'rematch' | 'maybeLeave' | 'playerLeft', body?: any) => this.perform(() => this.matchAction(action, body)), removePlayer: (id: string) => this.perform(() => this.removePlayer(id)),
    leaveMatch: (id?: string) => this.perform(() => this.leaveMatch(id)), archiveMatch: (id: string) => this.perform(() => this.archiveMatch(id)), submitMove: (move: any) => this.perform(() => this.submitMove(move), false), resolveConflict: (id: string) => this.perform(() => this.resolveConflict(id)),
    startPractice: (id: string, options?: PracticeOptions) => this.perform(() => this.startPractice(id, options)), practiceMove: (move:any,options?:{waitForSave?:boolean}) => this.perform(() => this.practiceMove(move,options),false), revealLocal: () => this.perform(() => this.revealLocal()), deleteLocal: (id: string) => this.perform(() => this.deleteSinglePlayer(id)), removeSavedMatch: (id: string, expected: Match) => this.perform(() => this.removeSavedMatch(id,expected)),
    loadHistory: () => this.perform(() => this.loadHistory()), replay: (index: number | null) => this.perform(() => this.replay(index), false), presentationMessage: () => this.presentationMessage(), presentationHistory: () => this.presentationHistory(),
    saveGame: (id: string, saved: boolean) => this.perform(async () => { await this.request(saved ? 'PUT' : 'DELETE', `${this.paginated ? '/v2' : ''}/users/me/saved-games/${encodeURIComponent(id)}`); await this.list('savedGames'); }),
    openInvite: (token: string) => this.perform(() => this.openInvite(token)),
    acceptInvite: (token: string) => this.perform(() => this.acceptInvite(token)),
    setLocale: (locale: string) => this.perform(async () => { if (!await setLocale(locale)) return; this.patch({ locale }); if (this.state.account) await this.updateProfile({ locale }); }),
    clearError: () => this.patch({ error: null }),
  };
}
export const portal = new PortalStore();
export function usePortal() { const state = useSyncExternalStore(portal.subscribe, portal.getSnapshot, portal.getSnapshot); return { ...state, actions: portal.actions }; }
