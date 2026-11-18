import {test,expect} from '@playwright/test';
import {E2E_ADMIN_HEADERS,uniqueName} from './helpers';

test.beforeEach(async({baseURL,page})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Administrator acceptance tests require a disposable loopback server.');
  await page.setExtraHTTPHeaders(E2E_ADMIN_HEADERS);
});

for(const name of ['admin','browse','invites','stats']){
  test(`${name}.html loads without JavaScript errors`,async({page})=>{
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(`/static/${name}.html`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('query-mode referrals browse branches and search without a global export',async({page})=>{
  const errors:string[]=[];let legacy=0;
  page.on('pageerror',error=>errors.push(error.message));
  const alice={id:'alice',display_name:'Alice',total_invites:2,direct_invites:1,invited_by_user_id:null};
  const bob={id:'bob',display_name:'Bob',total_invites:1,direct_invites:1,invited_by_user_id:'alice',invited_by_name:'Alice'};
  const carol={id:'carol',display_name:'Carol',total_invites:0,direct_invites:0,invited_by_user_id:'bob',invited_by_name:'Bob'};
  await page.route('**/storage/capabilities',route=>route.fulfill({json:{pagination:true}}));
  await page.route('**/admin/invites',route=>{legacy++;return route.fulfill({status:500});});
  await page.route('**/v2/admin/referrals/summary',route=>route.fulfill({json:{summary:{users:3,invited_users:2,inviters:2,biggest_tree:3,longest_chain:2,cycles_broken:0},generated_at:'2026-09-30T12:00:00Z'}}));
  await page.route('**/v2/admin/referrals/users?*',route=>{
    const query=new URL(route.request().url()).searchParams;
    let items=[alice,bob,carol];
    if(query.has('parent_id'))items=query.get('parent_id')==='alice'?[bob]:query.get('parent_id')==='bob'?[carol]:[alice];
    if(query.get('q'))items=items.filter(user=>user.id.startsWith(query.get('q')!.toLowerCase()));
    return route.fulfill({json:{items,next_cursor:null}});
  });
  await page.goto('/invites');
  await page.locator('#leaderboard').getByRole('button',{name:'Alice',exact:true}).click();
  await expect(page.locator('#detail')).toContainText('2 total invited');
  await page.locator('#detail').getByRole('button',{name:'Bob',exact:true}).click();
  await expect(page.locator('#detail')).toContainText('Carol');
  await page.locator('#detail').getByRole('button',{name:'Invited by Alice'}).click();
  await expect(page.locator('#detail h3')).toHaveText('Alice');
  await page.locator('#search').fill('Bob');
  await expect(page.locator('#results')).toContainText('Bob');
  expect(legacy).toBe(0);
  expect(errors).toEqual([]);
});

test('campaign dashboard explains creation and supports deleting campaign variants',async({page,request})=>{
  const name=uniqueName('Temporary campaign');
  const key=uniqueName('temporary-campaign').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50);
  const created=await request.post('/admin/experiments/campaign-links',{headers:E2E_ADMIN_HEADERS,data:{name,key}});
  expect(created.status()).toBe(201);
  const campaign=await created.json();
  try{
    await page.goto('/static/stats.html');
    const panel=page.locator('.experiment-panel').filter({hasText:'Advertisement campaigns'});
    await expect(panel).toContainText(name);
    await expect(panel).not.toContainText(/actual spend|cost/i);
    await page.getByText('Step-by-step: create and use a campaign link').click();
    await expect(page.getByText(/Copy the generated link/)).toBeVisible();
    page.once('dialog',dialog=>dialog.accept());
    await panel.getByRole('button',{name:`Delete ${name}`}).click();
    await expect(panel.getByText(name)).toHaveCount(0);
  }finally{
    // Also clean up if a browser assertion fails before the UI deletion.
    await request.delete(`/admin/experiments/ad-campaigns/variants/${campaign.variant_id}`,{headers:E2E_ADMIN_HEADERS});
  }
});
