import {test} from 'node:test';
import assert from 'node:assert/strict';
import bundled from '../src/core/bundled-tictactoe.json';
import {isValidDownloadedGame, presentationHistoryPath} from '../src/core/offline-match-data';
import {assetURI} from '../src/game/validation';

test('presentation downloads cover the recent board history without unbounded legacy reads', () => {
  assert.equal(presentationHistoryPath({id:'match',move_count:4},true), '/v2/matches/match/history?start=0&limit=4');
  assert.equal(presentationHistoryPath({id:'match',move_count:49},true), '/v2/matches/match/history?start=37&limit=12');
  assert.equal(presentationHistoryPath({id:'match',move_count:12},false), '/matches/match/moves');
  assert.equal(presentationHistoryPath({id:'match',move_count:13},false), null);
  assert.equal(presentationHistoryPath({id:'match',move_count:0},true), null);
});

test('presentation paths encode match identities and reject malformed move counts', () => {
  assert.equal(presentationHistoryPath({id:'a/b?invite=secret',move_count:1},true), '/v2/matches/a%2Fb%3Finvite%3Dsecret/history?start=0&limit=1');
  for (const move_count of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(presentationHistoryPath({id:'match',move_count},true), null);
  }
});

test('only a complete exact package can satisfy an offline match download', () => {
  assert.ok(isValidDownloadedGame(bundled,bundled.id,bundled.version));
  assert.equal(isValidDownloadedGame(bundled,'different-game',bundled.version),false);
  assert.equal(isValidDownloadedGame(bundled,bundled.id,bundled.version + 1),false);
  assert.equal(isValidDownloadedGame({...bundled,server_code:undefined},bundled.id,bundled.version),false);
  assert.equal(isValidDownloadedGame({...bundled,declarative_ui:undefined},bundled.id,bundled.version),false);
  assert.equal(isValidDownloadedGame({...bundled,declarative_ui:{format:'legacy-html'}},bundled.id,bundled.version),false);
  assert.equal(isValidDownloadedGame({...bundled,allowed_player_counts:[]},bundled.id,bundled.version),false);
  assert.equal(isValidDownloadedGame({...bundled,name:''},bundled.id,bundled.version),false);
});

test('a persisted exact package keeps its board graphics and interface text without asset requests', () => {
  const downloaded = JSON.parse(JSON.stringify(bundled));
  assert.ok(isValidDownloadedGame(downloaded,bundled.id,bundled.version));
  assert.ok(Object.keys(downloaded.declarative_ui.assets).length > 0);
  for (const asset of Object.values(downloaded.declarative_ui.assets)) {
    assert.ok(assetURI(asset as {uri:string})?.startsWith('data:image/'));
  }
  assert.equal(downloaded.declarative_ui.strings.title, 'Tic-tac-toe');
  assert.ok(downloaded.translations.es.client_strings.title);
});
