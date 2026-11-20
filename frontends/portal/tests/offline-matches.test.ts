import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import type {Account, Game, Match} from '../src/core/types';
import {matchGameName} from '../src/ui/match-game';
import {setLocale} from '../src/platform/i18n';

const base = 'https://offline-matches.test';
const account = (id: string): Account => ({id, password: `${id}-synthetic-secret`, display_name: id, is_verified: false});
const game = (id: string, version = 7): Game => ({id, version, name: id === 'backgammon' ? 'Backgammon' : `Game ${id}`,
  description: 'Synthetic offline game', allowed_player_counts: [2], all_state_public: true,
  server_code: 'const game={applyMove(s){return {state:s,turn:null};}};',
  declarative_ui: {format: 'buildplay-ui', version: 1, ui_code: 'const gameUI={reduce(){return {scene:{}};}};'}});
const match = (id: string, status = 'ongoing', ownTurn = true, owner = 'alice'): Match => ({id, game_id: id === 'mine' ? 'backgammon' : `game-${id}`, game_version: 7,
  owner_user_id: owner, status, players: [{id: `${owner}-seat`, player_index: 0, kind: 'human', user_id: owner},
    {id: 'opponent-seat', player_index: 1, kind: 'human', user_id: 'opponent'}],
  turn_of_player_indices: status === 'ongoing' ? [ownTurn ? 0 : 1] : null, move_count: id === 'mine' ? 2 : 0,
  created_at: '2026-11-01T00:00:00Z', state: {board: [-1, 0, -1], turn: ownTurn ? 0 : 1}});
const summary = ({state: _state, ...value}: Match) => value;
type RequestRecord = {url: URL; accountId: string | undefined; method: string};
type FixtureOptions = {
  accounts?: Account[];
  matches: Record<string, Match[]>;
  page?: (url: URL, accountId: string) => {items: unknown[]; next_cursor: string | null} | undefined;
  respond?: (request: RequestRecord) => Promise<unknown> | unknown;
};

function fixture(options: FixtureOptions) {
  const accounts = options.accounts || [account('alice')], values: Record<string, string> = {};
  Object.defineProperties(values, {getItem: {value: (key: string) => values[key] ?? null},
    setItem: {value: (key: string, value: string) => {values[key] = String(value);}},
    removeItem: {value: (key: string) => {delete values[key];}}});
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch, network = {onLine: true};
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: values});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: network});
  values['game-platform.accounts.v1'] = JSON.stringify(accounts);
  values['game-platform.current-account.v1'] = accounts[0].id;
  const requests: RequestRecord[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    assert.equal(network.onLine, true, 'offline restoration must use saved data without fetch');
    const url = new URL(String(input)), accountId = (init.headers as Record<string, string>)?.['X-User-Id'];
    const request = {url, accountId, method: init.method || 'GET'}; requests.push(request);
    let value = await options.respond?.(request);
    const ownMatches = options.matches[accountId || ''] || [];
    if (value === undefined) {
      if (url.pathname === '/storage/capabilities') value = {pagination: true};
      else if (url.pathname === '/i18n/locales') value = {locales: [{code: 'en', direction: 'ltr'}]};
      else if (url.pathname.startsWith('/i18n/bundle/')) value = {catalog: {messages: {}}};
      else if (url.pathname === '/auth/config') value = {};
      else if (url.pathname === '/users/me/notifications') value = {items: [], next_cursor: null, unread_count: 0};
      else if (url.pathname === '/v2/matches') {
        value = options.page?.(url, accountId || '') || {items: ownMatches.filter(item => !url.searchParams.has('status') || item.status === url.searchParams.get('status')).map(summary), next_cursor: null};
      } else if (url.pathname === '/v2/games') value = {items: [game('unrelated-catalog')], next_cursor: 'more-catalog'};
      else if (url.pathname === '/v2/users/me/saved-games') value = {items: [], next_cursor: null};
      else if (/^\/matches\/[^/]+$/.test(url.pathname)) value = ownMatches.find(item => item.id === decodeURIComponent(url.pathname.slice('/matches/'.length)));
      else if (/^\/games\/[^/]+\/versions\/\d+$/.test(url.pathname)) {
        const parts = url.pathname.split('/'); value = game(decodeURIComponent(parts[2]), Number(parts[4]));
      } else if (url.pathname.endsWith('/history')) value = {items: [{move_number: 1, player_index: 1, new_state: {board: [-1, -1, -1]}},
        {move_number: 2, player_index: 0, new_state: {board: [-1, 0, -1]}}], total: 2, next_start: null};
      else if (url.pathname === '/users') value = (url.searchParams.get('ids') || '').split(',').filter(Boolean).map(id => ({id, display_name: `Player ${id}`, is_verified: false}));
      else if (url.pathname === `/users/${accountId}`) value = {id: accountId, display_name: accountId, is_verified: false};
      else value = [];
    }
    return value instanceof Response ? value : new Response(JSON.stringify(value), {status: 200});
  }) as typeof fetch;
  return {store: new PortalStore(), values, requests, network, repo: new AccountRepository(base), restore() {
    globalThis.fetch = originalFetch;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  }};
}

const downloaded = (store: PortalStore) => (store as any).offlineDownloadPromise as Promise<void> | null;

test('all pages download in turn priority and a never-opened match restores and queues a move offline', async () => {
  const mine = match('mine'), other = match('other', 'ongoing', false), waiting = match('waiting', 'waiting_for_players'), finished = match('finished', 'over');
  const f = fixture({matches: {alice: [finished, other, waiting, mine]}, page: url => {
    if (!url.searchParams.has('status')) return {items: [summary(finished)], next_cursor: 'unloaded-matches'};
    if (url.searchParams.get('status') !== 'ongoing') return undefined;
    switch (url.searchParams.get('cursor')) {
      case null: return {items: [summary(other)], next_cursor: 'empty-page'};
      case 'empty-page': return {items: [], next_cursor: 'your-turn-page'};
      case 'your-turn-page': return {items: [summary(mine)], next_cursor: null};
      default: throw new Error('Unexpected cursor');
    }
  }});
  try {
    await f.store.bootstrap(base); await downloaded(f.store);
    assert.deepEqual(f.requests.filter(item => /^\/matches\/[^/]+$/.test(item.url.pathname)).map(item => item.url.pathname),
      ['/matches/mine', '/matches/other', '/matches/waiting', '/matches/finished']);
    assert.ok(f.requests.some(item => item.url.searchParams.get('cursor') === 'empty-page'));
    assert.ok(f.requests.some(item => item.url.searchParams.get('cursor') === 'your-turn-page'));
    assert.equal(f.store.getSnapshot().selectedMatch, null, 'background downloads must not open a match');
    assert.equal(f.store.getSnapshot().cursors.myMatches, null);
    assert.deepEqual(f.store.getSnapshot().myMatches.map(item => item.id), ['mine', 'other', 'waiting', 'finished']);
    const saved = await f.repo.read('alice');
    assert.deepEqual(saved.responses['/games/backgammon/versions/7'], game('backgammon'));
    assert.deepEqual(saved.responses['/matches/mine'].state, mine.state);
    assert.equal(saved.responses['/v2/matches/mine/history?start=0&limit=2'].items.length, 2);
    assert.equal(saved.responses['/users/opponent'].display_name, 'Player opponent');
    assert.equal(matchGameName(mine, f.store.getSnapshot()), 'Backgammon');
    assert.ok(!f.store.getSnapshot().games.some(item => item.id === mine.game_id));
    await f.store.actions.refresh(); await downloaded(f.store);
    assert.deepEqual(f.store.getSnapshot().myMatches.map(item => item.id), ['mine', 'other', 'waiting', 'finished'],
      'an ordinary first-page poll must retain the fully downloaded personal index');

    f.network.onLine = false;
    const offline = new PortalStore(); await offline.bootstrap(base, true);
    assert.equal(offline.getSnapshot().myMatches.length, 4);
    assert.equal(matchGameName(mine, offline.getSnapshot()), 'Backgammon');
    await offline.actions.selectMatch(mine.id);
    assert.deepEqual(offline.getSnapshot().selectedMatch!.state, mine.state);
    assert.equal(offline.getSnapshot().game!.version, 7);
    await offline.actions.submitMove({cell: 2});
    const queued = await f.repo.read('alice');
    assert.deepEqual(queued.queues.mine[0].body, {move: {cell: 2}, expected_move_count: 2});
    assert.deepEqual(queued.queues.mine[0].baseState, mine.state);
    assert.deepEqual(queued.responses['/games/backgammon/versions/7'], game('backgammon'));
  } finally {await downloaded(f.store); f.restore();}
});

test('a downloaded latest game detail can still open after going offline', async () => {
  const savedGame = game('downloaded-detail');
  const f = fixture({matches:{alice:[]},respond:({url})=>url.pathname==='/games/downloaded-detail'?savedGame:undefined});
  try {
    await f.store.bootstrap(base);await downloaded(f.store);
    await f.store.actions.selectGame(savedGame.id);
    f.network.onLine=false;
    await f.store.actions.selectGame(savedGame.id);
    assert.equal(f.store.getSnapshot().game!.name,savedGame.name);
    assert.equal(f.store.getSnapshot().game!.version,savedGame.version);
    assert.equal(f.store.getSnapshot().network,false);
  } finally {await downloaded(f.store);f.restore();}
});

test('one unavailable game does not block the remaining downloads or the portal', async () => {
  const broken = match('broken'), usable = match('usable');
  const f = fixture({matches: {alice: [broken, usable]}, respond: ({url}) => url.pathname === '/games/game-broken/versions/7'
    ? new Response(JSON.stringify({detail: 'Unavailable game'}), {status: 404}) : undefined});
  try {
    await f.store.bootstrap(base); await downloaded(f.store);
    const saved = await f.repo.read('alice');
    assert.equal(saved.responses['/games/game-broken/versions/7'], undefined);
    assert.deepEqual(saved.responses['/games/game-usable/versions/7'], game('game-usable'));
    assert.equal(f.store.getSnapshot().error, null);
    assert.equal(f.store.getSnapshot().network, true);
    assert.equal(f.store.getSnapshot().myMatches.length, 2);
  } finally {await downloaded(f.store); f.restore();}
});

for (const kind of ['incomplete', 'wrong-version'] as const) test(`${kind} cached packages can be repaired by a later background retry`, async () => {
  const own = match('retry'); let attempts = 0;
  const invalid = kind === 'incomplete' ? {...game('game-retry'), server_code: ''} : game('game-retry', 8);
  const f = fixture({matches: {alice: [own]}, respond: ({url}) => url.pathname === '/games/game-retry/versions/7' && ++attempts === 1
    ? invalid : undefined});
  try {
    await f.repo.cache('alice', '/games/game-retry/versions/7', invalid);
    await f.store.bootstrap(base); await downloaded(f.store);
    (f.store as any).offlineDownloadAfter = 0;
    await f.store.actions.refresh(); await downloaded(f.store);
    assert.equal(attempts, 2);
    assert.deepEqual((await f.repo.read('alice')).responses['/games/game-retry/versions/7'], game('game-retry'));
  } finally {await downloaded(f.store); f.restore();}
});

test('downloaded match names follow locale changes even after the full package is evicted', async () => {
  const own = match('mine');
  const f = fixture({matches: {alice: [own]}, respond: ({url}) => url.pathname === '/games/backgammon/versions/7'
    ? {...game('backgammon'), translations: {fr: {name: 'Backgammon français'}}} : undefined});
  try {
    await f.store.bootstrap(base); await downloaded(f.store);
    await f.repo.mutate('alice', data => {delete data.responses['/games/backgammon/versions/7'];});
    await (f.store as any).reloadData();
    assert.equal(matchGameName(own, f.store.getSnapshot()), 'Backgammon');
    await setLocale('fr');
    assert.equal(matchGameName(own, f.store.getSnapshot()), 'Backgammon français');
    await setLocale('en');
    assert.equal(matchGameName(own, f.store.getSnapshot()), 'Backgammon');
  } finally {await downloaded(f.store); await setLocale('en'); f.restore();}
});

test('switching accounts cancels a delayed background download before it can publish or cache data', async () => {
  let release!: () => void, began!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {began = resolve;});
  const aliceMatch = match('alice-delayed'), bobMatch = match('bob-match', 'ongoing', true, 'bob');
  const f = fixture({accounts: [account('alice'), account('bob')], matches: {alice: [aliceMatch], bob: [bobMatch]},
    respond: async ({url, accountId}) => {
      if (url.pathname === '/matches/alice-delayed' && accountId === 'alice') {began(); await held; return aliceMatch;}
    }});
  let previous: Promise<void> | null = null;
  try {
    await f.store.bootstrap(base); previous = downloaded(f.store); await started;
    await f.store.actions.switchAccount('bob'); await downloaded(f.store);
    release(); await previous;
    assert.equal(f.store.getSnapshot().account!.id, 'bob');
    assert.deepEqual(f.store.getSnapshot().myMatches.map(item => item.id), [bobMatch.id]);
    const bob = await f.repo.read('bob'), alice = await f.repo.read('alice');
    assert.equal(bob.responses['/matches/alice-delayed'], undefined);
    assert.equal(alice.responses['/matches/alice-delayed'], undefined);
    assert.equal(bob.responses['/portal/match-games']?.['game-alice-delayed@7'], undefined);
    assert.ok(bob.responses['/games/game-bob-match/versions/7']);
    assert.ok(!f.requests.some(item => item.url.pathname === '/games/game-alice-delayed/versions/7'));
    assert.equal(f.store.getSnapshot().error, null);
  } finally {release(); await previous; await downloaded(f.store); f.restore();}
});
