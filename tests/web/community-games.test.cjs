'use strict';
// Every game in games/community/ is the original game made translatable. For each one:
//  1. in English (no locale, no strings) the converted page shows exactly what the original shows
//     for the same messages, and sends the same moves;
//  2. given a translation of every text (here: each text prefixed with a marker), every text the
//     player reads is translated, except player names and data (no leftover English);
//  3. every text in the game's i18n-strings block is shown by at least one scenario.
// Fake page: tests/web/fake-page.cjs. Messages: tests/web/community-scenarios.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./fake-page.cjs');
const { S } = require('./community-scenarios.cjs');

const DIR = path.join(__dirname, '../../games/community');
const MARK = '¤';

function stringsOf(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="i18n-strings">([\s\S]*?)<\/script>/)[1]);
}
const pseudo = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, MARK + v]));
const patternOf = (text) => new RegExp(MARK + text.trim().replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '[\\s\\S]*'));
// A text with no real words (numbers, symbols, a single letter) needs no translation.
const needsTranslation = (text) => /[A-Za-zÀ-ɏЀ-ӿ]{2,}/.test(text);

for (const [prefix, spec] of Object.entries(S)) {
  const files = fs.readdirSync(DIR);
  const file = files.find((f) => f.startsWith(prefix) && f.endsWith('.html') && !f.endsWith('.original.html'));
  const original = files.find((f) => f.startsWith(prefix) && f.endsWith('.original.html'));
  test(`${prefix}: ${file}`, () => {
    assert.ok(file && original, 'converted and original files exist');
    const html = fs.readFileSync(path.join(DIR, file), 'utf8');
    const table = stringsOf(html);
    const shown = [];
    const leftovers = new Set();
    let step = 0;
    for (const scenario of spec.scenarios) {
      const a = loadPage(path.join(DIR, original));
      const b = loadPage(path.join(DIR, file));
      const c = loadPage(path.join(DIR, file));
      for (const { msg, then } of scenario) {
        step += 1;
        if (msg === null) { assert.equal(b.snapshot(), a.snapshot(), 'English page differs before any message'); continue; }
        a.send(msg); b.send(msg);
        assert.equal(b.snapshot(), a.snapshot(), `English page differs from the original at step ${step}`);
        if (then) { then(a); then(b); assert.equal(b.snapshot(), a.snapshot(), `English page differs after the action at step ${step}`); }
        assert.deepEqual(b.sent, a.sent, `moves sent differ at step ${step}`);
        c.send({ ...msg, locale: 'xx', direction: 'rtl', strings: pseudo(table) });
        if (then) then(c);
        assert.equal(c.doc.documentElement.attrs.lang, 'xx');
        assert.equal(c.doc.documentElement.attrs.dir, 'rtl');
        for (const text of c.texts()) {
          shown.push(text);
          const words = spec.names.reduce((s, n) => s.split(n).join(''), text).split(MARK).join('');
          if (!text.includes(MARK) && needsTranslation(words) && !(spec.data || []).some((d) => text.trim() === d.trim())) leftovers.add(text);
        }
      }
    }
    assert.deepEqual([...leftovers], [], 'texts shown without translation');
    for (const [key, text] of Object.entries(table)) {
      if ((spec.skipCoverage || []).includes(key)) continue;
      if (key.startsWith('server_')) continue; // texts the game's server writes: tests/web/server-texts.test.cjs
      const re = patternOf(text);
      assert.ok(shown.some((s) => re.test(s)), `no scenario shows the text "${key}": ${text}`);
    }
  });
}

test('SOS rules keep the S-O-S pattern bold wherever the translation puts it', () => {
  const file = fs.readdirSync(DIR).find((f) => f.startsWith('a1ca4c85') && !f.endsWith('.original.html'));
  const page = loadPage(path.join(DIR, file));
  page.send({ type: 'state_changed', status: 'ongoing', players: [], strings: { rules: 'Bilden Sie {pattern} in jeder Richtung.' }, locale: 'de' });
  const rules = page.doc.querySelector('.rules');
  assert.equal(rules.textContent, 'Bilden Sie S → O → S in jeder Richtung.');
  assert.equal(rules.querySelector('b').textContent, 'S → O → S');
  page.send({ type: 'state_changed', status: 'ongoing', players: [], strings: { rules: 'Keine Markierung.' }, locale: 'de' });
  assert.equal(page.doc.querySelector('.rules').textContent, 'Keine Markierung.');
});

const loadByPrefix = (prefix) => loadPage(path.join(DIR, fs.readdirSync(DIR).find((f) => f.startsWith(prefix) && !f.endsWith('.original.html'))));
test('War counters keep their bold number wherever the translation puts it', () => {
  const page = loadByPrefix('42d06892');
  page.send({ type: 'state_changed', status: 'ongoing', players: [], locale: 'ja', strings: { round: '{value}ラウンド', pot: 'Pot: {value} cards', war: 'WAR {value}' } });
  const pills = page.doc.querySelectorAll('.pill');
  assert.deepEqual(pills.map((p) => p.textContent), ['1ラウンド', 'Pot: 0 cards', 'WAR 0']);
  assert.equal(pills[0].children[0].attrs.id, 'round');
  assert.equal(pills[1].children[0].attrs.id, 'pot');
});
test('Nine Stars legend keeps the bold bonus in place', () => {
  const page = loadByPrefix('79830aee');
  page.send({ type: 'state_changed', status: 'ongoing', players: [], locale: 'fr', strings: { legend_2: 'Pour {bonus} par ligne.' } });
  const legend = page.doc.querySelector('.legend');
  assert.match(legend.textContent, /Pour \+2 par ligne\./);
  assert.equal(legend.querySelector('b').textContent, '+2');
});
test('Tower of Hanoi and Bulls and Cows keep their counters in the translated sentence', () => {
  const hanoi = loadByPrefix('ad578d02');
  hanoi.send({ type: 'state_changed', status: 'ongoing', players: [], locale: 'de', strings: { moves_label: 'Züge: {value}', minimal_label: 'Minimum: {value}' } });
  assert.equal(hanoi.doc.querySelector('#game p').textContent, 'Züge: 0  |  Minimum: 7');
  assert.equal(hanoi.doc.querySelector('#game p').querySelector('b#moves').textContent, '0');
  const bulls = loadByPrefix('916ab616');
  bulls.send({ type: 'state_changed', status: 'ongoing', players: [], locale: 'de', strings: { your_number: 'Ihre Zahl: {value}', opponent_number: 'Gegner: {value}' } });
  assert.equal(bulls.doc.querySelector('#playDiv p').textContent, 'Ihre Zahl:   |  Gegner: ****');
});
