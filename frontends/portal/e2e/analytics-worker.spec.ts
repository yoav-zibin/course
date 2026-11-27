import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

// Exercise the production controller on loopback without sending any traffic to Google.
const controller = readFileSync(path.join(__dirname, '../../../static/analytics.js'), 'utf8')
  .replace("location.hostname !== 'buildplay.fun'", 'false');
const tag = 'https://www.googletagmanager.com/gtag/js?id=G-6CCXZQYVE7';
const fixture = '<button onclick="this.textContent=\'Moved\'">Move</button><script src="/static/analytics.js?v=4"></script>';

test.beforeEach(async ({page, baseURL}) => {
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('Requires a loopback origin');
  await page.route('**/analytics-fixture', route => route.fulfill({contentType:'text/html', body:fixture}));
  await page.route('**/static/analytics.js?v=4', route => route.fulfill({contentType:'text/javascript', body:controller}));
});

test('input works while the Google tag is loading and while it occupies its worker', async ({page, context, baseURL}) => {
  const stages: string[] = [];
  const tagRequests: string[] = [];
  let commands: any[] = [];
  await context.route('**/analytics-probe-*', async route => {
    stages.push(new URL(route.request().url()).pathname);
    if (route.request().method() === 'POST') commands = JSON.parse(route.request().postData()!);
    await route.fulfill({status:200, body:'ok'});
  });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await context.route(tag, async route => {
    stages.push('download');
    tagRequests.push(route.request().resourceType());
    await hold;
    await route.fulfill({contentType:'text/javascript', headers:{'Access-Control-Allow-Origin':'*'}, body:`
      fetch(${JSON.stringify(baseURL + '/analytics-probe-start')}, {method:'POST',body:JSON.stringify(window.dataLayer.map(a=>Array.from(a)))});
      const start=Date.now(); while(Date.now()-start<1500){}
      fetch(${JSON.stringify(baseURL + '/analytics-probe-end')});
    `});
  });
  await page.goto('/analytics-fixture');
  const button = page.getByRole('button');
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('fixture-account'));
  await expect.poll(() => stages).toContain('download');
  await button.click();
  await expect(button).toHaveText('Moved');
  await page.evaluate(() => document.querySelector('button')!.textContent = 'Again');
  release();
  await expect.poll(() => stages, {intervals:[10,25]}).toContain('/analytics-probe-start');
  await button.click();
  await expect(button).toHaveText('Moved');
  expect(stages).not.toContain('/analytics-probe-end');
  await expect.poll(() => stages).toContain('/analytics-probe-end');
  expect(tagRequests).toEqual(['fetch']);
  expect(await page.evaluate(() => typeof (window as any).gtag)).toBe('undefined');
  expect(commands).toContainEqual(['config','G-6CCXZQYVE7',{user_id:'fixture-account',page_location:baseURL+'/analytics-fixture'}]);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser(null));
  expect(await page.evaluate(() => (window as any)['ga-disable-G-6CCXZQYVE7'])).toBe(true);
});

test('portal navigation sends one virtual page per signed-in screen without match URLs', async ({page, context, baseURL}) => {
  const events: Array<[string,string]> = [];
  await context.route('**/page-probe', async route => {
    events.push(JSON.parse(route.request().postData()!));
    await route.fulfill({body:'ok'});
  });
  await context.route(tag, route => route.fulfill({
    contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`
      function record(command) {
        if (command[0] === 'event' && command[1] === 'page_view') {
          const event = command[2];
          fetch(${JSON.stringify(baseURL + '/page-probe')}, {method:'POST',body:JSON.stringify([event.page_title,event.page_location])});
        }
      }
      window.dataLayer.forEach(record);
      const push = window.dataLayer.push;
      window.dataLayer.push = function(command){ record(command); return push.call(this,command); };
    `,
  }));
  await page.goto('/analytics-fixture#match=private-match-id');
  const view = (id:string|null,screen:string) => page.evaluate(([user,name]) => {
    (window as any).BuildPlayAnalytics.setPortalView(user,name);
  }, [id,screen]);
  await view('fixture-account','games');
  await expect.poll(() => events).toEqual([['games',baseURL+'/portal/games']]);
  await view('fixture-account','games');
  await view('fixture-account','match');
  await expect.poll(() => events).toEqual([['games',baseURL+'/portal/games'],['match',baseURL+'/portal/match']]);
  await view(null,'account');
  expect(await page.evaluate(() => (window as any)['ga-disable-G-6CCXZQYVE7'])).toBe(true);
});

test('a blocked worker or a signed-out visit never loads a main-thread Google tag', async ({page, context}) => {
  let requested = false;
  await context.route(tag, route => { requested = true; return route.abort(); });
  await page.addInitScript(() => {
    navigator.serviceWorker.register = async () => { (window as any).__analyticsRegistrationDenied = true; throw new Error('Storage denied'); };
  });
  await page.goto('/analytics-fixture');
  expect(await page.locator('script[src*="partytown"]').count()).toBe(0);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('fixture-account'));
  await expect.poll(() => page.evaluate(() => (window as any).__analyticsRegistrationDenied)).toBe(true);
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('Moved');
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  expect(requested).toBe(false);
});

test('account changes while the worker is starting use the latest identity and respect opt-out', async ({page, context, baseURL}) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/analytics-worker/partytown.js', async route => { await hold; await route.continue(); });
  const identities: Array<string|null> = [];
  await context.route('**/identity-probe', async route => {
    identities.push(JSON.parse(route.request().postData()!));
    await route.fulfill({body:'ok'});
  });
  await context.route(tag, route => route.fulfill({
    contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:`
      function record(command) {
        if (command[0] === 'config') fetch(${JSON.stringify(baseURL + '/identity-probe')}, {method:'POST',body:JSON.stringify(command[2].user_id)});
      }
      window.dataLayer.forEach(record);
      const push=window.dataLayer.push;
      window.dataLayer.push=function(command){record(command);return push.call(this,command);};
    `,
  }));
  await page.goto('/analytics-fixture');
  const starting = page.waitForRequest('**/analytics-worker/partytown.js');
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('first'));
  await starting;
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('second'));
  release();
  await expect.poll(() => identities).toEqual(['second']);
  await page.evaluate(() => (window as any).BuildPlayAnalytics.clearUser());
  await expect.poll(() => identities).toEqual(['second',null]);
  await page.addInitScript(() => { (window as any)['ga-disable-G-6CCXZQYVE7'] = true; });
  await page.reload();
  await page.evaluate(() => (window as any).BuildPlayAnalytics.setUser('opted-out'));
  await page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)));
  expect(await page.locator('script[src*="partytown"]').count()).toBe(0);
});
