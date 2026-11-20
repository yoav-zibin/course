import {test,expect,type Page} from '@playwright/test';
import copy from '../src/platform/ui-copy.json';
import {createGame,createUser,uniqueName} from './helpers';

const hugeBalance=9_876_543_210_123;
function notificationPage(count:number){
  const items=Array.from({length:Math.min(count,50)},(_,index)=>({
    id:'header-notification-'+index,event:'your_turn',title:'Your turn',body:'A match is waiting.',
    url:'/portal#match=header-match-'+index,match_id:'header-match-'+index,
    created_at:new Date(2026,10,19,12,0,index).toISOString(),read_at:null,
  }));
  return {items,next_cursor:count>items.length?'header-next-page':null,unread_count:count};
}

const avatar='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#70d5ff"/></svg>').toString('base64');
const translated=(source:string,locale:string)=>locale==='en'?source:(copy as Record<string,Record<string,string>>)[source]?.[locale]??source;
test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Header checks require a disposable loopback server.');});

async function singleLine(page:Page){
  const header=page.getByTestId('portal-header');
  const controls=[page.getByTestId('header-games'),page.getByTestId('header-matches'),page.getByTestId('header-token-balance'),page.getByTestId('header-notifications'),page.getByTestId('header-focus'),page.getByTestId('header-account')];
  const headerBox=(await header.boundingBox())!,boxes=[];
  expect(headerBox.height).toBeLessThanOrEqual(75);
  for(const control of controls){
    await expect(control).toBeVisible();const box=(await control.boundingBox())!;boxes.push(box);
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
    expect(Math.abs(box.y+box.height/2-(headerBox.y+headerBox.height/2))).toBeLessThan(2);
  }
  for(let first=0;first<boxes.length;first++)for(let second=first+1;second<boxes.length;second++){
    const a=boxes[first],b=boxes[second];expect(a.x+a.width<=b.x+.5||b.x+b.width<=a.x+.5).toBe(true);
  }
  const bug=(await page.getByTestId('bug-report-button').boundingBox())!;
  for(const box of boxes)expect(box.x+box.width<=bug.x||bug.x+bug.width<=box.x||box.y+box.height<=bug.y||bug.y+bug.height<=box.y).toBe(true);
  for(const control of [page.getByTestId('header-games'),page.getByTestId('header-matches')])expect(await control.evaluate(node=>{const text=node.firstElementChild as HTMLElement;return text.scrollWidth<=text.clientWidth+1;})).toBe(true);
  expect(await page.getByTestId('header-token-balance').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  return boxes;
}

for(const locale of ['en','ar'])test(`header stays on one line with long names and exact large balances in ${locale}`,async({page,request},info)=>{
  const user=await createUser(request,'Header fixture account with a deliberately long display name');
  user.picture_url='/header-avatar-unavailable';
  let balance=999;
  await page.addInitScript(account=>{if(window!==window.top)return;localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',account.id);},user);
  await page.route(`**/users/${user.id}`,async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),token_balance:balance,picture_url:'/header-avatar-unavailable'}});});
  await page.route('**/header-avatar-unavailable',route=>route.fulfill({status:404,body:''}));
  await page.route('**/users/me/notifications?*',route=>route.fulfill({json:notificationPage(150)}));
  await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByTestId('header-focus')).toBeVisible();
  if(locale==='ar'){
    await page.getByTestId('header-account').click();await page.getByRole('button',{name:/Language:.*العربية/}).click();
    await page.getByRole('button',{name:translated('Close dialog','ar'),exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.dir)).toBe('rtl');
  }
  await expect(page.getByTestId('header-account')).toHaveAccessibleDescription(user.display_name);
  await expect(page.getByTestId('header-account').locator('img')).toHaveCount(0);
  await expect(page.getByTestId('header-account').locator('svg')).toHaveCount(1);
  await expect(page.getByTestId('header-notifications').getByText('99+',{exact:true})).toBeVisible();
  for(const nextBalance of [999,hugeBalance]){
    balance=nextBalance;
    await page.getByTestId('header-notifications').click();
    const exact=new Intl.NumberFormat(locale).format(balance);
    await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label',`${exact} ${translated('tokens',locale)}`);
    await page.getByRole('button',{name:translated('Close dialog',locale),exact:true}).click();
    for(const width of [320,390,799,800,1024,1279,1280,1440]){
      await page.setViewportSize({width,height:844});
      await expect.poll(async()=>Math.round((await page.getByTestId('portal-header').boundingBox())!.height)).toBeLessThanOrEqual(75);
      const boxes=await singleLine(page);
      if(locale==='ar')expect(boxes[0].x).toBeGreaterThan(boxes.at(-1)!.x);
      if(width===320&&balance===hugeBalance)await page.screenshot({path:info.outputPath(`compact-header-${locale}.png`)});
    }
  }
});

test('header icons open inbox, account, focus and the bug form with avatar and keyboard access',async({page,request},info)=>{
  const user=await createUser(request,'Header avatar fixture account');
  user.picture_url=avatar;
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(account=>{if(window!==window.top)return;localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',account.id);},user);
  await page.route(`**/users/${user.id}`,async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),token_balance:hugeBalance,picture_url:avatar}});});
  await page.route('**/users/me/notifications?*',route=>route.fulfill({json:notificationPage(1)}));
  await page.goto('/portal#local');await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  const account=page.getByRole('button',{name:'Account menu',exact:true});
  await expect(account.locator('img')).toHaveCount(1);
  await expect.poll(()=>account.locator('img').evaluate((node:HTMLImageElement)=>node.naturalWidth)).toBeGreaterThan(0);
  const notifications=page.getByRole('button',{name:'Notifications',exact:true});
  await expect(notifications).toHaveAccessibleDescription('Unread notifications: 1');
  await notifications.click();await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await account.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Your account',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:user.display_name,exact:true})).toBeVisible();
  await expect(page.getByText(new RegExp(`${hugeBalance} tokens`))).toBeVisible();
  await page.getByRole('button',{name:'Report a bug or request a feature',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Bug or feature request',exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Screenshot captured before opening this report',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Report a bug or feature request',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your account',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  const focus=page.getByRole('button',{name:'Focus mode',exact:true});await focus.focus();await page.keyboard.press('Space');
  await expect(page.getByTestId('portal-header')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Report a bug or request a feature',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Exit focus mode',exact:true}).click();await expect(account).toBeVisible();
  await page.getByRole('button',{name:'Games',exact:true}).click();await expect(focus).toHaveCount(0);
  await page.screenshot({path:info.outputPath('header-avatar-actions.png')});
});

test('Games and Matches share one header row and replace the redundant game return control',async({page,request})=>{
  const name=uniqueName('Compact navigation game'),id=await createGame(request,name);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:844});await page.goto(`/portal#game=${id}`);
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    const header=page.getByTestId('portal-header');
    await expect(header.getByRole('button',{name:'Games',exact:true})).toHaveCount(1);
    await expect(header.getByRole('button',{name:'Matches',exact:true})).toHaveCount(1);
    await expect(header.getByRole('button',{name:'Invites',exact:true})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'BuildPlay home',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/←.*(?:All games|Games)/})).toHaveCount(0);
    const games=(await page.getByTestId('header-games').boundingBox())!,matches=(await page.getByTestId('header-matches').boundingBox())!;
    expect(Math.abs(games.y-matches.y)).toBeLessThan(1);
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(65);
    await page.getByTestId('header-games').click();
    await expect(page).toHaveURL(/#games$/);await expect(page.getByRole('textbox',{name:'Search games',exact:true})).toBeVisible();
    await page.goBack();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await page.getByTestId('header-matches').click();
    await expect(page).toHaveURL(/#matches$/);await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Invites',exact:true}).click();
    await expect(page).toHaveURL(/#invites$/);await expect(page.getByRole('heading',{name:'Invites',exact:true})).toBeVisible();
    await expect(page.getByTestId('header-matches')).toHaveAttribute('aria-current','page');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
