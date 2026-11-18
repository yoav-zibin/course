import { useSyncExternalStore } from 'react';
import { PortalApi, ApiError } from './api';
import { AccountRepository, emptyAccountData, equal, requestId } from './repository';
import { syncAccount } from './sync';
import { importNativeLegacy, finishNativeImport } from './native-migration';
import * as storage from '../platform/storage';
import { loadAccounts, saveAccounts, CURRENT_KEY } from '../platform/credentials';
import { isOnline, watchConnectivity } from '../platform/connectivity';
import { configureI18n, setLocale, getLocale, getDirection, gameTexts, localizeGame, subscribeI18n, t, copyText } from '../platform/i18n';
import bundled from './bundled-tictactoe.json';
import { browserLogin } from '../platform/browser-login';
import { rememberUrlAttribution, newAccountAttribution, forgetInviter } from './attribution';
import type { Account, AccountData, Game, Match, LocalMatch, ListKind, PortalState } from './types';
export * from './types';
export { t } from '../platform/i18n';

const initial = (): PortalState => ({ ready: false, baseUrl: '', account: null, accounts: [], profile: null, profiles: {}, authConfig: {}, games: [], popularGames: [], recentGames: [], myMatches: [], openMatches: [], savedGames: [], invites: [], localMatches: [], selectedMatch: null, selected: null, selectedGame: null, game: null, selectedGameId: null, history: null, replayIndex: null, pending: 0, conflicts: {}, archived: [], network: isOnline(), loading: false, error: null, storageError: null, locale: 'en', query: '', cursors: {} });
const listPaths: Record<ListKind, string> = { games: '/games', myMatches: '/matches', openMatches: '/matches/open', savedGames: '/users/me/saved-games', invites: '/users/me/invites' };
const unique = <T extends { id?: string; token?: string }>(values: T[]): T[] => [...new Map(values.map(v => [v.id || v.token, v])).values()];
const savedList = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];

export class PortalStore {
  constructor(private rulesExecutor: (game: { server_code: string; game_schemas?: unknown }, name: string, args: unknown[], ctx: unknown, seed: number | string, now: number) => Promise<any> = async (...args) => (await import('../game/runtime')).executeGame(...args), private loginBrowser: (baseUrl: string) => Promise<any> = browserLogin, private writeCurrentAccount: (id: string) => Promise<void> = id => storage.setItem(CURRENT_KEY, id)) {}
  private state = initial();
  private listeners = new Set<() => void>();
  private data = emptyAccountData();
  private generation = 0;
  private selection = 0;
  private replaySelection = 0;
  private localOnly = false;
  private accountSelectionWrites: Promise<void> = Promise.resolve();
  private paginated = false;
  private refreshPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private bootstrapPromise: Promise<void> | null = null;
  private stopConnectivity?: () => void;
  private observations = new Map<string, any[]>();
  private retryAfter = 0;
  private api = new PortalApi('', getLocale);
  private repository = new AccountRepository();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(update: Partial<PortalState>) { if (Object.hasOwn(update, 'selectedMatch')) update.selected = update.selectedMatch; if (Object.hasOwn(update, 'game')) update.selectedGame = update.game; this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private localize() { this.patch({ locale: getLocale(), games: this.state.games.map(localizeGame), savedGames: this.state.savedGames.map(localizeGame), popularGames: this.state.popularGames.map(localizeGame), recentGames: this.state.recentGames.map(localizeGame), game: this.state.game ? localizeGame(this.state.game) : null }); }
  private identity() { return this.state.account?.id || 'visitor'; }
  private capture() { const epoch = this.generation, account = this.identity(), base = this.state.baseUrl; return () => { if (epoch !== this.generation || account !== this.identity() || base !== this.state.baseUrl) throw new Error('Account changed; refresh to continue.'); }; }
  private async perform<T>(run: () => Promise<T>, loading = true): Promise<T> { if (loading) this.patch({ loading: true }); this.patch({ error: null }); try { return await run(); } catch (error) { this.patch({ error: error instanceof Error ? error.message : String(error) }); throw error; } finally { if (loading) this.patch({ loading: false }); } }
  private decorate(match: Match | null): Match | null { return match ? { ...match, pending: this.data.queues[match.id]?.length || 0, conflict: this.data.conflicts[match.id] || null } : null; }
  private publishData(data: AccountData) {
    this.data = data; const selected = this.state.selectedMatch;
    const next = selected ? data.local[selected.id] || data.responses[`/matches/${selected.id}`] || selected : null;
    this.patch({ localMatches: Object.values(data.local), conflicts: data.conflicts, archived: [...data.archivedMatches, ...data.archives], pending: Object.values(data.queues).reduce((n, q) => n + q.length, 0), selectedMatch: this.decorate(next), myMatches: this.state.myMatches.map(m => this.decorate(data.responses[`/matches/${m.id}`] || m)!) });
  }
  private async reloadData() { const id = this.identity(); const guard = this.capture(); try { const data = await this.repository.read(id); guard(); this.publishData(data); } catch (error) { guard(); this.patch({ storageError: `Saved data is unavailable: ${(error as Error).message}. Existing saves were kept.` }); } }
  private async cache(path: string, value: any) { const id = this.identity(); const guard = this.capture(); try { value = await this.repository.cache(id, path, value); } catch (error) { guard(); const previous = this.data.responses[path]; if (/^\/matches\/[^/]+$/.test(path) && previous?.move_count > value?.move_count) value = previous; this.patch({ storageError: `Could not save downloaded data: ${(error as Error).message}` }); } guard(); this.data.responses[path] = value; return value; }
  async request(method: string, path: string, body?: any): Promise<any> { if (this.localOnly) throw new Error('This test launch runs entirely on this device.'); const guard = this.capture(); const result = await this.api.request(method, path, body, this.state.account); guard(); return result; }
  private async read(path: string, allowCached = true): Promise<any> {
    const guard = this.capture();
    if (this.localOnly) { if (allowCached && Object.hasOwn(this.data.responses, path)) return this.data.responses[path]; throw new TypeError('This device launch is offline.'); }
    try { if (!isOnline() || Date.now() < this.retryAfter) throw new TypeError('Offline'); const result = await this.api.request('GET', path, undefined, this.state.account); guard(); this.retryAfter = 0; this.patch({ network: true }); const matchId = /^\/matches\/([^/]+)$/.exec(path)?.[1]; if (matchId && this.data.conflicts[matchId]?.message.startsWith('The outcome of this unsaved action')) delete this.data.conflicts[matchId]; const saved = await this.cache(path, result); guard(); return saved; }
    catch (error) { guard(); if (error instanceof ApiError && error.status < 500) throw error; if (Date.now() >= this.retryAfter) this.retryAfter = Date.now() + 10000; this.patch({ network: false }); if (allowCached && Object.hasOwn(this.data.responses, path)) return this.data.responses[path]; throw error; }
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
    if (!this.paginated && kind === 'games' && this.state.query) items = items.filter((g: Game) => `${g.name} ${g.description}`.toLowerCase().includes(this.state.query.toLowerCase()));
    const preserveTail = !more && this.paginated && this.state[kind].length > 50;
    if (more) items = unique([...(this.state[kind] as any[]), ...items]);
    else if (preserveTail) items = unique([...items, ...(this.state[kind] as any[]).slice(50)]);
    if (kind === 'myMatches') items = items.map((m: Match) => this.decorate(m));
    if (kind === 'games' || kind === 'savedGames') items = items.map(localizeGame);
    if (kind === 'myMatches') { const archived = new Set(this.data.archivedMatches.map(item => item.id)); items = items.filter((m: Match) => !archived.has(m.id)); }
    if (kind === 'invites') items = items.map((invite: any) => ({ ...invite, url: invite.url || `${this.state.baseUrl}/portal#invite=${encodeURIComponent(invite.token)}` }));
    this.patch({ [kind]: items, cursors: { ...this.state.cursors, [kind]: preserveTail ? this.state.cursors[kind] : result.next_cursor || null } });
    // Stable aliases restore useful lists when the next launch is offline.
    await this.cache(listPaths[kind], items);
  }
  async bootstrap(baseUrl?: string, localOnly = false, initialUrl?:string): Promise<void> {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.perform(async () => {
      const base = (baseUrl ?? (typeof location !== 'undefined' ? location.origin : process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun')).replace(/\/$/, '');
      this.localOnly = localOnly;
      this.api = new PortalApi(base, getLocale, localOnly ? async () => { throw new Error('This test launch runs entirely on this device.'); } : fetch); this.repository = new AccountRepository(base); this.patch({ baseUrl: base, network: !localOnly && isOnline() });
      let accounts: Account[];
      try { accounts = await loadAccounts(); accounts = await importNativeLegacy(base || 'https://buildplay.fun', this.repository, accounts); await saveAccounts(accounts); await finishNativeImport(base || 'https://buildplay.fun'); }
      catch (error) { accounts = await loadAccounts().catch(() => []); this.patch({ storageError: `Saved data needs attention: ${(error as Error).message}. Existing saves were kept.` }); }
      const id = await storage.getItem(CURRENT_KEY).catch(() => null); const account = accounts.find(a => a.id === id) || accounts[0] || null;
      this.patch({ accounts, account }); await this.reloadData();
      const incoming=initialUrl??(typeof location!=='undefined'?location.href:null);if(incoming)await rememberUrlAttribution(incoming,base,accounts);
      const snapshot = this.data;
      this.patch({ games: savedList(snapshot.responses['/games']), myMatches: savedList(snapshot.responses['/matches']), openMatches: savedList(snapshot.responses['/matches/open']), savedGames: savedList(snapshot.responses['/users/me/saved-games']) });
      if (snapshot.selectedId) { const match = snapshot.local[snapshot.selectedId] || snapshot.responses[`/matches/${snapshot.selectedId}`]; if (match) this.patch({ selectedMatch: this.decorate(match), game: snapshot.responses[`/games/${match.game_id}/versions/${match.game_version}`] || null }); }
      subscribeI18n(() => this.localize());
      if (!localOnly) this.stopConnectivity = watchConnectivity(online => { this.patch({ network: online }); if (online) { this.retryAfter = 0; void this.refresh().catch(() => {}); } });
      await configureI18n(base, account?.locale, localOnly).catch(() => {});
      if (!localOnly) try { const capabilities = await this.api.request('GET', '/storage/capabilities'); this.paginated = capabilities.pagination === true; } catch { this.paginated = Object.keys(snapshot.responses).some(key => key.startsWith('/v2/')); }
      try { this.patch({ authConfig: await this.read('/auth/config') }); } catch { this.patch({ authConfig: snapshot.responses['/auth/config'] || {} }); }
      this.patch({ ready: true }); await this.refresh();
    });
    return this.bootstrapPromise;
  }
  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const guard = this.capture();
    const pending = (async () => {
      await this.reloadData();
      if (this.localOnly) { this.patch({ network: false }); return; }
      if (this.state.account && isOnline()) await this.sync().catch(() => {});
      guard();
      if (this.state.selectedMatch) { await this.refreshMatch(); return; }
      const jobs: Promise<any>[] = [this.list('games'), this.list('openMatches'), this.read('/auth/config').then(authConfig => { guard(); this.patch({ authConfig }); }), this.read('/games/popular').then(popularGames => { guard(); this.patch({ popularGames: popularGames.map(localizeGame) }); })];
      if (this.state.account) jobs.push(this.list('myMatches'), this.list('savedGames'), this.list('invites'), this.read('/users/me/recent-games').then(recentGames => { guard(); this.patch({ recentGames: recentGames.map(localizeGame) }); }), this.read(`/users/${encodeURIComponent(this.state.account.id)}`).then(profile => { guard(); this.patch({ profile }); }));
      const results = await Promise.allSettled(jobs); guard();
      const first = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (first && !this.state.games.length) this.patch({ error: first.reason?.message || 'Could not refresh' });
      await this.loadProfiles().catch(() => {});
    })().finally(() => { if (this.refreshPromise === pending) this.refreshPromise = null; });
    this.refreshPromise = pending; return pending;
  }
  private async loadProfiles() {
    const guard = this.capture(); const ids = [...new Set([...this.state.myMatches, ...this.state.openMatches, ...(this.state.selectedMatch ? [this.state.selectedMatch] : [])].flatMap(m => m.players || []).map(p => p.user_id).filter(Boolean))].filter(id => !this.state.profiles[id!]).slice(0, 200);
    if (!ids.length) return; const profiles = await this.read(`/users?ids=${encodeURIComponent(ids.join(','))}`); guard(); this.patch({ profiles: { ...this.state.profiles, ...Object.fromEntries(profiles.map((p: any) => [p.id, p])) } });
  }
  async refreshMatch() {
    const selected = this.state.selectedMatch; if (!selected) return;
    const guard = this.capture(); const token = this.selection;
    if (this.data.local[selected.id]) { await this.reloadData(); return; }
    let match: Match;
    if (this.data.queues[selected.id]?.length) { await this.sync().catch(() => {}); guard(); match = this.data.responses[`/matches/${selected.id}`] || selected; }
    else match = await this.read(`/matches/${encodeURIComponent(selected.id)}`);
    guard(); if (token !== this.selection) return;
    this.patch({ selectedMatch: this.decorate(match) });
    const game = await this.pinnedGame(match.game_id, match.game_version); guard(); if (token !== this.selection) return;
    this.patch({ game, selectedGameId: game.id }); await this.loadProfiles().catch(() => {}); guard(); if (token !== this.selection) return;
    await this.recoverPresentation(match, selected).catch(() => {});
    if (match.status !== selected.status || match.token_pot !== selected.token_pot || !equal(match.token_payouts, selected.token_payouts)) await this.refreshProfile().catch(() => {});
  }
  private async pinnedGame(id: string, version?: number): Promise<Game> {
    if (id === bundled.id) return localizeGame(bundled as Game);
    const path = version === undefined ? `/games/${encodeURIComponent(id)}` : `/games/${encodeURIComponent(id)}/versions/${version}`;
    const cached = version !== undefined && this.data.responses[path];
    const game = cached || await this.read(path); if (!game?.declarative_ui) throw new Error('This game uses an earlier renderer. Its saved data is preserved in the archive.');
    if (!cached) await this.cache(`/games/${game.id}/versions/${game.version}`, game);
    let presentation = game.declarative_ui;
    if (game.id === '5f5293c3-2a3a-4eec-b631-9debf59be0ca') { try { presentation = await (await import('../game/presentation')).presentationForGame(game); } catch { /* preserve pinned original on unavailable digest */ } }
    // Display repair never mutates the persisted package or its version/rules.
    return localizeGame({ ...game, declarative_ui: presentation });
  }
  async selectGame(id: string) {
    const token = ++this.selection; const guard = this.capture(); const owner = this.identity();
    // Clear the previous match before any await. A restored match must never be
    // displayed with the unrelated package requested by an incoming game URL.
    this.patch({ selectedMatch: null, selectedGameId: id, game: null, history: null, replayIndex: null });
    await this.repository.mutate(owner, data => { guard(); if (token === this.selection) data.selectedId = null; }); guard(); if (token !== this.selection) return;
    const game = await this.pinnedGame(id); guard(); if (token === this.selection) this.patch({ selectedGameId: id, game }); return game;
  }
  async selectMatch(id: string) {
    const token = ++this.selection; const guard = this.capture(); await this.reloadData();
    const match = this.data.local[id] || await this.read(`/matches/${encodeURIComponent(id)}`); guard(); if (token !== this.selection) return;
    const packageMatches = this.state.game?.id === match.game_id && this.state.game.version === match.game_version;
    this.patch({ selectedMatch: this.decorate(match), game: packageMatches ? this.state.game : null, selectedGameId: match.game_id, replayIndex: null, history: null });
    await this.repository.mutate(this.identity(), data => { guard(); if (token === this.selection) data.selectedId = id; });
    const game = await this.pinnedGame(match.game_id, match.game_version); guard(); if (token === this.selection) this.patch({ game, selectedGameId: game.id });
    await this.loadProfiles().catch(() => {});
    if (token === this.selection) await this.recoverPresentation(match).catch(() => {});
  }
  clearMatch() { ++this.selection; this.patch({ selectedMatch: null, history: null, replayIndex: null }); void this.repository.mutate(this.identity(), data => { data.selectedId = null; }).catch(() => {}); }
  clearGame() { this.clearMatch(); this.patch({ selectedGameId: null, game: null }); }
  private async saveLogin(response: any, removeIds: string[] = []) {
    const guard = this.capture();
    const id = response.user_id || response.id; if (!id || !response.password) throw new Error('Invalid account response');
    const account: Account = { ...response, id, linked: response.linked_accounts ?? response.linked ?? [] };
    const sourceIds = [...new Set([...removeIds, response.merged_from_user_id].filter((value): value is string => typeof value === 'string' && !!value && value !== id))];
    // This durable write precedes removing an alias from either account index.
    // A failed write leaves the old login and every original namespace intact.
    try { await this.repository.preserveMergedAccounts(id, sourceIds); } catch (error) { guard(); this.patch({ storageError: 'Linked account data could not be copied. The previous account remains selectable and its saved games and pending actions were kept.' }); throw error; }
    guard();
    const accounts = [...this.state.accounts.filter(a => a.id !== id && a.id !== response.merged_from_user_id && !removeIds.includes(a.id)), account];
    try {
      if (sourceIds.length) {
        // Keep aliases during the two-key credential/index commit. Failure at
        // any point leaves them selectable until the next successful login.
        await saveAccounts([...this.state.accounts.filter(a => a.id !== id), account]); guard(); await storage.setItem(CURRENT_KEY, id); guard(); await saveAccounts(accounts);
      } else { await saveAccounts(accounts); guard(); await storage.setItem(CURRENT_KEY, id); }
    } catch (error) {
      guard();
      if (sourceIds.length) { this.patch({ storageError: 'Linked credentials could not be saved. Previous account entries and their saved data remain available.' }); throw error; }
      this.patch({ storageError: 'Credentials could not be saved on this device. Keep the app open to retain this online session.' });
    }
    guard(); await forgetInviter();guard(); this.patch({ accounts }); await this.switchAccount(id);
  }
  async switchAccount(id: string) {
    const account = this.state.accounts.find(a => a.id === id); if (!account) throw new Error('Account not found on this device');
    const transition = ++this.generation; ++this.selection; this.refreshPromise = null; this.syncPromise = null; this.observations.clear();
    const write = this.accountSelectionWrites.then(async () => { if (transition === this.generation) await this.writeCurrentAccount(id); }); this.accountSelectionWrites = write.catch(() => {});
    await write.catch(() => {}); if (transition !== this.generation) throw new Error('Account changed; refresh to continue.');
    const { ready, baseUrl, accounts, authConfig, locale, storageError } = this.state;
    this.data = emptyAccountData(); this.patch({ ...initial(), ready, baseUrl, accounts, authConfig, account, locale, storageError, network: !this.localOnly && isOnline() }); const guard = this.capture(); await this.reloadData(); guard();
    this.patch({ games: savedList(this.data.responses['/games']), myMatches: savedList(this.data.responses['/matches']), openMatches: savedList(this.data.responses['/matches/open']) }); await this.refresh(); guard();
  }
  async logout(id = this.state.account?.id) {
    const guard = this.capture(); const accounts = this.state.accounts.filter(a => a.id !== id); await saveAccounts(accounts).catch(() => { guard(); this.patch({ storageError: 'Device storage could not be updated. This session was logged out; saved credentials may remain on this device.' }); }); guard(); this.patch({ accounts });
    if (id !== this.state.account?.id) return;
    if (accounts.length) return this.switchAccount(accounts[0].id);
    const transition = ++this.generation; ++this.selection; this.refreshPromise = null; this.syncPromise = null; this.observations.clear();
    await storage.removeItem(CURRENT_KEY).catch(() => {}); if (transition !== this.generation) throw new Error('Account changed; refresh to continue.'); const { ready, baseUrl, authConfig, locale } = this.state;
    this.data = emptyAccountData(); this.patch({ ...initial(), ready, baseUrl, authConfig, locale, network: !this.localOnly && isOnline() }); await this.reloadData(); await this.refresh();
  }
  private async attribution(): Promise<any> {if(this.bootstrapPromise&&!this.state.ready)await this.bootstrapPromise;return newAccountAttribution(this.state.accounts);}
  async guest(name: string) { const guard = this.capture(); const attribution = await this.attribution(); guard(); const result = await this.api.request('POST', '/users', { display_name: name.trim() || 'Player', locale: getLocale(), ...attribution }); guard(); await this.saveLogin(result); }
  async requestCode(method: 'email' | 'phone', value: string, delivery = 'sms') { return this.api.request('POST', `/auth/${method}/start`, method === 'email' ? { email: value } : { phone_number: value, delivery_method: delivery }); }
  async verifyCode(method: 'email' | 'phone', verificationId: string, code: string, name?: string, link = false) { const guard = this.capture(); const account = this.state.account; const attribution = await this.attribution(); guard(); const result = await this.api.request('POST', `/auth/${method}/verify`, { verification_id: verificationId, code, ...(name ? { display_name: name } : {}), ...attribution }, link ? account : null); guard(); await this.saveLogin(result); }
  async google(idToken: string, link = false) { const guard = this.capture(); const account = this.state.account; const attribution = await this.attribution(); guard(); const result = await this.api.request('POST', '/auth/google', { id_token: idToken, ...attribution }, link ? account : null); guard(); await this.saveLogin(result); }
  async browserLogin(link = false) {
    if (this.localOnly) throw new Error('This test launch runs entirely on this device.');
    const guard = this.capture(); const previous = this.state.account;
    let response = await this.loginBrowser(this.state.baseUrl); guard();
    const id = response.user_id || response.id;
    if (!id || typeof response.password !== 'string' || !response.password) throw new Error('Invalid browser account response');
    if (link && previous && previous.id !== id) {
      // The browser handoff proves the newly verified account. Explicit linking
      // also proves the original guest through headers; no credential enters a URL.
      await this.api.request('POST', `/users/${encodeURIComponent(previous.id)}/merge`, { into_user_id: id, into_password: response.password }, previous); guard();
      // The backend chooses the stronger login as survivor. Either input's
      // credentials remain an alias; ask for the canonical account before saving.
      response = await this.api.request('GET', '/auth/me', undefined, { ...response, id }); guard();
      await this.saveLogin(response, [previous.id, id]);
    } else await this.saveLogin(response);
  }
  async updateProfile(patch: any) { const guard = this.capture(); const account = this.state.account; if (!account) throw new Error('Log in first'); const profile = await this.request('PATCH', `/users/${encodeURIComponent(account.id)}`, patch); const accounts = this.state.accounts.map(a => a.id === account.id ? { ...a, ...profile } : a); await saveAccounts(accounts); guard(); this.patch({ account: accounts.find(a => a.id === account.id)!, accounts, profile }); }
  private async refreshProfile() { const account = this.state.account; if (!account) return; const guard = this.capture(); const profile = await this.read(`/users/${encodeURIComponent(account.id)}`); guard(); this.patch({ profile }); }
  async createMatch(options: any) { const match = await this.request('POST', '/matches', options); await this.cache(`/matches/${match.id}`, match); await this.selectMatch(match.id); return match; }
  async quickMatch(gameId = '', numPlayers?: number) { const match = await this.request('POST', '/matchmaking/quick-match', { game_id: gameId, ...(numPlayers ? { num_players: numPlayers } : {}) }); await this.cache(`/matches/${match.id}`, match); await this.selectMatch(match.id); return match; }
  async matchAction(action: string, body?: any) { const match = this.state.selectedMatch; if (!match) throw new Error('Choose a match first'); const token = this.selection; const result = await this.request('POST', `/matches/${encodeURIComponent(match.id)}/${action}`, body); if (result?.id) { await this.cache(`/matches/${result.id}`, result); if (token === this.selection) this.patch({ selectedMatch: this.decorate(result) }); } await this.refreshProfile().catch(() => {}); return result; }
  async addBots(count: number) { const match = this.state.selectedMatch; if (!match) return; const token = this.selection; const result = await this.request('PATCH', `/matches/${encodeURIComponent(match.id)}`, { num_computer_opponents: count }); await this.cache(`/matches/${result.id}`, result); if (token === this.selection) this.patch({ selectedMatch: this.decorate(result) }); }
  async removePlayer(userId: string) { const match = this.state.selectedMatch; if (!match) return; const token = this.selection; const result = await this.request('DELETE', `/matches/${encodeURIComponent(match.id)}/players/${encodeURIComponent(userId)}`); await this.cache(`/matches/${result.id}`, result); if (token === this.selection) this.patch({ selectedMatch: this.decorate(result) }); }
  async archiveMatch(id: string, deleted = false) {
    const guard = this.capture(), owner = this.identity(), token = this.selection;
    await this.repository.mutate(owner, data => {
      guard();
      if (!deleted && !data.local[id] && (data.queues[id]?.length || data.conflicts[id] || this.data.conflicts[id])) throw new Error(copyText('Sync or resolve pending actions before hiding this match.'));
      data.archivedMatches.push({ id, match: data.local[id] || data.responses[`/matches/${id}`], moves: data.queues[id] || [], savedAt: new Date().toISOString() });
      delete data.local[id]; delete data.queues[id]; delete data.conflicts[id]; delete data.responses[`/matches/${id}`];
      if (data.selectedId === id) data.selectedId = null;
    });
    guard(); if (token === this.selection && this.state.selectedMatch?.id === id) this.clearMatch();
    await this.reloadData(); guard(); this.patch({ myMatches: this.state.myMatches.filter(m => m.id !== id) });
  }
  async deleteMatch() { const match = this.state.selectedMatch; if (!match) return; if (!this.data.local[match.id]) await this.request('DELETE', `/matches/${encodeURIComponent(match.id)}`); await this.archiveMatch(match.id, true); }
  private async sync(freshRequestId?: string, matchId?: string) {
    if (this.localOnly || !this.state.account || !isOnline() || (!freshRequestId && Date.now() < this.retryAfter)) return;
    if (this.syncPromise) return this.syncPromise;
    const account = this.state.account; const guard = this.capture();
    const pending = syncAccount(this.api, this.repository, account, { paginated: this.paginated, guard, freshRequestId, matchId }).then(async data => { guard(); const previous = this.state.selectedMatch; this.patch({ network: true }); this.publishData(data); const selected = this.state.selectedMatch; if (selected && selected.move_count !== previous?.move_count) { await this.recoverPresentation(selected, previous || undefined).catch(() => {}); guard(); await this.refreshProfile().catch(() => {}); } }).catch(error => { guard(); if (!(error instanceof ApiError)) { this.retryAfter = Date.now() + 10000; this.patch({ network: false }); } throw error; }).finally(() => { if (this.syncPromise === pending) this.syncPromise = null; }); this.syncPromise = pending; return pending;
  }
  async submitMove(move: any) {
    const match = this.state.selectedMatch; if (!match) return;
    if (this.data.local[match.id]) return this.practiceMove(move);
    const account = this.state.account; if (!account) throw new Error('Log in first');
    if (this.state.replayIndex !== null) throw new Error('Return to the live match before moving');
    const seat = match.players.find(p => p.user_id === account.id && p.active !== false);
    if (!seat || match.status !== 'ongoing' || !match.turn_of_player_indices?.includes(seat.player_index)) throw new Error('It is not your turn');
    const guard = this.capture(); const entry = { requestId: requestId(), body: { move, expected_move_count: match.move_count }, baseState: match.state, baseTurn: match.turn_of_player_indices, savedAt: new Date().toISOString() };
    try { await this.repository.mutate(account.id, data => { if (data.queues[match.id]?.length || data.conflicts[match.id]) throw new Error('Wait for the pending action to sync or resolve its conflict'); const saved = data.responses[`/matches/${match.id}`]; if (saved && saved.move_count !== match.move_count) throw new Error('The match changed in another window; refresh before moving'); data.responses[`/matches/${match.id}`] = match; data.queues[match.id] = [entry]; }); }
    catch (error) {
      guard();
      if (!isOnline() || this.data.queues[match.id]?.length || this.data.conflicts[match.id] || !/quota|storage|disk|denied|unavailable/i.test(`${(error as Error).name} ${(error as Error).message}`) || /pending action|another window/.test((error as Error).message)) throw error;
      // Storage-denied browsers may still play online. This is one fresh POST;
      // uncertainty freezes play until a subsequent authoritative GET.
      this.patch({ storageError: 'Device storage unavailable; this online action cannot be queued for offline retry.' });
      try { const updated = await this.api.request<Match>('POST', `/matches/${encodeURIComponent(match.id)}/moves`, entry.body, account, entry.requestId); guard(); await this.cache(`/matches/${match.id}`, updated); this.patch({ selectedMatch: this.decorate(updated) }); await this.refreshProfile().catch(() => {}); return; }
      catch (requestError) { guard(); this.data.conflicts[match.id] = { message: 'The outcome of this unsaved action is unknown. Refresh the match before trying again.' }; this.patch({ selectedMatch: this.decorate(match) }); throw requestError; }
    }
    guard(); await this.reloadData();
    // A fresh online post needs no preliminary GET. Any retry reconciles history.
    try { await this.sync(entry.requestId, match.id); } catch (error) { if (error instanceof ApiError && error.status !== 409) throw error; this.patch({ error: 'Action saved on this device. It will sync after reconnecting.' }); }
  }
  async resolveConflict(id: string) { const remote = await this.request('GET', `/matches/${encodeURIComponent(id)}`); await this.repository.mutate(this.identity(), data => { data.archives.push({ id, moves: data.queues[id] || [], conflict: data.conflicts[id], savedAt: new Date().toISOString() }); delete data.queues[id]; delete data.conflicts[id]; data.responses[`/matches/${id}`] = remote; }); await this.reloadData(); }
  private async callGame(game: Game, name: string, args: any[], match: LocalMatch): Promise<any> { if (!game.server_code) throw new Error('Download the game rules before playing locally'); return this.rulesExecutor({ server_code: game.server_code, game_schemas: game.game_schemas }, name, args, { players: match.players.map(p => ({ id: p.id, kind: p.kind, active: p.active !== false, display_name: p.name || `Player ${p.player_index + 1}`, picture_url: '', max_loss: 0 })), pot: 0, move_count: match.move_count }, (match.practiceSeed + match.move_count) >>> 0, Date.parse(match.created_at)); }
  private async practiceResult(game: Game, match: LocalMatch, result: any, record = true, actor: number | null = null) {
    const ids = match.players.map(p => p.id);
    if (!result || !Object.hasOwn(result, 'state') || !(result.turn === null || Array.isArray(result.turn) && result.turn.length && new Set(result.turn).size === result.turn.length && result.turn.every((id: string) => ids.includes(id)))) throw new Error('Local game returned an invalid state or turn');
    match.logicState = result.state; match.turn_of_player_indices = result.turn === null ? null : result.turn.map((id: string) => ids.indexOf(id)); match.status = result.turn === null ? 'over' : 'ongoing'; match.end_reason = result.turn === null ? 'finished' : null;
    if (record) { match.move_count++; match.last_move_player_index = actor; }
    const seat = match.localMode === 'pass' ? match.turn_of_player_indices?.find(i => match.players[i].kind === 'human') ?? 0 : 0;
    match.state = await this.callGame(game, 'viewFor', [match.logicState, ids[seat]], match);
    if (record) match.moves = [...(match.moves || []), { move_number: match.move_count, player_index: actor, new_state: match.state, next_turn_player_indices: match.turn_of_player_indices }];
  }
  private async practiceComputers(game: Game, match: LocalMatch) {
    for (let count = 0; match.status === 'ongoing'; count++) {
      const computer = match.turn_of_player_indices?.map(i => match.players[i]).find(p => p.kind === 'computer'); if (!computer) return;
      if (count >= 200) throw new Error('Local game exceeded the computer move limit. The last saved board is unchanged.');
      const move = await this.callGame(game, 'computerMove', [match.logicState, computer.id], match);
      await this.practiceResult(game, match, await this.callGame(game, 'applyMove', [match.logicState, computer.id, move], match), true, computer.player_index);
    }
  }
  async startPractice(gameId: string, options: { humans?: number; computers?: number; names?: string[] } = {}) {
    const guard = this.capture(); const game = await this.pinnedGame(gameId); const total = (options.humans ?? 1) + (options.computers ?? 1);
    if (!game.allowed_player_counts.includes(total)) throw new Error(`This game supports ${game.allowed_player_counts.join(', ')} players`);
    const humans = options.humans ?? 1; if (humans < 1) throw new Error('Local play needs at least one human');
    const id = `local-${requestId()}`; const owner = this.identity();
    const match = { id, game_id: game.id, game_version: game.version, owner_user_id: owner, players: Array.from({ length: total }, (_, i) => ({ player_index: i, id: `local-player-${i}`, kind: i < humans ? 'human' : 'computer', user_id: i === 0 ? owner : null, active: true, name: options.names?.[i] || (i === 0 ? this.state.account?.display_name || 'Player 1' : i < humans ? `Player ${i + 1}` : `Computer ${i + 1}`) })), status: 'ongoing', state: null, logicState: null, turn_of_player_indices: [0], move_count: 0, created_at: new Date().toISOString(), localMode: humans > 1 ? 'pass' : 'computer', practiceSeed: Math.floor(Math.random() * 4294967296), moves: [], initialState: null, initialTurn: [0], token_pot: 0, bet_per_player: 0 } as LocalMatch;
    await this.practiceResult(game, match, await this.callGame(game, 'newMatch', [], match), false); match.initialState = match.state; match.initialTurn = match.turn_of_player_indices; await this.practiceComputers(game, match); guard();
    await this.repository.mutate(owner, data => { data.local[id] = match; data.responses[`/games/${game.id}/versions/${game.version}`] = game; data.selectedId = id; }); guard(); await this.reloadData(); ++this.selection; this.patch({ selectedMatch: match, game, selectedGameId: game.id, history: null, replayIndex: null });
    if (!this.localOnly && this.state.account && isOnline()) void this.request('POST', `/users/me/recent-games/${encodeURIComponent(game.id)}`).then(recentGames => this.patch({ recentGames })).catch(() => {}); return match;
  }
  async practiceMove(move: any) {
    const selected = this.state.selectedMatch as LocalMatch; if (!selected || !this.data.local[selected.id]) throw new Error('Choose a local match first');
    if (this.state.replayIndex !== null || selected.awaitingHandoff) throw new Error('Return to the live board and confirm the next player is ready');
    const guard = this.capture(); const owner = this.identity();
    await this.repository.lock(owner, async () => {
      const data = await this.repository.read(owner); const original = data.local[selected.id];
      if (!original || original.move_count !== selected.move_count || original.status !== 'ongoing' || original.awaitingHandoff) throw new Error('Local match changed. Refresh before moving.');
      const next: LocalMatch = JSON.parse(JSON.stringify(original)); const game = data.responses[`/games/${next.game_id}/versions/${next.game_version}`]; if (!game?.server_code) throw new Error('Download this game once before playing offline');
      const actor = next.localMode === 'pass' ? next.turn_of_player_indices?.find(i => next.players[i].kind === 'human') : 0;
      if (actor === undefined || !next.turn_of_player_indices?.includes(actor)) throw new Error('It is not your turn');
      await this.practiceResult(game, next, await this.callGame(game, 'applyMove', [next.logicState, next.players[actor].id, move], next), true, actor); await this.practiceComputers(game, next); guard();
      if (next.localMode === 'pass' && next.status === 'ongoing' && next.turn_of_player_indices?.[0] !== actor) next.awaitingHandoff = true;
      data.local[next.id] = next; await this.repository.write(owner, data); guard(); this.publishData(data);
    });
  }
  async revealLocal() { const id = this.state.selectedMatch?.id; if (!id) return; await this.repository.mutate(this.identity(), data => { if (data.local[id]) data.local[id].awaitingHandoff = false; }); await this.reloadData(); }
  async loadHistory() {
    const match = this.state.selectedMatch; if (!match) return;
    const guard = this.capture(); const token = this.selection; const replayToken = this.replaySelection;
    const local = this.data.local[match.id]; let history: any;
    if (local) history = { initial_state: local.initialState, initial_turn_player_indices: local.initialTurn, moves: local.moves, total: local.move_count };
    else if (this.paginated) {
      const result = await this.read(`/v2/matches/${encodeURIComponent(match.id)}/history?start=0&limit=100`); history = { ...result, moves: result.items, nextStart: result.next_start };
    } else history = await this.read(`/matches/${encodeURIComponent(match.id)}/history`);
    guard(); if (token === this.selection && replayToken === this.replaySelection) this.patch({ history }); return history;
  }
  async replay(index: number | null) {
    const replayToken = ++this.replaySelection; const match = this.state.selectedMatch; if (!match) return; if (index === null) { this.patch({ replayIndex: null }); return; }
    if (this.data.local[match.id]?.awaitingHandoff) throw new Error(copyText('Confirm the next player is ready before viewing history.'));
    const guard = this.capture(); const token = this.selection; let wanted = Math.max(0, Math.min(match.move_count, index));
    let history = this.state.history;
    if (this.paginated && !this.data.local[match.id]) {
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
  presentationMessage(): any {
    const match = this.state.selectedMatch; if (!match) return null;
    const replay = this.state.replayIndex; const history = this.state.history; let view = match; let replayActor: number | null = null;
    if (replay !== null && history) { const move = replay === 0 ? { new_state: history.initial_state, next_turn_player_indices: history.initial_turn_player_indices } : history.moves?.[replay - 1 - (history.offset || 0)]; if (move) { view = { ...match, state: move.new_state, turn_of_player_indices: move.next_turn_player_indices, move_count: replay, status: move.next_turn_player_indices === null ? 'over' : 'ongoing' }; replayActor = Number.isInteger(move.player_index) ? move.player_index : null; } }
    const local = this.data.local[match.id]; const seat = local?.localMode === 'pass' ? match.turn_of_player_indices?.find(i => match.players[i].kind === 'human') ?? 0 : match.players.find(p => p.user_id === this.state.account?.id && p.active !== false)?.player_index ?? (local ? 0 : null);
    const allowed = replay === null && !match.pending && !match.conflict && !local?.awaitingHandoff && view.status === 'ongoing' && seat !== null && view.turn_of_player_indices?.includes(seat);
    const texts = this.state.game ? gameTexts(this.state.game) : null;
    return { type: 'state_changed', state: view.state ?? null, view: view.state ?? null, players: match.players.map(p => ({ player_index: p.player_index, player_id: p.id, kind: p.kind, name: p.name || (p.user_id ? this.state.profiles[p.user_id]?.display_name || (p.user_id === this.state.account?.id ? this.state.account.display_name : `Player ${p.player_index + 1}`) : `Computer ${p.player_index + 1}`), picture_url: p.user_id ? this.state.profiles[p.user_id]?.picture_url || '' : '' })), turn_of_player_indices: view.turn_of_player_indices, turn_of_player_index: view.turn_of_player_indices?.[0] ?? null, my_player_index: seat, acting_for_player_index: allowed ? seat : null, status: view.status, end_reason: view.end_reason, move_count: view.move_count, last_move_player_index: replay === null ? match.last_move_player_index ?? null : replayActor, token_pot: view.token_pot || 0, replay: replay === null ? null : { index: replay, total: match.move_count }, presentation_history: replay === null ? this.observations.get(match.id) || [] : [], locale: getLocale(), direction: getDirection(), strings: texts?.strings || this.state.game?.declarative_ui?.strings || {} };
  }
  actions = {
    bootstrap: (baseUrl?: string, localOnly = false,initialUrl?:string) => this.bootstrap(baseUrl, localOnly,initialUrl), refresh: () => this.refresh(), refreshMatch: () => this.refreshMatch(),
    rememberAttribution:(url:string)=>rememberUrlAttribution(url,this.state.baseUrl,this.state.accounts),
    request: (method: string, path: string, body?: any) => this.perform(() => this.request(method, path, body), false),
    searchGames: (query: string) => this.perform(async () => { this.patch({ query, games: [], cursors: { ...this.state.cursors, games: null } }); await this.list('games'); }),
    loadMore: (kind: ListKind) => this.perform(() => this.list(kind, true)),
    selectGame: (id: string) => this.perform(() => this.selectGame(id)), selectMatch: (id: string) => this.perform(() => this.selectMatch(id)), clearMatch: () => this.clearMatch(), clearGame: () => this.clearGame(), importLogin: (response: any) => this.perform(() => this.saveLogin(response)),
    guest: (name: string) => this.perform(() => this.guest(name)), requestCode: (method: 'email' | 'phone', value: string, delivery?: string) => this.perform(() => this.requestCode(method, value, delivery)),
    browserLogin: (link = false) => this.perform(() => this.browserLogin(link)),
    verifyCode: (method: 'email' | 'phone', id: string, code: string, name?: string, link?: boolean) => this.perform(() => this.verifyCode(method, id, code, name, link)), google: (token: string, link?: boolean) => this.perform(() => this.google(token, link)),
    switchAccount: (id: string) => this.perform(() => this.switchAccount(id)), logout: (id?: string) => this.perform(() => this.logout(id)), updateProfile: (patch: any) => this.perform(() => this.updateProfile(patch)),
    createMatch: (options: any) => this.perform(() => this.createMatch(options)), quickMatch: (gameId?: string, count?: number) => this.perform(() => this.quickMatch(gameId, count)),
    matchAction: (action: 'join' | 'start' | 'leave' | 'rematch' | 'maybeLeave' | 'playerLeft', body?: any) => this.perform(() => this.matchAction(action, body)), addBots: (count: number) => this.perform(() => this.addBots(count)), removePlayer: (id: string) => this.perform(() => this.removePlayer(id)),
    deleteMatch: () => this.perform(() => this.deleteMatch()), archiveMatch: (id: string) => this.perform(() => this.archiveMatch(id)), submitMove: (move: any) => this.perform(() => this.submitMove(move), false), resolveConflict: (id: string) => this.perform(() => this.resolveConflict(id)),
    startPractice: (id: string, options?: { humans?: number; computers?: number; names?: string[] }) => this.perform(() => this.startPractice(id, options)), practiceMove: (move: any) => this.perform(() => this.practiceMove(move), false), revealLocal: () => this.perform(() => this.revealLocal()), deleteLocal: (id: string) => this.perform(() => this.archiveMatch(id)),
    loadHistory: () => this.perform(() => this.loadHistory()), replay: (index: number | null) => this.perform(() => this.replay(index), false), presentationMessage: () => this.presentationMessage(),
    saveGame: (id: string, saved: boolean) => this.perform(async () => { await this.request(saved ? 'PUT' : 'DELETE', `${this.paginated ? '/v2' : ''}/users/me/saved-games/${encodeURIComponent(id)}`); await this.list('savedGames'); }),
    createInvite: (options: any = {}) => this.perform(async () => { const id = this.state.selectedMatch?.id; if (!id) throw new Error('Choose a match first'); return this.request('POST', `/matches/${encodeURIComponent(id)}/invites`, options); }),
    acceptInvite: (token: string) => this.perform(async () => { const result = await this.request('POST', `/invites/${encodeURIComponent(token)}/accept`); await this.selectMatch(result.id); return result; }),
    revokeInvite: (token: string) => this.perform(async () => { const result = await this.request('POST', `/invites/${encodeURIComponent(token)}/revoke`); await this.list('invites'); return result; }),
    setLocale: (locale: string) => this.perform(async () => { if (!await setLocale(locale)) return; this.patch({ locale }); if (this.state.account) await this.updateProfile({ locale }); }),
    clearError: () => this.patch({ error: null }),
  };
}
export const portal = new PortalStore();
export function usePortal() { const state = useSyncExternalStore(portal.subscribe, portal.getSnapshot, portal.getSnapshot); return { ...state, actions: portal.actions }; }
