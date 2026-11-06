// Texts the game's SERVER writes into the match state (a log line, a label, a reason) are shown
// through tx(): in English they read as before; with a translation the page shows the translated
// template with the server's values put back (docs/game-translation.md, "Texts the server writes").
// One test per converted family: log lines, reasons, result lists, labels, community games.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./fake-page.cjs');
const { stringsOf } = require('./page-helper.cjs');
const { CASES } = require('./translated-games.cases.cjs');
const { S } = require('./community-scenarios.cjs');

const GAMES = path.join(__dirname, '../../games');
const table = (file) => stringsOf(fs.readFileSync(path.join(GAMES, file), 'utf8'));

// A copy of [value] where every string equal to [from] is replaced by [to].
function swap(value, from, to) {
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map((v) => swap(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v, from, to)]));
  return value;
}

// The page's `server_` templates "translated" into a made-up language: ES[template].
function translations(file) {
  return Object.fromEntries(Object.entries(table(file)).filter(([k]) => k.startsWith('server_')).map(([k, v]) => [k, `ES[${v}]`]));
}

// The key of the template [template] in the page's table (the test fails if the page lacks it).
function keyOf(file, template) {
  const found = Object.entries(table(file)).find(([k, v]) => k.startsWith('server_') && v === template);
  assert.ok(found, `${file} has no server template "${template}"`);
  return found[0];
}

// What [message] shows on [file] in English and with the Spanish stand-in.
function show(file, message) {
  const english = loadPage(path.join(GAMES, file));
  english.send({ type: 'state_changed', ...message });
  const spanish = loadPage(path.join(GAMES, file));
  spanish.send({ type: 'state_changed', ...message, locale: 'es', direction: 'ltr', strings: translations(file) });
  return { english: english.texts().join('\n'), spanish: spanish.texts().join('\n') };
}

// Log lines, reasons and results: a sample message of translated-games.cases.cjs with its
// placeholder replaced by a text the game's server really writes. `shown` is that text in the
// stand-in language: the template translated, the server's values as written.
const FAMILIES = [
  { file: 'audit-batch1/go-fish.html', placeholder: 'L1', text: 'Ann passes', template: '{p1} passes', shown: 'ES[Ann passes]', message: 0 },
  { file: 'audit-batch1/lost-cities.html', placeholder: 'L1', text: 'Ann drew from deck', template: '{p1} drew from deck', shown: 'ES[Ann drew from deck]', message: 0 },
  { file: 'audit-batch3/ers.html', placeholder: 'L1', text: 'Bob slapped at nothing.', template: '{p1} slapped at nothing.', shown: 'ES[Bob slapped at nothing.]', message: 0 },
  { file: 'audit-batch3/ers.html', placeholder: 'R1', text: 'JOKER!', template: 'JOKER!', shown: 'ES[JOKER!]', message: 2 },
  { file: 'audit-batch3/six-card-golf.html', placeholder: 'L1', text: 'Ann replaced a card.', template: '{p1} replaced a card.', shown: 'ES[Ann replaced a card.]', message: 0 },
  { file: 'audit-batch4/rummy-500.html', placeholder: 'L1', text: 'Ann drew from stock.', template: '{p1} drew from stock.', shown: 'ES[Ann drew from stock.]', message: 0 },
  { file: 'audit-batch4/blackjack-table.html', placeholder: 'R1', text: 'Push BJ', template: 'Push BJ', shown: 'ES[Push BJ]', message: 0 },
  { file: 'audit-batch2/3-minute-chess.html', placeholder: 'R1', text: 'Stalemate', template: 'Stalemate', shown: 'ES[Stalemate]', message: 3 },
  { file: 'audit-batch5/chess.html', placeholder: 'R1', text: 'Resignation', template: 'Resignation', shown: 'ES[Resignation]', message: 5 },
];

for (const { file, placeholder, text, template, shown, message } of FAMILIES) {
  test(`${file}: the server's "${text}" is shown translated, with its values as written`, () => {
    keyOf(file, template);
    const sample = swap(CASES[file].messages[message], placeholder, text);
    const { english, spanish } = show(file, sample);
    assert.ok(english.includes(text), `English shows the text as the server wrote it: ${english}`);
    assert.ok(!english.includes('ES['), 'English is not translated');
    assert.ok(spanish.includes(shown), `Spanish shows ${shown}: ${spanish}`);
  });
}

test('blackjack translates each result of a hand separately and keeps the numbers', () => {
  const file = 'audit-batch4/blackjack-table.html';
  keyOf(file, 'Win {p1}v{p2} +{p3}');
  keyOf(file, 'Lose {p1}v{p2} (-{p3})');
  const sample = swap(CASES[file].messages[0], 'R1', 'Win 20v18 +50 | Lose 17v19 (-25)');
  const { english, spanish } = show(file, sample);
  assert.ok(english.includes('Win 20v18 +50 | Lose 17v19 (-25)'));
  assert.ok(spanish.includes('ES[Win 20v18 +50] | ES[Lose 17v19 (-25)]'), spanish);
});

test('a server text with no template is shown as the server wrote it, translation or not', () => {
  const file = 'audit-batch1/go-fish.html';
  const { english, spanish } = show(file, swap(CASES[file].messages[0], 'L1', 'A text nobody listed'));
  assert.ok(english.includes('A text nobody listed'));
  assert.ok(spanish.includes('A text nobody listed') && !spanish.includes('ES[A text'));
});

test('the label of the last play in beat-the-landlord is a server text', () => {
  const file = 'audit-batch1/beat-the-landlord.html';
  keyOf(file, 'Pair');
  const sample = CASES[file].messages[1];
  const label = sample.view.last.combo.label;
  const { english, spanish } = show(file, swap(sample, label, 'Pair'));
  assert.ok(english.includes('Pair') && !english.includes('ES['));
  assert.ok(spanish.includes('ES[Pair]'), spanish);
});

test('battleship translates the message of the start of the battle', () => {
  const file = 'audit-batch1/battleship.html';
  const message = 'Battle start! P1 fires. HIT keeps your turn!';
  keyOf(file, message);
  const sample = JSON.parse(JSON.stringify(CASES[file].messages[3]));
  sample.view.last = { msg: message };
  const { english, spanish } = show(file, sample);
  assert.ok(english.includes(message));
  assert.ok(spanish.includes(`ES[${message}]`), spanish);
});

// Community games: a log written as a string, a log written as a list of lines.
function communityPage(prefix) {
  const file = fs.readdirSync(path.join(GAMES, 'community')).find((f) => f.startsWith(prefix) && f.endsWith('.html') && !f.endsWith('.original.html'));
  return `community/${file}`;
}

test('community war game: the log of a round is translated', () => {
  const file = communityPage('42d06892');
  keyOf(file, '{p1} has no cards to flip!');
  const message = S['42d06892'].scenarios[0][1].msg;
  const { english, spanish } = show(file, { ...message, view: { ...message.view, log: 'Ana has no cards to flip!' } });
  assert.ok(english.includes('Ana has no cards to flip!') && !english.includes('ES['));
  assert.ok(spanish.includes('ES[Ana has no cards to flip!]'), spanish);
});

test('community game with a list of log lines: each line is translated or left as written', () => {
  const file = communityPage('cbd19f63');
  keyOf(file, '{p1} rolled {p2} for first turn');
  const message = S['cbd19f63'].scenarios[2][0].msg;
  const view = { ...message.view, log: ['Ana rolled 3 for first turn', 'a line nobody listed'] };
  const { english, spanish } = show(file, { ...message, view });
  assert.ok(english.includes('Ana rolled 3 for first turn') && english.includes('a line nobody listed'));
  assert.ok(spanish.includes('ES[Ana rolled 3 for first turn]'), spanish);
  assert.ok(spanish.includes('a line nobody listed'));
});

test('poker translates the lines of its log and leaves the unlisted ones', () => {
  const file = 'poker.html';
  keyOf(file, '{p1} folds.');
  const view = {
    hand_number: 2, street: 'flop', board: ['As', 'Kd', '7c'], chips: [90, 110], contributed: [10, 10], bets: [0, 0],
    dealt_in: [true, true], in_hand: [true, true], hole: [['Ah', 'Kh'], null], dealer: 0, to_act: 0, winner: null, pot: 20,
    log: ['Ann folds.', 'nobody listed this'],
  };
  const players = [{ name: 'Ann', player_index: 0 }, { name: 'Bob', player_index: 1 }];
  const { english, spanish } = show(file, { status: 'ongoing', move_count: 3, my_player_index: 0, acting_for_player_index: 0, turn_of_player_indices: [0], players, view });
  assert.ok(english.includes('Ann folds.') && !english.includes('ES['));
  assert.ok(spanish.includes('ES[Ann folds.]') && spanish.includes('nobody listed this'), spanish);
});
