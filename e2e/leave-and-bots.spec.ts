import { test, expect } from '@playwright/test';
import { createUser, createGame, loginAs, uniqueName } from './helpers';

test('multiplayer lobby offers no computer opponents', async ({page, request}) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const auth = (u: typeof alice) => ({'X-User-Id':u.id,'X-User-Password':u.password});
  const game = await createGame(request, alice, uniqueName('Human duel'));
  const match = await (await request.post('/matches', {headers:auth(alice),data:{game_id:game}})).json();
  expect((await request.post(`/matches/${match.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
  await loginAs(page,alice);
  await page.goto(`/static/portal.html#match=${match.id}`);
  await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Add computer opponent'})).toHaveCount(0);
  const denied = await request.patch(`/matches/${match.id}`,{headers:auth(alice),data:{num_computer_opponents:1}});
  expect(denied.status()).toBe(409);
});

test('leave dialog quotes the game payout and ends without a replacement bot', async ({page,request}) => {
  const alice = await createUser(request, uniqueName('Alice'));
  const bob = await createUser(request, uniqueName('Bob'));
  const auth = (u: typeof alice) => ({'X-User-Id':u.id,'X-User-Password':u.password});
  const source = `const game = {
    newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]}},
    applyMove(state,id,move,ctx){return {state,turn:[id]}},
    computerMove(){return {}},randomMove(){return {}},viewFor(s){return s},
    playerLeft(state,id,ctx){const other=ctx.players.find(p=>p.id!==id);return {state:{n:1},turn:null,payouts:{[id]:3,[other.id]:ctx.pot-3}}}
  };`;
  const game = await (await request.post('/games',{headers:auth(alice),data:{name:uniqueName('Cash out'),allowed_player_counts:[2],allows_leave_mid_match:true,code:'<p>Cash out</p>',server_code:source,game_schemas:{state:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false},move:{type:'object'},view:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false}}}})).json();
  const match = await (await request.post('/matches',{headers:auth(alice),data:{game_id:game.id,max_loss:10}})).json();
  expect((await request.post(`/matches/${match.id}/join`,{headers:auth(bob)})).ok()).toBeTruthy();
  expect((await request.post(`/matches/${match.id}/start`,{headers:auth(alice),data:{}})).ok()).toBeTruthy();
  await loginAs(page,bob);
  await page.goto(`/static/portal.html#match=${match.id}`);
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  page.once('dialog',async dialog=>{
    expect(dialog.message()).toContain('3 tokens');
    expect(dialog.message()).toContain('ends the match');
    await dialog.accept();
  });
  await page.getByRole('button',{name:'Leave',exact:true}).click();
  await expect.poll(async()=> (await (await request.get(`/matches/${match.id}`,{headers:auth(alice)})).json()).status).toBe('over');
  const result=await (await request.get(`/matches/${match.id}`,{headers:auth(alice)})).json();
  expect(result.token_pot).toBe(0);
  expect(result.token_payouts).toEqual({'0':17,'1':3});
  expect(result.players.map((p:{kind:string})=>p.kind)).toEqual(['human','human']);
});
