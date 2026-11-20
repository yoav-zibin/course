import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createGame,createUser,loginAs,uniqueName} from './helpers';

const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});
async function createMatch(request:APIRequestContext,user:any,gameId:string) {
  const response=await request.post('/matches',{headers:headers(user),data:{game_id:gameId}});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function joinAndStart(request:APIRequestContext,alice:any,bob:any,matchId:string) {
  const invite=await (await request.post(`/matches/${matchId}/invites`,{headers:headers(alice),data:{}})).json();
  const accepted=await request.post(`/invites/${invite.token}/accept`,{headers:headers(bob)});expect(accepted.ok()).toBeTruthy();
  const started=await request.post(`/matches/${matchId}/start`,{headers:headers(alice)});expect(started.ok()).toBeTruthy();
}
async function inbox(request:APIRequestContext,user:any) {
  const response=await request.get('/users/me/notifications',{headers:headers(user)});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function move(request:APIRequestContext,user:any,matchId:string,cell:number,expectedMoveCount:number) {
  const response=await request.post(`/matches/${matchId}/moves`,{headers:headers(user),data:{move:{cell},expected_move_count:expectedMoveCount}});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function fakeWebPush(page:Page) {
  const vapid=Buffer.alloc(65).toString('base64url');
  await page.route('**/push/config',route=>route.fulfill({json:{enabled:true,native_enabled:false,vapid_public_key:vapid}}));
  await page.addInitScript(()=>{
    let subscription:any=null;
    (window as any).__notificationPrompts=0;
    class NotificationStub {
      static permission='default';
      static async requestPermission(){(window as any).__notificationPrompts++;this.permission='granted';return 'granted';}
    }
    Object.defineProperty(window,'Notification',{configurable:true,value:NotificationStub});
    Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
    const b64=(length:number)=>btoa(String.fromCharCode(...new Uint8Array(length))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const registration={pushManager:{
      getSubscription:async()=>subscription,
      subscribe:async(options:any)=>subscription={endpoint:`https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(16).slice(2)}`,options,expirationTime:null,toJSON(){return {endpoint:this.endpoint,keys:{p256dh:b64(65),auth:b64(16)}};},async unsubscribe(){subscription=null;return true;}},
    }};
    const worker=new EventTarget() as any;
    worker.register=async()=>registration;worker.getRegistration=async()=>registration;worker.ready=Promise.resolve(registration);
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:worker});
  });
}

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Notification acceptance uses only a disposable loopback server.');});

test('a direct invite appears in-app with push disabled and opens its match invitation',async({page,browser,request})=>{
  const alice=await createUser(request,uniqueName('Invite host')),bob=await createUser(request,uniqueName('Invite recipient'));
  await request.patch(`/users/${bob.id}`,{headers:headers(bob),data:{notifications_enabled:false}});
  const match=await createMatch(request,alice,await createGame(request,uniqueName('Invitation game')));
  await loginAs(page,bob);await page.goto('/portal');
  const senderContext=await browser.newContext(),sender=await senderContext.newPage();
  try{
    await loginAs(sender,alice);await sender.goto(new URL(`/portal#match=${match.id}`,page.url()).href);
    await sender.getByRole('button',{name:'Share match',exact:true}).click();
    await sender.getByRole('textbox',{name:'Player code or ID',exact:true}).fill(bob.referral_code);
    await sender.getByRole('button',{name:'Send invitation',exact:true}).click();
    await expect(sender.getByText('Invitation sent.',{exact:true})).toBeVisible();
    const entry=(await inbox(request,bob)).items.find((item:any)=>item.event==='invite_request');expect(entry).toBeTruthy();
    await page.getByRole('button',{name:'Notifications',exact:true}).click();
    const notification=page.getByTestId(`notification-${entry.id}`);await expect(notification).toBeVisible();await notification.click();
    await expect(page.getByText(`${alice.display_name} invited you to play`,{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toHaveCount(0);
    expect((await inbox(request,bob)).items.some((item:any)=>item.id===entry.id)).toBe(false);
    await page.getByRole('button',{name:'Join match',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
    const joined=await request.get(`/matches/${match.id}`,{headers:headers(bob)});expect((await joined.json()).players.some((player:any)=>player.user_id===bob.id)).toBe(true);
  }finally{await senderContext.close();}
});

test('a rematch request lets the reserved opponent join a rematch from the inbox',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Rematch host')),bob=await createUser(request,uniqueName('Rematch recipient'));
  const match=await createMatch(request,alice,await createGame(request,uniqueName('Rematch game')));await joinAndStart(request,alice,bob,match.id);
  for(const [index,cell]of [0,3,1,4,2].entries()){
    const moved=await request.post(`/matches/${match.id}/moves`,{headers:headers(index%2?bob:alice),data:{move:{cell},expected_move_count:index}});expect(moved.ok(),await moved.text()).toBeTruthy();
  }
  const rematch=await request.post(`/matches/${match.id}/rematch`,{headers:headers(alice)});expect(rematch.ok()).toBeTruthy();const next=await rematch.json();
  const entry=(await inbox(request,bob)).items.find((item:any)=>item.event==='rematch_request');expect(entry).toBeTruthy();
  await loginAs(page,bob);await page.goto('/portal');await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await page.getByTestId(`notification-${entry.id}`).click();
  await expect(page).toHaveURL(new RegExp(`#match=${next.id}$`));
  await expect(page.getByRole('button',{name:'Share match',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toHaveCount(0);
  expect((await inbox(request,bob)).items.some((item:any)=>item.id===entry.id)).toBe(false);
  const joined=await request.get(`/matches/${next.id}`,{headers:headers(bob)});expect((await joined.json()).players.some((player:any)=>player.user_id===bob.id)).toBe(true);
});

test('the inbox updates automatically, keeps one named opponent update per match, and clears it when opened',async({page,request})=>{
  test.setTimeout(90000);
  const alice=await createUser(request,uniqueName('Moving opponent')),bob=await createUser(request,uniqueName('Inbox player'));
  const match=await createMatch(request,alice,await createGame(request,uniqueName('Live inbox game')));await joinAndStart(request,alice,bob,match.id);
  await loginAs(page,bob);await page.goto('/portal');await page.getByRole('button',{name:'Notifications',exact:true}).click();
  const dialog=page.getByRole('dialog'),rows=dialog.locator('[data-testid^="notification-"]');
  await expect(page.getByText('No notifications yet.',{exact:true})).toBeVisible();
  for(const name of ['Refresh','Open','Mark read'])await expect(dialog.getByRole('button',{name,exact:true})).toHaveCount(0);

  await move(request,alice,match.id,0,0);
  const first=(await inbox(request,bob)).items[0];expect(first.event).toBe('turn');
  await expect(page.getByTestId(`notification-${first.id}`)).toBeVisible({timeout:15000});
  await expect(rows).toHaveCount(1);
  await move(request,bob,match.id,3,1);await move(request,alice,match.id,1,2);
  const updated=await inbox(request,bob);expect(updated.items).toHaveLength(1);
  const latest=updated.items[0];expect(latest.id).not.toBe(first.id);
  expect(latest.body).toContain(`${alice.display_name} moved. Your turn`);
  const notification=page.getByTestId(`notification-${latest.id}`);
  await expect(notification).toBeVisible({timeout:15000});await expect(rows).toHaveCount(1);
  await expect(page.getByTestId(`notification-${first.id}`)).toHaveCount(0);
  await expect(notification).toContainText(`${alice.display_name} moved. Your turn`);

  let refused=false;
  await page.route(`**/users/me/notifications/${latest.id}/read`,route=>{
    if(!refused){refused=true;return route.fulfill({status:503,json:{detail:'Please try opening this notification again.'}});}
    return route.continue();
  });
  await notification.click();await expect(notification).toContainText('Please try opening this notification again.');
  expect((await inbox(request,bob)).items.map((item:any)=>item.id)).toEqual([latest.id]);
  await notification.click();await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
  await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toHaveCount(0);
  expect((await inbox(request,bob)).items).toEqual([]);
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByText('No notifications yet.',{exact:true})).toBeVisible();await expect(rows).toHaveCount(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByText('No notifications yet.',{exact:true})).toBeVisible();

  await move(request,bob,match.id,4,3);await move(request,alice,match.id,8,4);
  const next=(await inbox(request,bob)).items[0];expect(next.id).not.toBe(latest.id);
  await expect(page.getByTestId(`notification-${next.id}`)).toBeVisible({timeout:15000});await expect(rows).toHaveCount(1);
});

test('first confirmed turn handoff asks once and profile controls register and disable web push',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Notification player')),bob=await createUser(request,uniqueName('Other player'));
  const match=await createMatch(request,alice,await createGame(request,uniqueName('Consent game')));await joinAndStart(request,alice,bob,match.id);
  await fakeWebPush(page);await loginAs(page,alice);await page.goto(`/portal#match=${match.id}`);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Know when it’s your turn',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__notificationPrompts)).toBe(0);
  await page.getByRole('button',{name:'Not now',exact:true}).click();
  const moved=await request.post(`/matches/${match.id}/moves`,{headers:headers(bob),data:{move:{cell:3},expected_move_count:1}});expect(moved.ok()).toBeTruthy();
  await page.getByRole('button',{name:'Cell 2',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Know when it’s your turn',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'Push notifications',exact:true});await expect(toggle).toBeChecked();
  await toggle.click();await expect(toggle).not.toBeChecked();
  await expect.poll(async()=>(await (await request.get(`/users/${alice.id}`,{headers:headers(alice)})).json()).notifications_enabled).toBe(false);
  await toggle.click();await expect(toggle).toBeChecked();await expect(page.getByText('Enabled on this device',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__notificationPrompts)).toBe(1);
  const subscriptions=await request.get('/push/subscriptions',{headers:headers(alice)});expect((await subscriptions.json()).length).toBe(1);
  await toggle.click();await expect(toggle).not.toBeChecked();
  await expect.poll(async()=>(await (await request.get('/push/subscriptions',{headers:headers(alice)})).json()).length).toBe(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.reload();
  await expect(page.getByRole('heading',{name:'Know when it’s your turn',exact:true})).toHaveCount(0);
});
