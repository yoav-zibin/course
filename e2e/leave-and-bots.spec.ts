import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createUser, createGame, importGame, loginAs, uniqueName, testCtx, caseImages } from './helpers';

test('multiplayer lobby offers no computer opponents', async ({page, request}) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const auth = (u: typeof alice) => ({'X-User-Id':u.id,'X-User-Password':u.password});
  const game = await createGame(request, alice, uniqueName('Human duel'));
  const match = await (await request.post('/matches', {headers:auth(alice),data:{game_id:game}})).json();
  await loginAs(page,alice);
  await page.goto(`/static/portal.html#match=${match.id}`);
  await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Add computer opponent'})).toHaveCount(0);
  expect((await request.post(`/matches/${match.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
  await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Add computer opponent'})).toHaveCount(0);
  const denied = await request.patch(`/matches/${match.id}`,{headers:auth(alice),data:{num_computer_opponents:1}});
  expect(denied.status()).toBe(409);
});

test('leave dialog quotes the game payout and ends without a replacement bot', async ({page,request}) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const auth = (u: typeof alice) => ({'X-User-Id':u.id,'X-User-Password':u.password});
  const source = `function settle(ctx, winnerId) {
    if (ctx.pot === 0) return {};
    const eligible = ctx.players.filter(p => p.kind === 'human');
    const winner = ctx.players.find(p => p.id === winnerId);
    if (winner && winner.kind === 'human') {
      const payouts = {};
      for (const p of eligible) payouts[p.id] = 0;
      payouts[winnerId] = ctx.pot;
      return payouts;
    }
    if (!eligible.length) return {};
    const share = Math.floor(ctx.pot / eligible.length);
    const payouts = {};
    eligible.forEach((p, i) => { payouts[p.id] = share + (i < ctx.pot - share * eligible.length ? 1 : 0); });
    return payouts;
  }
  const game = {
    newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]}},
    applyMove(state,id,move,ctx){
      if (move && move.end) {
        const payouts = settle(ctx, id);
        return {state:{n:0, finalPayouts:payouts}, turn:null, payouts};
      }
      return {state,turn:[id]};
    },
    computerMove(){return {}},randomMove(){return {}},viewFor(s){return s},
    playerLeft(state,id,ctx){
      if (state.finalPayouts) {
        const recorded = state.finalPayouts;
        const activeHumans = ctx.players.filter(p => p.kind === 'human' && p.active !== false);
        const payouts = {};
        let folded = 0;
        for (const [pid, amount] of Object.entries(recorded)) {
          const p = ctx.players.find(x => x.id === pid);
          if (p && p.kind === 'human' && p.active !== false) payouts[pid] = amount;
          else folded += amount;
        }
        if (folded && activeHumans.length) {
          const first = activeHumans[0].id;
          payouts[first] = (payouts[first] || 0) + folded;
        }
        return {state, turn:null, payouts};
      }
      const payouts = settle(ctx, id);
      return {state:{n:1, finalPayouts:payouts}, turn:null, payouts};
    }
  };`;
  // Exercise the normal publication gate, including required translatable text.
  const helper = fs.readFileSync(path.resolve(__dirname, '../game_i18n_helper.js'), 'utf8');
  const client = `<script type="application/json" id="i18n-strings">{"cash":"Cash out"}</script>
    <p id="cash"></p><script>${helper}
    function render(message){applyLocale(message);document.getElementById('cash').textContent=t('cash');}
    render({});window.addEventListener('message',event=>{if(event.data.type==='state_changed')render(event.data)});
    parent.postMessage({type:'ready'},'*');</script>`;
  const game = await importGame(request, alice, {
    name: uniqueName('Cash out'),
    description: 'Cash out to end the match',
    allowedPlayerCounts: [2],
    allowsLeaveMidMatch: true,
    clientCode: client,
    serverCode: source,
    rules: 'Press Cash out to end the match. Leaving pays the leaver 3 tokens.',
    uiInstructions: 'A cash-out button. Use a calm blue theme, readable on phones.',
    tutorialText: 'Press Cash out to end the match.',
    tutorialHtml:
      '<meta name="viewport" content="width=device-width">' +
      '<h1>How to play</h1><p>Press Cash out to end the match.</p>',
    tutorialVocab: ['How to play', 'Press Cash out to end the match.'],
    clientStrings: { cash: 'Cash out' },
    schemas: {
      state: { type: 'object', properties: { n: { type: 'integer' }, finalPayouts: { type: 'object', additionalProperties: { type: 'integer' } } }, required: ['n'], additionalProperties: false },
      move: { type: 'object' },
      view: { type: 'object', properties: { n: { type: 'integer' }, finalPayouts: { type: 'object', additionalProperties: { type: 'integer' } } }, required: ['n'], additionalProperties: false },
    },
    cases: [
      {
        name: 'Initial move',
        description: 'Alice makes a no-op move.',
        kind: 'initial',
        ctx: testCtx(1),
        state: { n: 0 },
        view_of_mover: { n: 0 },
        view_of_other: { n: 0 },
        player_id: 'u1',
        other_player_id: 'u2',
        move: {},
        expected_state: { n: 0 },
        expected_turn: ['u1'],
        expected_view_of_mover: { n: 0 },
        expected_view_of_other: { n: 0 },
        images: caseImages('Initial move'),
      },
      {
        name: 'Intermediate move',
        description: 'Bob makes a no-op move.',
        kind: 'intermediate',
        ctx: testCtx(2),
        state: { n: 0 },
        view_of_mover: { n: 0 },
        view_of_other: { n: 0 },
        player_id: 'u2',
        other_player_id: 'u1',
        move: {},
        expected_state: { n: 0 },
        expected_turn: ['u2'],
        expected_view_of_mover: { n: 0 },
        expected_view_of_other: { n: 0 },
        images: caseImages('Intermediate move'),
      },
      {
        name: 'Terminal move',
        description: 'Alice ends the match with a cash-out move.',
        kind: 'terminal',
        ctx: testCtx(3),
        state: { n: 0 },
        view_of_mover: { n: 0 },
        view_of_other: { n: 0 },
        player_id: 'u1',
        other_player_id: 'u2',
        move: { end: true },
        expected_state: { n: 0, finalPayouts: {} },
        expected_turn: null,
        expected_view_of_mover: { n: 0, finalPayouts: {} },
        expected_view_of_other: { n: 0, finalPayouts: {} },
        expected_payouts: {},
        images: caseImages('Terminal move'),
      },
    ],
  });
  const match = await (await request.post('/matches',{headers:auth(alice),data:{game_id:game,max_loss:10}})).json();
  expect((await request.post(`/matches/${match.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
  expect((await request.post(`/matches/${match.id}/start`,{headers:auth(alice),data:{}})).ok()).toBeTruthy();
  await loginAs(page,bob);
  await page.goto(`/static/portal.html#match=${match.id}`);
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  page.once('dialog',async dialog=>{
    expect(dialog.message()).toContain('20 tokens');
    expect(dialog.message()).toContain('ends the match');
    await dialog.accept();
  });
  await page.getByRole('button',{name:'Leave',exact:true}).click();
  await expect.poll(async()=> (await (await request.get(`/matches/${match.id}`,{headers:auth(alice)})).json()).status).toBe('over');
  const result=await (await request.get(`/matches/${match.id}`,{headers:auth(alice)})).json();
  expect(result.token_pot).toBe(0);
  expect(result.token_payouts).toEqual({'0':0,'1':20});
  expect(result.players.map((p:{kind:string})=>p.kind)).toEqual(['human','human']);
});
