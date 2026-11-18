import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createUser, loginAs, mockBatch, openMatchControls, showMatchMenu, uniqueName } from './helpers';

// A declarative solo fixture exercises portal setup, replay and local controls.
const star = {
  id:'declarative-solo-counter',name:'Solo Counter',version:1,
  description:'Reach five points',owner_user_id:'solo-fixture-owner',
  allowed_player_counts:[1],published:true,renderer_type:'declarative',code:'',
  server_code:`const game={
    newMatch(ctx){return {state:{count:0},turn:[ctx.players[0].id]};},
    applyMove(state,id,move,ctx){const count=state.count+1;return {state:{count},turn:count===5?null:[id]};},
    viewFor(state){return state;},computerMove(){return {add:true};}
  };`,
  game_schemas:{state:{type:'object'},view:{type:'object'},move:{type:'object'}},
  declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:300},
    boards:[{id:'main',kind:'zone',x:0,y:0,width:400,height:300}],piece_types:{token:{shape:'circle'}},
    strings:{add:'Add point'},
    ui_code:`const gameUI={reduce(message){
      const m=message.type==='ui_event'?message.state_changed:message;
      const count=(m.view||m.state).count;
      const active=m.status==='ongoing'&&!m.replay;
      const out={scene:{labels:[{id:'count',text:count===5?'You reached 5 points!':'Count: '+count+' of 5',x:20,y:40}],
        controls:active?[{id:'add',kind:'button',label:'Add point'}]:[]}};
      if(message.type==='ui_event'&&message.event.id==='add'&&active)out.make_move={add:true};
      return out;
    }};`,
  },
  created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',
};
const multiplayer = { ...star, id:'multiplayer-setup-fixture', name:'Multiplayer setup', allowed_player_counts:[2] };

async function prepare(page: Page, request: APIRequestContext, shelf: 'catalog' | 'recent' | 'popular' | 'detail' = 'catalog') {
  const user = await createUser(request, uniqueName('Solo player'));
  await loginAs(page, user);
  const games = [star, multiplayer];
  const mocks: Record<string, unknown> = {
    '/games': games,
    '/games/popular': shelf === 'popular' ? [star] : [],
    '/users/me/recent-games': shelf === 'recent' ? [star] : [],
  };
  for (const game of games) {
    mocks[`/games/${game.id}`] = game;
    mocks[`/games/${game.id}/versions/${game.version}`] = game;
  }
  await mockBatch(page, request, mocks);
  return user;
}

async function openMatchOptions(page: Page) {
  if (await page.locator('#match-options').getAttribute('open') === null)
    await page.locator('#match-options > summary').click();
}

test('switching from a timed multiplayer setup to solo removes hidden match settings', async ({page, request}) => {
  await prepare(page, request);
  await page.goto(`/static/portal.html#game=${multiplayer.id}`);
  await openMatchOptions(page);
  await page.locator('#match-speed').selectOption('60');
  await page.locator('#match-stake').selectOption('5');
  await page.locator('.back-to-games').click();
  await page.getByRole('combobox', {name: 'Search games'}).fill(star.name);
  await page.getByRole('option', {name: new RegExp(star.name)}).click();
  await expect(page.locator('#local-play-title')).toHaveText('Solo');
  await expect(page.locator('#online-play-hint')).toHaveText('Starts immediately. No opponent needed.');
  await expect(page.locator('#speed-choice')).toBeHidden();
  await expect(page.locator('#match-speed')).toBeDisabled();
  await expect(page.locator('#match-speed')).toHaveValue('');
  await expect(page.locator('#token-stake-panel')).toBeHidden();
  await expect(page.locator('#match-stake')).toHaveValue('0');
  await page.locator('#account-menu .auth-menu-button').click();
  await page.locator('#language-picker').selectOption('es');
  await expect(page.locator('#local-play-title')).toHaveText('Solo');
  await expect(page.locator('#online-play-hint')).not.toContainText('opponents');
  await page.locator('#language-picker').selectOption('en');
  await page.keyboard.press('Escape');
  await page.locator('.back-to-games').click();
  await page.getByRole('combobox', {name: 'Search games'}).fill(multiplayer.name);
  await page.getByRole('option', {name: new RegExp(multiplayer.name)}).click();
  await expect(page.locator('#local-play-title')).toHaveText('Pass and play');
  await expect(page.locator('#online-play-hint')).toHaveText('Create a private table and send your friend the invite link.');
  await expect(page.locator('#match-speed')).toBeEnabled();
  await openMatchOptions(page);
  await expect(page.locator('#token-stake-panel')).toBeVisible();
});

for (const entry of ['catalog', 'recent', 'popular', 'detail'] as const) {
  test(`solo quick play from the ${entry} starts immediately without inherited stakes or a clock`, async ({page, request}) => {
    const user = await prepare(page, request, entry);
    const player = {player_index: 0, kind: 'human', user_id: user.id, id: user.id, active: true};
    let match = {
      id: 'quick-solo-fixture', game_id: star.id, game_version: star.version,
      owner_user_id: user.id, players: [player], status: 'waiting_for_players',
      end_reason: null, state: {count: 0}, move_count: 0, turn_of_player_indices: [0],
      created_at: star.created_at, updated_at: star.updated_at, token_pot: 0, bet_per_player: 0,
    };
    const calls: {path: string; body: unknown}[] = [];
    await page.route('**/matches', route => {
      if (route.request().method() !== 'POST') return route.continue();
      calls.push({path: '/matches', body: route.request().postDataJSON()});
      return route.fulfill({status: 201, json: match});
    });
    await page.route('**/matches/quick-solo-fixture/start', route => {
      calls.push({path: '/start', body: route.request().postDataJSON()});
      match = {...match, status: 'ongoing'};
      return route.fulfill({json: match});
    });
    await page.route('**/matches/quick-solo-fixture', route => route.fulfill({json: match}));
    await page.route('**/matches/quick-solo-fixture/moves', route => {
      match = {...match, move_count: 1, state: {count: 1}, updated_at: new Date().toISOString()};
      return route.fulfill({json: match});
    });
    // Leave real multiplayer settings behind, then use the solo card directly.
    await page.goto(`/static/portal.html#game=${multiplayer.id}`);
    await openMatchOptions(page);
    await page.locator('#match-speed').selectOption('60');
    await page.locator('#match-stake').selectOption('5');
    await page.locator('.back-to-games').click();
    const soloCard = page.locator('#game-library .library-card-wrap')
      .filter({has: page.locator('.library-title', {hasText: star.name})});
    let button;
    if (entry === 'detail') {
      await soloCard.locator('.library-card').click();
      await expect(page.locator('#game-detail-page')).toBeVisible();
      button = page.locator('#quick-play');
    } else {
      const container = entry === 'catalog' ? soloCard : page.locator(`#${entry}-games`);
      button = container.getByRole('button', {name: `Play ${star.name} solo now`, exact: true});
    }
    await button.click();
    await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
    await expect(page.locator('#waiting')).toBeHidden();
    await expect(page.locator('#game-detail-page')).toBeHidden();
    await expect(page.locator('#game-box .declarative-stage > text')).toContainText('Count: 0 of 5');
    expect(calls).toEqual([
      {path: '/matches', body: {game_id: star.id, num_computer_opponents: 0, bet_per_player: 0}},
      {path: '/start', body: {first_turn_player_indices: [0]}},
    ]);
    await page.locator('#game-box [data-ui-id=add]').click();
    await expect(page.locator('#game-box .declarative-stage > text')).toContainText('Count: 1 of 5');
  });
}

test('solo Play again attempts to start immediately and keeps Start available after a connection error', async ({page, request}) => {
  const user = await prepare(page, request);
  const player = {player_index: 0, kind: 'human', user_id: user.id, id: user.id, active: true};
  const finished = {
    id: 'solo-finished-fixture', game_id: star.id, game_version: star.version,
    owner_user_id: user.id, players: [player], status: 'over', end_reason: 'finished',
    state: {count: 5}, move_count: 5, turn_of_player_indices: null,
    created_at: star.created_at, updated_at: star.updated_at, token_pot: 0, bet_per_player: 0,
  };
  let replay = {...finished, id: 'solo-replay-fixture', status: 'waiting_for_players', end_reason: null,
    state: {count: 0}, move_count: 0, turn_of_player_indices: [0]};
  const calls: string[] = [];
  await page.route('**/matches/solo-finished-fixture', route => route.fulfill({json: finished}));
  await page.route('**/matches/solo-finished-fixture/rematch', route => {
    calls.push('rematch');
    return route.fulfill({json: replay});
  });
  await page.route('**/matches/solo-replay-fixture', route => route.fulfill({json: replay}));
  let starts = 0;
  await page.route('**/matches/solo-replay-fixture/start', route => {
    calls.push('start');
    if (++starts === 1) return route.fulfill({status: 503, json: {detail: 'Start connection interrupted'}});
    replay = {...replay, status: 'ongoing'};
    return route.fulfill({json: replay});
  });
  await page.goto(`/static/portal.html#game=${star.id}&match=${finished.id}`);
  await page.getByRole('button', {name: 'Play again', exact: true}).click();
  await expect(page).toHaveURL(/match=solo-replay-fixture/);
  await expect(page.locator('#waiting')).toBeVisible();
  await expect(page.locator('#match-message')).toContainText('Start connection interrupted');
  await expect(page.getByRole('button', {name: 'Start game', exact: true})).toBeEnabled();
  expect(calls).toEqual(['rematch', 'start']);
  await page.getByRole('button', {name: 'Start game', exact: true}).click();
  await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
  await expect(page.locator('#waiting')).toBeHidden();
  await expect(page.locator('#game-box .declarative-stage > text')).toContainText('Count: 0 of 5');
  expect(calls).toEqual(['rematch', 'start', 'start']);
});

for (const game of [star]) {
  test(`${game.name} local solo play finishes, replays and starts again through portal controls`, async ({page, request}) => {
    await prepare(page, request);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const writes: string[] = [];
    page.on('request', req => {
      if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/matches')) writes.push(req.url());
    });
    await page.goto(`/static/portal.html#game=${game.id}`);
    await page.locator('#practice').click();
    const frame = page.locator('#game-box');
    await expect(frame.locator('.declarative-stage > text')).toContainText('Count: 0 of 5');
    for (let count=1;count<=5;count++) {
      await frame.locator('[data-ui-id=add]').click();
      await expect(frame.locator('.declarative-stage > text')).toContainText(count===5?'You reached 5 points!':`Count: ${count} of 5`);
    }
    await expect(page.locator('#match-status')).toHaveClass('badge over');
    await expect(page.locator('#match-play-notice')).toHaveText('Match finished');
    await expect(page.locator('#match-result')).toHaveText('Match finished');
    const finishedUrl = page.url();
    await openMatchControls(page);
    await page.locator('#history-back').click();
    await expect(page.locator('#history-position')).toContainText('read only');
    await page.locator('#history-live').click();
    await expect(page.locator('#history-position')).toContainText('Live');
    await page.locator('.match-more summary').click();
    await page.getByRole('button', {name: 'Start a new practice', exact: true}).click();
    await expect(page).not.toHaveURL(finishedUrl);
    await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
    await expect(frame.locator('.declarative-stage > text')).toContainText('Count: 0 of 5');
    await openMatchControls(page);
    await page.getByRole('button', {name: 'End practice', exact: true}).click();
    await expect(page.locator('#match-status')).toHaveClass('badge over');
    await page.getByRole('button', {name: 'Resume practice', exact: true}).click();
    await expect(page.locator('#match-status')).toHaveClass('badge ongoing');
    await showMatchMenu(page);
    await page.locator('#match-back').click();
    await expect(page.locator('#match')).toBeHidden();
    await expect(page.locator('#game-detail-page')).toBeVisible();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}
