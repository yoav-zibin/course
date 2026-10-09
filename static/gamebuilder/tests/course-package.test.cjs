const assert = require('node:assert/strict');
const Package = require('../src/course-package.js');
const { EXAMPLES } = require('../src/examples.js');
const doc = { localId: 'game-one', title: '棋 ♟️', code: EXAMPLES[0].code,
  rules: 'Three in a row', tutorial: ['Pick a square'], allowedPlayers: [2],
  chat: [{ role: 'user', text: '</script><script>alert(1)</script>' }], versions: [] };
const code = Package.pack(doc);
assert.deepEqual(Package.unpack(code), doc);
assert.equal(Package.unpack('<html>another builder</html>'), null);
assert.equal(Package.unpack('<!--gamebuilder-v1:AAAA-->'), null);
assert.equal((code.match(/<\/script>/gi) || []).length, 1);
assert.equal((code.match(/<script>/gi) || []).length, 1);
assert.ok(code.includes("type: 'make_move'"));
assert.ok(code.includes("next_turn_player_indices"));
console.log('PASS: Unicode metadata round trip, unrelated/corrupt package handling, script-boundary escaping, current course message contract');
