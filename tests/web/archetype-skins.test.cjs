// Archetype skins (cd3464): Focus, Showcase, Lobby, Library.
// Guards: the four keys exist and are discoverable, the old skins' anchor
// values are untouched, and the default-screen / match-focus behaviour
// works for the archetypes without changing other skins.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../static/experiments.css'), 'utf8');
const experimentsJs = fs.readFileSync(path.join(__dirname, '../../static/experiments.js'), 'utf8');
const portalJs = fs.readFileSync(path.join(__dirname, '../../static/portal.js'), 'utf8');
const portalHtml = fs.readFileSync(path.join(__dirname, '../../static/portal.html'), 'utf8');
const portalSw = fs.readFileSync(path.join(__dirname, '../../static/portal-sw.js'), 'utf8');
const NEW_SKINS = ['focus', 'showcase', 'lobby', 'library'];

test('each archetype skin has a :root token rule discoverable from experiments.css', () => {
  for (const key of NEW_SKINS) {
    assert.ok(css.includes(`:root[data-skin="${key}"] {`), `${key} token rule missing`);
    assert.ok(css.includes(`:root[data-skin="${key}"] .portal-shell`), `${key} portal-shell block missing`);
    assert.ok(css.includes(`:root[data-skin="${key}"] .builder-shell`), `${key} builder-shell block missing`);
  }
});

test('no existing skin accent changed (diff audit anchors)', () => {
  // Exact pre-existing strings; editing any old skin's accent fails here.
  assert.ok(css.includes('--color-accent:#4e7cff;'), 'arcade accent changed');
  assert.ok(css.includes('--color-accent: #00e5ff;'), 'neon accent changed');
  assert.ok(css.includes('--color-accent: #c6f432;'), 'immersive accent changed');
  assert.ok(css.includes('--color-accent: #1f7a3a;'), 'meadow accent changed');
  assert.ok(!css.includes('data-skin="arcade"') || css.includes(':root[data-skin="arcade"] .portal-nav'),
    'arcade nav rules still present');
});

test('experiments.js registers the four keys and the archetype flag', () => {
  for (const key of NEW_SKINS) {
    assert.match(experimentsJs, new RegExp(`"${key}"`), `${key} not in experiments.js`);
  }
  assert.match(experimentsJs, /MODERN_PORTAL_SKINS = new Set\(\["arcade", "neon", "focus", "showcase", "lobby"\]\)/);
  assert.match(experimentsJs, /GEM_PORTAL_SKINS = new Set\(\["arcade", "neon", "showcase"\]\)/);
  assert.ok(!/GEM_PORTAL_SKINS = new Set\([^)]*"focus"/.test(experimentsJs), 'focus must stay on tokens');
  assert.ok(!/GEM_PORTAL_SKINS = new Set\([^)]*"lobby"/.test(experimentsJs), 'lobby must stay on tokens');
  assert.ok(experimentsJs.includes('dataset.portalArchetype'), 'archetype flag missing');
});

test('cache-busting versions bumped for the changed assets', () => {
  assert.ok(portalHtml.includes('experiments.css?v=56'), 'portal.html experiments.css version');
  assert.ok(portalHtml.includes('experiments.js?v=16'), 'portal.html experiments.js version');
  assert.ok(portalHtml.includes('portal.js?v=115'), 'portal.html portal.js version');
  assert.ok(portalHtml.includes('portal-match-layout.js?v=9'), 'portal.html match-layout version');
  assert.ok(portalSw.includes('playroom-portal-shell-v195'), 'service worker cache version');
  assert.ok(portalSw.includes('experiments.css?v=56'), 'service worker experiments.css version');
  assert.ok(portalSw.includes('portal.js?v=115'), 'service worker portal.js version');
});

test('archetype page rules: focus/library hide discovery, lobby promotes open matches', () => {
  assert.ok(css.includes(':root[data-skin="focus"] .arcade-hero'), 'focus hides hero');
  assert.ok(css.includes(':root[data-skin="library"] .arcade-hero'), 'library hides hero');
  assert.ok(css.includes(':root[data-skin="library"] .game-library-grid'), 'library dense rows');
  assert.ok(css.includes(':root[data-skin="lobby"] .matches-screen-groups .open-matches-board'),
    'lobby promotes open board');
  assert.ok(css.includes(':root[data-skin="lobby"] .portal-nav-link[data-portal-nav="matches"] { order: -1; }'),
    'lobby nav puts Matches first');
  assert.ok(css.includes(':root[data-skin="showcase"] .leaderboard-podium'), 'showcase podium');
  assert.ok(!css.includes(':root[data-skin="library"] .portal-nav'),
    'library stays legacy: no top nav of its own');
});

// Minimal portal.js harness (same shape as portal.test.cjs) for the
// default-screen behaviour only.
function setupPortal(hash = '', archetype = '') {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {value: '', hidden: false, disabled: false, dataset: {}, children: [], options: [],
      classList: {toggle() {}}, replaceChildren(...children) { this.children = children; },
      setAttribute() {}, addEventListener() {}, focus() {}});
    return nodes.get(id);
  };
  const fakeLocation = {pathname: '/static/portal.html', hash, search: '', assign() {}};
  const ctx = vm.createContext({StoragePages: {enabled: async () => false, list: () => {}, controls() {}, search() { return false; }},
    console, Map, Set, URLSearchParams,
    navigator: {onLine: true}, localStorage: {},
    PortalOffline: class { api() {} read() { return {}; } write() {} writeCache() {} },
    document: {getElementById: node, body: {dataset: {}, classList: {toggle() {}}},
      documentElement: {dataset: archetype ? {portalArchetype: archetype} : {}},
      querySelector() { return null; }, querySelectorAll() { return []; }},
    window: {addEventListener() {}, scrollTo() {}},
    location: fakeLocation,
    history: {replaceState(s, t, url) { if (url != null) fakeLocation.hash = String(url).startsWith('#') ? String(url) : ''; },
      pushState() {}},
    Auth: {current: () => ({id: 'owner'})}, I18n: require('./i18n-stub.cjs'),
    GameFrame: class { load() {} unload() {} send() {} },
    apiRequest: async () => {}, formatTime: () => '', shortId: (x) => x,
    showPageError() {}, el: (tag, attrs = {}, ...children) => ({...attrs, children})});
  vm.runInContext(portalJs.replace(/main\(\);\s*$/, ''), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run('globalThis.originalRefresh=refresh;refresh=async()=>{};');
  return {node, run, documentElement: ctx.document.documentElement};
}

test('focus and lobby default to the Matches screen; explicit hashes still win', () => {
  for (const key of ['focus', 'lobby']) {
    const {node, run} = setupPortal('', key);
    run('syncPortalScreen()');
    assert.equal(run('document.body.dataset.portalView'), 'matches', `${key} home`);
    assert.equal(node('matches-screen').hidden, false, `${key} matches screen shown`);
  }
  const classic = setupPortal('', '');
  classic.run('syncPortalScreen()');
  assert.equal(classic.run('document.body.dataset.portalView'), 'home', 'classic home unchanged');
  const library = setupPortal('', 'library');
  library.run('syncPortalScreen()');
  assert.equal(library.run('document.body.dataset.portalView'), 'home', 'library home is the catalog');
  const focusGames = setupPortal('#games', 'focus');
  focusGames.run('syncPortalScreen()');
  assert.equal(focusGames.run('document.body.dataset.portalView'), 'games', 'focus #games wins over default');
  const focusHome = setupPortal('#home', 'focus');
  focusHome.run('syncPortalScreen()');
  assert.equal(focusHome.run('document.body.dataset.portalView'), 'home', 'focus #home is the escape hatch');
  const focusMatch = setupPortal('#match=m1', 'focus');
  focusMatch.run('syncPortalScreen()');
  assert.equal(focusMatch.run('document.body.dataset.portalView'), 'matches', 'open match still matches view');
});

// Minimal match-layout harness (same shape as match-layout.test.cjs).
function setupLayout(archetype) {
  const nodes = new Map();
  const classes = () => {
    const set = new Set();
    return {toggle(name, on) { if (on) set.add(name); else set.delete(name); }, contains: (name) => set.has(name)};
  };
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {hidden: false, textContent: '', attrs: {}, classList: classes(), events: {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.events[k] = v; }, focus() { this.focused = true; }});
    return nodes.get(id);
  };
  node('match-title').textContent = 'Tic-Tac-Toe';
  const media = {matches: false, addEventListener: (_, fn) => { media.change = fn; }};
  const body = {classList: classes()};
  const context = {I18n: {t: (key, params, fallback) => fallback ?? key}, window: {matchMedia: () => media}, navigator: {onLine: true},
    document: {getElementById: node, body,
      documentElement: {dataset: archetype ? {portalArchetype: archetype} : {}},
      addEventListener: () => {}},
    MutationObserver: class { observe() {} }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/portal-match-layout.js'), 'utf8'), context);
  const layout = context.window.PortalMatchLayout;
  layout.init(() => {});
  return {layout, body};
}

test('focus auto-focuses a live match in portrait; other skins do not', () => {
  const ongoing = {id: 'match', status: 'ongoing', pending: 0};
  const focus = setupLayout('focus');
  focus.layout.update(ongoing);
  assert.ok(focus.body.classList.contains('match-focus'), 'focus auto-focuses in portrait');
  const library = setupLayout('library');
  library.layout.update(ongoing);
  assert.equal(library.body.classList.contains('match-focus'), false, 'library does not auto-focus in portrait');
  const classic = setupLayout('');
  classic.layout.update(ongoing);
  assert.equal(classic.body.classList.contains('match-focus'), false, 'classic does not auto-focus in portrait');
});
