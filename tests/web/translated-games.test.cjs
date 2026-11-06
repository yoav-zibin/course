// Every built-in game page that is translatable (docs/game-translation.md): feed it state_changed
// messages in a made-up language where each text is «its key», and check that the page shows
// translations and no English leaks through. The English output itself is covered by the game's
// own tests; the sample messages below mirror the views the games' server code sends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stringsOf, pageScript, fakeDom, texts } = require('./page-helper.cjs');

// Player names used in the sample messages (names are not translated).
const NAMES = ['Ann', 'Bob', 'Dee', 'Eve'];
const GAMES = path.join(__dirname, '../../games');

function load(file) {
  const html = fs.readFileSync(path.join(GAMES, file), 'utf8');
  const { document, ids } = fakeDom();
  const sent = [];
  let receive;
  const parent = { postMessage: (m) => sent.push(m) };
  const sandbox = {
    document, parent, console, Math, JSON, Date, Array, Object, Set, Map, Number, String, Boolean, Promise, Symbol,
    setTimeout: (fn) => { try { fn(); } catch (e) { /* ignore */ } return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener: (type, fn) => { if (type === 'message') receive = fn; },
    innerWidth: 800, innerHeight: 600, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pageScript(html, document), sandbox);
  const keys = Object.keys(stringsOf(html));
  const translated = Object.fromEntries(keys.map((k) => [k, `«${k}»`]));
  return {
    ids, document, sent, keys,
    send: (message, { translate = true } = {}) => receive({
      source: parent,
      data: translate ? { ...message, type: 'state_changed', locale: 'xx', direction: 'ltr', strings: translated } : { ...message, type: 'state_changed' },
    }),
    pageTexts: () => ids.size ? [...ids.values()].flatMap((node) => texts(node)) : [],
  };
}

// English words left once every «key» is removed. Names in the samples are short on purpose.
function leaks(strings) {
  return strings.join(' | ').replace(/«[^»]*»/g, '').match(/[A-Za-z]{3,}/g) || [];
}

const { CASES } = require('./translated-games.cases.cjs');
for (const [file, game] of Object.entries(CASES)) {
  test(`${file}: shows the platform's translations and no English`, () => {
    const page = load(file);
    const html = fs.readFileSync(path.join(GAMES, file), 'utf8');
    const staticText = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style)[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&\w+;/g, ' ');
    assert.deepEqual(staticText.match(/[A-Za-z]{3,}/g) || [], [], `${file}: text written in the HTML itself`);
    assert.deepEqual(html.match(/(?:aria-label|title|placeholder|alt)="[^"]*[A-Za-z]{3,}[^"]*"/g) || [], [], `${file}: attribute text written in the HTML`);
    page.send(game.messages[0]);
    for (const message of game.messages) {
      page.send(message);
      const shown = page.pageTexts();
      assert.ok(shown.some((s) => s.includes('«')), `${file}: no translated text on screen`);
      const found = leaks(shown).filter((w) => ![...NAMES, ...(game.allowed || [])].includes(w));
      assert.deepEqual(found, [], `${file}: English left on screen: ${found.join(', ')}`);
    }
    if (game.after) game.after(page);
  });
}
