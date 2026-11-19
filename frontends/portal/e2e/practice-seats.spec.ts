import {test,expect,type Page} from '@playwright/test';

// A private host fixture: one round in seat order, with a private viewer marker.
// This exercises the ordinary local controls, never a production game or audit.
const fixture={id:'practice-seat-fixture',version:1,name:'Practice seat fixture',description:'Local player-count and seat regression fixture.',allowed_player_counts:[2,4],renderer_type:'declarative',
  server_code:`const game={
    newMatch(ctx){return {state:{turn:0,winner:-1,done:false},turn:[ctx.players[0].id]};},
    applyMove(s,id,m,ctx){if(id!==ctx.players[s.turn].id||m.go!==true)throw new InvalidMove('Wrong player');s.turn++;s.done=s.turn===ctx.players.length;if(s.done)s.winner=ctx.players.length-1;return {state:s,turn:s.done?null:[ctx.players[s.turn].id]};},
    viewFor(s,id,ctx){return {...s,private_for:id};},computerMove(){return {go:true};}
  };`,
  declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:300}],piece_types:{token:{shape:'circle',width:64,height:64}},
    ui_code:`const gameUI={reduce(message){const m=message.type==='ui_event'?message.state_changed:message;const active=m.status==='ongoing'&&!m.replay&&m.acting_for_player_index!==null;return {scene:{labels:[{id:'viewer',x:20,y:30,text:'Your seat '+(m.my_player_index+1),font_size:20},{id:'private',x:20,y:65,text:'Hand belongs to '+m.state.private_for,font_size:16}],controls:active?[{id:'advance',kind:'button',label:'Advance'}]:[]},...(message.type==='ui_event'&&active?{make_move:{go:true}}:{})};}};`}};

async function savedMatch(page:Page,id:string){
  return page.evaluate(matchId=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('buildplay.shared.v1.')&&key.endsWith('.visitor'));
    return key?JSON.parse(localStorage.getItem(key)!).local[matchId]:null;
  },id);
}

test('pass-and-play replay keeps each private hand attributed to its frame viewer after reload',async({page},info)=>{
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.goto('/portal#game=practice-seat-fixture');await page.getByRole('button',{name:'Players: 4',exact:true}).click();
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page).toHaveURL(/#match=local-/);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  for(let seat=0;seat<4;seat++){
    if(seat)await page.getByRole('button',{name:'I’m ready',exact:true}).click();
    await expect(page.getByText(`Your seat ${seat+1}`,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Advance',exact:true}).click();
  }
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 4 won');await page.reload();
  for(let frame=3;frame>=0;frame--){
    await page.getByRole('button',{name:'← Previous',exact:true}).click();
    await expect(page.getByText(`Replay · move ${frame} of 4`,{exact:true})).toBeVisible();
    await expect(page.getByText(`Your seat ${frame+1}`,{exact:true})).toBeVisible();
    await expect(page.getByText(`Hand belongs to local-player-${frame}`,{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Advance',exact:true})).toHaveCount(0);
  }
  expect((await savedMatch(page,id)).move_count).toBe(4);
  await page.getByRole('button',{name:'Live board',exact:true}).click();
  await expect(page.getByText('Your seat 1',{exact:true})).toBeVisible();await expect(page.getByTestId('match-outcome')).toHaveText('Player 4 won');
  await page.screenshot({path:info.outputPath('pass-replay-private-view.png'),fullPage:true});
});

for(const count of [2,4])for(const humanSeat of [0,count-1])test(`computer practice retains human seat ${humanSeat+1} of ${count} through play, reload, history and rematch`,async({page},info)=>{
  await page.route(url=>/^\/games\/practice-seat-fixture(?:\/versions\/1)?$/.test(url.pathname),route=>route.fulfill({json:fixture}));
  await page.goto('/portal#game=practice-seat-fixture');
  await expect(page.getByRole('heading',{name:fixture.name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:`Players: ${count}`,exact:true}).click();
  const choice=page.getByRole('button',{name:`Your seat against computers: Player ${humanSeat+1}`,exact:true});
  await choice.click();const bounds=(await choice.boundingBox())!;expect(Math.min(bounds.width,bounds.height)).toBeGreaterThanOrEqual(32);
  await page.getByRole('button',{name:'Practice with computers',exact:true}).click();
  await expect(page).toHaveURL(/#match=local-/);const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!;
  await expect(page.getByText(`Your seat ${humanSeat+1}`,{exact:true})).toBeVisible();
  const opened=await savedMatch(page,id);expect(opened.players).toHaveLength(count);expect(opened.players[humanSeat]).toMatchObject({kind:'human',user_id:'visitor'});
  expect(opened.move_count).toBe(humanSeat);expect(opened.state.private_for).toBe(`local-player-${humanSeat}`);
  await page.getByRole('button',{name:'Advance',exact:true}).click();
  await expect(page.getByTestId('match-outcome')).toHaveText(humanSeat===count-1?'You won':'You lost');
  expect((await savedMatch(page,id)).move_count).toBe(count);
  await page.reload();await expect(page.getByTestId('match-outcome')).toHaveText(humanSeat===count-1?'You won':'You lost');
  expect((await savedMatch(page,id)).players[humanSeat].kind).toBe('human');
  await page.getByRole('button',{name:'← Previous',exact:true}).click();await expect(page.getByText(`Replay · move ${count-1} of ${count}`,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Advance',exact:true})).toHaveCount(0);expect((await savedMatch(page,id)).move_count).toBe(count);
  await page.getByRole('button',{name:'Live board',exact:true}).click();await page.getByRole('button',{name:'Play again',exact:true}).click();
  await expect(page).not.toHaveURL(new RegExp(`#match=${id}$`));await expect(page.getByRole('button',{name:'Advance',exact:true})).toBeVisible();
  const nextId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('match')!,next=await savedMatch(page,nextId);
  expect(next.players).toEqual(opened.players);expect(next.move_count).toBe(humanSeat);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('computer-practice-seat.png'),fullPage:true});
});
